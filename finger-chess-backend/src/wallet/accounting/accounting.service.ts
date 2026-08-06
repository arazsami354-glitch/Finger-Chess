import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DRIFT_TOLERANCE = 0.01; // 1 cent — accounts for legitimate rounding, not for bugs

/**
 * The ledger (wallet_transactions, append-only) is the source of truth.
 * wallets.available_balance is a cache maintained by every debit/credit
 * operation. This job re-derives the "true" balance from the ledger and
 * diffs it against the cache — any drift beyond rounding tolerance means a
 * bug or an attack, and it's flagged same-day rather than discovered when a
 * user complains or an audit happens.
 */
@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyReconciliation() {
    this.logger.log('Starting daily wallet reconciliation');
    const wallets = await this.prisma.wallet.findMany({ select: { id: true } });

    let driftCount = 0;
    for (const wallet of wallets) {
      const result = await this.reconcileWallet(wallet.id);
      if (result.status === 'drift_detected') driftCount++;
    }

    this.logger.log(`Reconciliation complete: ${wallets.length} wallets checked, ${driftCount} drift(s) found`);
  }

  async reconcileWallet(walletId: string) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

    // The ledger's net effect on available_balance: credits (deposit, prize_credit,
    // withdrawal_reversal, refund) minus debits (withdrawal, entry_fee_hold,
    // commission_debit) — entry_fee_capture/release/hold moves between
    // available and locked and nets to zero on available_balance across a
    // completed match, so they're intentionally excluded from this sum.
    const creditTypes: TxnType[] = ['deposit', 'prize_credit', 'withdrawal_reversal', 'refund', 'entry_fee_release'];
    const debitTypes: TxnType[] = ['withdrawal', 'entry_fee_hold', 'commission_debit', 'withdrawal_hold'];

    const [credits, debits] = await Promise.all([
      this.prisma.walletTransaction.aggregate({
        where: { walletId, type: { in: creditTypes }, status: 'completed' },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { walletId, type: { in: debitTypes }, status: 'completed' },
        _sum: { amount: true },
      }),
    ]);

    const ledgerBalance = Number(credits._sum.amount ?? 0) - Number(debits._sum.amount ?? 0);
    const cachedBalance = Number(wallet.availableBalance);
    const driftAmount = Number((cachedBalance - ledgerBalance).toFixed(2));
    const status = Math.abs(driftAmount) > DRIFT_TOLERANCE ? 'drift_detected' : 'ok';

    if (status === 'drift_detected') {
      this.logger.warn(`Drift detected on wallet ${walletId}: cached=${cachedBalance} ledger=${ledgerBalance} drift=${driftAmount}`);
    }

    await this.prisma.accountingReconciliationLog.create({
      data: { walletId, ledgerBalance, cachedBalance, driftAmount, status },
    });

    return { status, driftAmount };
  }

  async getOpenDrifts() {
    return this.prisma.accountingReconciliationLog.findMany({
      where: { status: 'drift_detected' },
      orderBy: { checkedAt: 'desc' },
      take: 100,
    });
  }
}
