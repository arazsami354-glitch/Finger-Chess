import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeProvider } from './providers/stripe.provider';
import { WalletService } from '../wallet/wallet.service';
import { FraudService } from '../wallet/fraud/fraud.service';
import { KycService } from '../kyc/kyc.service';
import { AgeService } from '../compliance/age.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeProvider,
    private readonly wallet: WalletService,
    private readonly fraud: FraudService,
    private readonly kyc: KycService,
    private readonly age: AgeService,
  ) {}

  async initiateDeposit(userId: string, amount: number, currency: string) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    // Compliance gate — deposits are a real-money action and previously had
    // no verification check of any kind before this. Age is checked first
    // (cheaper, no DB round trip to the kyc_documents table) so an
    // under-minimum-age user gets that specific message rather than a
    // generic KYC one.
    await this.age.assertRealMoneyEligible(userId);
    await this.kyc.assertVerified(userId);

    // Wallet is single-currency (USD by default, schema.prisma). Crediting a
    // deposit in any other currency 1:1 would mint money, since no FX
    // conversion happens anywhere — so the deposit currency must match the
    // wallet's own currency or the request is rejected outright.
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, select: { currency: true } });
    const walletCurrency = wallet?.currency ?? 'USD';
    if (currency.toUpperCase() !== walletCurrency) {
      throw new BadRequestException(`Deposits must be made in ${walletCurrency} (your wallet currency)`);
    }

    const intent = await this.stripe.createDepositIntent(amount, currency, userId);

    await this.prisma.deposit.create({
      data: {
        userId,
        paymentGateway: 'stripe',
        gatewayReference: intent.id,
        amount,
        currency,
        status: 'pending',
      },
    });

    return { clientSecret: intent.client_secret };
  }

  /**
   * PAYMENT VERIFICATION — called from the webhook controller after the
   * Stripe signature has already been checked (see StripeProvider /
   * PaymentController). Signature verification proves the event came from
   * Stripe; this method additionally verifies the event's CONTENT matches
   * what we expect before crediting anything:
   *   1. the deposit record exists and isn't already completed (idempotency)
   *   2. the amount on the event matches the amount we originally requested
   *   3. the currency matches
   * Any mismatch is treated as suspicious and logged as a fraud signal
   * rather than silently credited — a mismatched amount is exactly the
   * shape of a tampered or replayed request.
   */
  async handleDepositWebhookSucceeded(paymentIntentId: string, verifiedAmount: number, verifiedCurrency: string, ipAddress?: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { gatewayReference: paymentIntentId } });

    if (!deposit) {
      this.logger.warn(`Webhook for unknown payment intent ${paymentIntentId} — ignoring`);
      return;
    }
    if (deposit.status === 'success') {
      return; // already processed — idempotent no-op, this is expected on webhook redelivery
    }

    const amountMatches = Math.abs(Number(deposit.amount) - verifiedAmount) < 0.01;
    const currencyMatches = deposit.currency.toLowerCase() === verifiedCurrency.toLowerCase();

    if (!amountMatches || !currencyMatches) {
      await this.prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'failed' } });
      await this.fraud.checkDeposit(deposit.userId, verifiedAmount, ipAddress); // logs a signal for review
      this.logger.error(
        `Payment verification failed for deposit ${deposit.id}: expected ${deposit.amount} ${deposit.currency}, got ${verifiedAmount} ${verifiedCurrency}`,
      );
      throw new BadRequestException('Payment verification failed');
    }

    const result = await this.wallet.creditDeposit(deposit.userId, Number(deposit.amount), deposit.id, ipAddress);

    if (!result.alreadyCredited) {
      await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: { status: 'success', completedAt: new Date(), walletTransactionId: result.transaction.id },
      });
    }

    this.logger.log(`Deposit ${deposit.id} verified and credited for user ${deposit.userId}`);
  }

  async handleChargeback(paymentIntentId: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { gatewayReference: paymentIntentId } });
    if (!deposit) return;
    await this.fraud.recordChargeback(deposit.userId, deposit.id, Number(deposit.amount));

    // A chargeback claws back the deposit credit, so the wallet ledger must be
    // reversed too — not just flagged. Only reverse when the deposit was
    // actually credited; a 'pending'/'failed' deposit never put money in the
    // wallet, so debiting would take funds that were never given.
    if (deposit.status === 'success') {
      const result = await this.wallet.applyChargeback(deposit.userId, Number(deposit.amount), deposit.id);
      if (!result.alreadyReversed) {
        this.logger.warn(`Chargeback for deposit ${deposit.id}: ${deposit.amount} debited from user ${deposit.userId}`);
      }
    } else {
      this.logger.warn(`Chargeback for deposit ${deposit.id} which was never credited — no wallet debit applied`);
    }
  }
}
