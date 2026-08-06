import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeProvider {
  private readonly stripe: Stripe;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(this.config.get<string>('stripe.secretKey')!, {
      apiVersion: '2024-06-20',
    });
  }

  async createDepositIntent(amount: number, currency: string, userId: string) {
    return this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses smallest currency unit
      currency,
      metadata: { userId },
      automatic_payment_methods: { enabled: true },
    });
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.config.get<string>('stripe.webhookSecret')!,
    );
  }

  async createPayout(amount: number, currency: string, destinationAccountId: string) {
    // In practice, payouts to end users typically go through Stripe Connect
    // or a separate payout/banking API depending on region — this is
    // illustrative of the call shape, not a drop-in for every market.
    return this.stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency,
      destination: destinationAccountId,
    });
  }
}
