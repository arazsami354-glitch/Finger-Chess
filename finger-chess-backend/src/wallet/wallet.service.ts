import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TxnStatus, TxnType, WalletTransaction } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FraudService } from './fraud/fraud.service';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_COMMISSION_PERCENT = 15;

type WalletBalanceField = 'availableBalance' | 'lockedBalance' | 'pendingBalance';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fraud: FraudService,
    private readonly notifications: NotificationsService,
  ) {}

  // ==========================================================================
  // BALANCE / HISTORY
  // ==========================================================================

  async getBalance(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    // "Lifetime Earnings" — total prize money ever won, all-time. Deliberately
    // distinct from current balance (which nets out spending/withdrawals) —
    // this is the number a player actually wants to see grow over their
    // whole history on the platform, the same way Stripe shows "all-time
    // volume" separately from "current balance."
    const lifetimeEarningsAgg = await this.prisma.walletTransaction.aggregate({
      where: { walletId: wallet.id, type: 'prize_credit', status: 'completed' },
      _sum: { amount: true },
    });

    return {
      // Prisma Decimal JSON-serializes as a string; every client (app-shell
      // header, dashboard, wallet page, withdraw dialog) treats these as
      // numbers and calls .toFixed() directly — a raw Decimal would crash
      // them, so normalize to Number here in the one authoritative place.
      available: Number(wallet.availableBalance),
      locked: Number(wallet.lockedBalance),
      pending: Number(wallet.pendingBalance),
      currency: wallet.currency,
      total: Number(wallet.availableBalance) + Number(wallet.lockedBalance) + Number(wallet.pendingBalance),
      lifetimeEarnings: Number(lifetimeEarningsAgg._sum.amount ?? 0),
    };
  }

  async getTransactionHistory(
    userId: string,
    filters: { take?: number; cursor?: string; type?: string; status?: string; from?: string; to?: string; search?: string } = {},
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const take = filters.take ?? 50;

    const where: Prisma.WalletTransactionWhereInput = { walletId: wallet.id };
    if (filters.type) where.type = filters.type as TxnType;
    if (filters.status) where.status = filters.status as TxnStatus;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }
    if (filters.search) {
      // No free-text field exists on a transaction — search matches
      // against the reference ID (pasting one in finds the transaction it
      // belongs to) or the amount rendered as a string (typing "42.50"
      // finds that transaction), which covers what someone actually
      // searching their own wallet history is looking for.
      where.OR = [
        { referenceId: { contains: filters.search, mode: 'insensitive' } },
        { amount: { equals: isNaN(Number(filters.search)) ? undefined : Number(filters.search) } },
      ];
    }

    return this.prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    });
  }

  /** Same filter shape as getTransactionHistory, but returns everything matching (capped at a sane ceiling) for CSV export rather than one paginated page. */
  async getTransactionsForExport(userId: string, filters: { type?: string; status?: string; from?: string; to?: string; search?: string } = {}) {
    return this.getTransactionHistory(userId, { ...filters, take: 5000 });
  }

  async getMyDeposits(userId: string, take = 25) {
    return this.prisma.deposit.findMany({ where: { userId }, orderBy: { initiatedAt: 'desc' }, take });
  }

  async getMyWithdrawals(userId: string, take = 25) {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take,
      select: { id: true, amount: true, currency: true, payoutMethod: true, status: true, requestedAt: true, processedAt: true },
    });
  }

  // ==========================================================================
  // LEDGER PRIMITIVE
  // ==========================================================================

  /**
   * The single ledger-write primitive. Every balance-changing operation in
   * this service is the same shape, and previously each copy-pasted this
   * block (with slightly different keys, error messages and field deltas):
   *   1. skip if the idempotency key was already written,
   *   2. bail early (null) if a preconditioning hold is missing,
   *   3. read the wallet, optionally enforcing a minimum available balance,
   *   4. apply the requested balance deltas and write the wallet_transactions
   *      row, recording the new available balance on it.
   * Callers that use an atomic `updateMany` claim as their concurrency guard
   * (withdrawal capture/reverse, refund approval) pass `skipIdempotencyCheck`
   * — the claim already ran before this helper, so the extra read would be
   * dead weight; the key is still recorded on the created row so retries of
   * the whole flow stay safe.
   *
   * MUST only be called inside `runInSerializableTransaction` — it reads a
   * balance and writes based on it, which is exactly the race that isolation
   * level protects against.
   */
  private async applyLedgerEntry(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      amount: number;
      type: WalletTransaction['type'];
      referenceType: string;
      referenceId: string;
      idempotencyKey: string;
      skipIdempotencyCheck?: boolean;
      requireHoldKey?: string;
      minAvailable?: number;
      insufficientMessage?: string;
      balanceChanges: { field: WalletBalanceField; op: 'increment' | 'decrement' }[];
    },
  ): Promise<{ alreadyApplied: boolean; transaction: WalletTransaction } | null> {
    if (!params.skipIdempotencyCheck) {
      const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
      if (existing) return { alreadyApplied: true, transaction: existing };
    }

    if (params.requireHoldKey) {
      const held = await tx.walletTransaction.findUnique({ where: { idempotencyKey: params.requireHoldKey } });
      if (!held) return null; // nothing was actually held — nothing to write
    }

    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: params.userId } });
    if (params.minAvailable !== undefined && Number(wallet.availableBalance) < params.minAvailable) {
      throw new BadRequestException(params.insufficientMessage ?? 'Insufficient available balance');
    }

    const data: Record<string, unknown> = { version: { increment: 1 } };
    for (const change of params.balanceChanges) {
      data[change.field] = change.op === 'increment' ? { increment: params.amount } : { decrement: params.amount };
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: data as Prisma.WalletUpdateInput,
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: params.type,
        amount: params.amount,
        balanceAfter: updated.availableBalance,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        idempotencyKey: params.idempotencyKey,
      },
    });

    return { alreadyApplied: false, transaction };
  }

  // ==========================================================================
  // DEPOSITS
  // ==========================================================================

  /**
   * Credits a wallet after a payment gateway webhook has verified the
   * payment succeeded. Called ONLY from PaymentService after signature
   * verification — this method itself doesn't re-verify the gateway, it
   * trusts its caller, so it must never be exposed on a controller directly.
   * Idempotent on `idempotencyKey` (`deposit:{depositId}`).
   */
  async creditDeposit(userId: string, amount: number, depositId: string, ipAddress?: string) {
    const result = await this.prisma.runInSerializableTransaction(async (tx) => {
      return this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'deposit',
        referenceType: 'deposit',
        referenceId: depositId,
        idempotencyKey: `deposit:${depositId}`,
        balanceChanges: [{ field: 'availableBalance', op: 'increment' }],
      });
    });

    // Fraud checks run after crediting (deposits are never blocked outright —
    // see FraudService) but before the deposit-withdraw-cycle window opens.
    await this.fraud.checkDeposit(userId, amount, ipAddress);
    await this.fraud.markDepositTimestamp(userId);

    const applied = result!;
    if (!applied.alreadyApplied) {
      void this.notifications
        .send(
          userId,
          'in_app',
          'wallet_deposit',
          'Deposit confirmed',
          `${this.formatMoney(amount)} was added to your wallet`,
          { depositId, amount },
          { groupKey: 'wallet_deposit', actionUrl: '/wallet' },
        )
        .catch((err) => this.logger.warn(`deposit notify failed for ${userId}: ${(err as Error).message}`));
    }

    return { alreadyCredited: applied.alreadyApplied, transaction: applied.transaction };
  }

  /**
   * Reverses a deposit credit after the payment gateway reports a chargeback
   * — the clawed-back funds must leave the ledger, not just be flagged. Runs
   * in a serializable transaction and is idempotent on `chargeback:{depositId}`,
   * so a replayed webhook can never double-debit. The available balance may
   * legitimately go negative here (the user already spent the money); that
   * negative value is the platform's receivable. Called only from
   * PaymentService after the gateway event has been verified.
   */
  async applyChargeback(userId: string, amount: number, depositId: string) {
    const result = await this.prisma.runInSerializableTransaction(async (tx) => {
      return this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'adjustment',
        referenceType: 'deposit',
        referenceId: depositId,
        idempotencyKey: `chargeback:${depositId}`,
        balanceChanges: [{ field: 'availableBalance', op: 'decrement' }],
      });
    });

    const applied = result!;
    return { alreadyReversed: applied.alreadyApplied, transaction: applied.transaction };
  }

  // ==========================================================================
  // WITHDRAWALS  (hold -> admin review -> approve/reject)
  // ==========================================================================

  /**
   * Step 0: create the withdrawal row AND move funds available -> pending in
   * one atomic transaction, so a failed hold can never leave a 'requested'
   * withdrawal with no matching ledger entry (previously the row was created
   * first and a failed hold would poison it — an admin approve would then
   * decrement pendingBalance that was never incremented). Fraud checks run
   * first; a 'blocked' result stops everything before anything is created.
   */
  async requestWithdrawal(userId: string, amount: number, payoutMethod: string) {
    const fraudResult = await this.fraud.checkWithdrawal(userId, amount);
    if (fraudResult.blocked) {
      throw new ForbiddenException('Withdrawal blocked pending manual review — contact support');
    }

    const withdrawalId = randomUUID();

    const row = await this.prisma.runInSerializableTransaction(async (tx) => {
      const withdrawal = await tx.withdrawal.create({
        data: { id: withdrawalId, userId, amount, payoutMethod, status: 'requested' },
      });

      // The withdrawal id is a fresh UUID, so the hold key can never already
      // exist — skip the idempotency read and keep the row creation as the
      // only guard (the transaction itself is atomic).
      await this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'withdrawal_hold',
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        idempotencyKey: `withdrawal_hold:${withdrawalId}`,
        skipIdempotencyCheck: true,
        minAvailable: amount,
        balanceChanges: [
          { field: 'availableBalance', op: 'decrement' },
          { field: 'pendingBalance', op: 'increment' },
        ],
      });

      return withdrawal;
    });

    void this.notifications
      .send(
        userId,
        'in_app',
        'wallet_withdrawal',
        'Withdrawal requested',
        `Your withdrawal of ${this.formatMoney(amount)} was received and is under review`,
        { withdrawalId, amount },
        { groupKey: 'wallet_withdrawal', actionUrl: '/wallet' },
      )
      .catch((err) => this.logger.warn(`withdrawal notify failed for ${userId}: ${(err as Error).message}`));

    return row;
  }

  /**
   * Step 2a: admin approves — the review decision and the balance change are
   * committed in ONE serializable transaction. The `updateMany` claim is the
   * lock: only the first review to transition the row out of 'requested'
   * proceeds, so concurrent approve+reject can never both execute (which used
   * to double-decrement pendingBalance and double-credit availableBalance).
   * The withdrawal row is re-read inside the transaction rather than trusting
   * caller-passed userId/amount.
   */
  async captureWithdrawal(withdrawalId: string, adminId: string) {
    return this.prisma.runInSerializableTransaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: 'requested' },
        data: { status: 'completed', reviewedBy: adminId, processedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Withdrawal has already been reviewed');
      }

      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      const amount = Number(withdrawal.amount);

      const result = await this.applyLedgerEntry(tx, {
        userId: withdrawal.userId,
        amount,
        type: 'withdrawal',
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        idempotencyKey: `withdrawal_capture:${withdrawalId}`,
        skipIdempotencyCheck: true,
        balanceChanges: [{ field: 'pendingBalance', op: 'decrement' }],
      });

      return { row: result!.transaction, userId: withdrawal.userId, amount };
    }).then(({ row, userId, amount }) => {
      void this.notifications
        .send(
          userId,
          'in_app',
          'wallet_withdrawal',
          'Withdrawal approved',
          `Your withdrawal of ${this.formatMoney(amount)} was approved and is being processed`,
          { withdrawalId, amount, status: 'approved' },
          { groupKey: 'wallet_withdrawal', actionUrl: '/wallet' },
        )
        .catch((err) => this.logger.warn(`withdrawal notify failed for ${userId}: ${(err as Error).message}`));
      return row;
    });
  }

  /** Step 2b: admin rejects — pending funds return to available_balance. Same atomic claim as captureWithdrawal. */
  async reverseWithdrawal(withdrawalId: string, adminId: string) {
    return this.prisma.runInSerializableTransaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: 'requested' },
        data: { status: 'rejected', reviewedBy: adminId, processedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Withdrawal has already been reviewed');
      }

      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      const amount = Number(withdrawal.amount);

      const result = await this.applyLedgerEntry(tx, {
        userId: withdrawal.userId,
        amount,
        type: 'withdrawal_reversal',
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        idempotencyKey: `withdrawal_reversal:${withdrawalId}`,
        skipIdempotencyCheck: true,
        balanceChanges: [
          { field: 'pendingBalance', op: 'decrement' },
          { field: 'availableBalance', op: 'increment' },
        ],
      });

      return { row: result!.transaction, userId: withdrawal.userId, amount };
    }).then(({ row, userId, amount }) => {
      void this.notifications
        .send(
          userId,
          'in_app',
          'wallet_withdrawal',
          'Withdrawal declined',
          `Your withdrawal of ${this.formatMoney(amount)} was declined and the funds returned to your balance`,
          { withdrawalId, amount, status: 'rejected' },
          { groupKey: 'wallet_withdrawal', actionUrl: '/wallet' },
        )
        .catch((err) => this.logger.warn(`withdrawal notify failed for ${userId}: ${(err as Error).message}`));
      return row;
    });
  }

  // ==========================================================================
  // MATCH ESCROW  (entry fee hold -> commission-deducted settlement)
  // ==========================================================================

  async holdEntryFee(userId: string, amount: number, gameId: string, idempotencyKey: string) {
    return this.prisma.runInSerializableTransaction(async (tx) => {
      const result = await this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'entry_fee_hold',
        referenceType: 'game',
        referenceId: gameId,
        idempotencyKey,
        minAvailable: amount,
        insufficientMessage: 'Insufficient balance for entry fee',
        balanceChanges: [
          { field: 'availableBalance', op: 'decrement' },
          { field: 'lockedBalance', op: 'increment' },
        ],
      });
      return result!.transaction;
    });
  }

  /**
   * Settlement — the only place prize money is created. Commission is
   * clamped to MAX_COMMISSION_PERCENT here regardless of what the caller
   * passes, so a bad config value can never push it past the platform cap.
   */
  async settleMatch(params: {
    gameId: string;
    winnerUserId: string;
    loserUserId: string;
    entryFee: number;
    commissionPercent: number;
  }) {
    const commissionPercent = Math.min(Math.max(params.commissionPercent, 0), MAX_COMMISSION_PERCENT);
    const pot = params.entryFee * 2;
    const commissionAmount = Number((pot * (commissionPercent / 100)).toFixed(2));
    const prizeAmount = Number((pot - commissionAmount).toFixed(2));

    return this.prisma.runInSerializableTransaction(async (tx) => {
      const idempotencyKey = `settle:${params.gameId}`;
      const existing = await tx.walletTransaction.findFirst({ where: { idempotencyKey } });
      if (existing) return { alreadySettled: true };

      // Each write is idempotency-keyed, but the outer `settle:{gameId}`
      // check is the guard, so the per-wallet writes skip their own check —
      // the key is still recorded so a replayed whole-flow retry stays safe.
      for (const userId of [params.winnerUserId, params.loserUserId]) {
        await this.applyLedgerEntry(tx, {
          userId,
          amount: params.entryFee,
          type: 'entry_fee_capture',
          referenceType: 'game',
          referenceId: params.gameId,
          idempotencyKey: `${idempotencyKey}:capture:${userId}`,
          skipIdempotencyCheck: true,
          balanceChanges: [{ field: 'lockedBalance', op: 'decrement' }],
        });
      }

      await this.applyLedgerEntry(tx, {
        userId: params.winnerUserId,
        amount: prizeAmount,
        type: 'prize_credit',
        referenceType: 'game',
        referenceId: params.gameId,
        idempotencyKey,
        skipIdempotencyCheck: true,
        balanceChanges: [{ field: 'availableBalance', op: 'increment' }],
      });

      // Commission itself isn't a wallet debit against any user — it's
      // recorded on the game row and, in the full schema, mirrored into
      // commission_transactions for platform-revenue reporting.
      await tx.game.update({
        where: { id: params.gameId },
        data: { prizeAmount, commissionAmount, status: 'completed' },
      });

      return { prizeAmount, commissionAmount };
    });
  }

  /** Draw outcome: both players' held entry fees return to their available balance, no commission taken. */
  async refundDrawEntryFees(gameId: string, playerAId: string, playerBId: string, entryFee: number) {
    const idempotencyKey = `draw_refund:${gameId}`;

    return this.prisma.runInSerializableTransaction(async (tx) => {
      const existing = await tx.walletTransaction.findFirst({ where: { idempotencyKey } });
      if (existing) return { alreadyRefunded: true };

      // Same outer-key guard pattern as settleMatch — per-player keys are
      // recorded without an individual read because the outer check already
      // short-circuits any replay of the whole refund.
      for (const userId of [playerAId, playerBId]) {
        await this.applyLedgerEntry(tx, {
          userId,
          amount: entryFee,
          type: 'entry_fee_release',
          referenceType: 'game',
          referenceId: gameId,
          idempotencyKey: `${idempotencyKey}:${userId}`,
          skipIdempotencyCheck: true,
          balanceChanges: [
            { field: 'lockedBalance', op: 'decrement' },
            { field: 'availableBalance', op: 'increment' },
          ],
        });
      }

      return { refunded: true };
    });
  }

  /**
   * Single-sided counterpart to refundDrawEntryFees — releases ONE player's
   * held entry fee. Used to compensate a half-started match: if the second
   * entry-fee hold fails during startGame, the first player's hold must be
   * returned rather than stranded with no game. No-op when no matching hold
   * exists, so it is safe to call defensively.
   */
  async releaseEntryFeeHold(userId: string, amount: number, gameId: string, idempotencyKey: string) {
    return this.prisma.runInSerializableTransaction(async (tx) => {
      const result = await this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'entry_fee_release',
        referenceType: 'game',
        referenceId: gameId,
        idempotencyKey,
        requireHoldKey: `hold:${gameId}:${userId}`,
        balanceChanges: [
          { field: 'lockedBalance', op: 'decrement' },
          { field: 'availableBalance', op: 'increment' },
        ],
      });
      return result ? result.transaction : null;
    });
  }

  // ==========================================================================
  // TOURNAMENT ESCROW  (entry hold -> capture at start + prize payouts at end)
  // ==========================================================================
  //
  // Tournament money mirrors the match-escrow lifecycle but scoped to a
  // tournament id. TxnType is a closed enum (the Prisma client can't be
  // regenerated on this machine), so the same transaction types are reused
  // and the tournament is identified through referenceType 'tournament' +
  // referenceId <tournamentId>. Every method is idempotency-keyed exactly
  // like the game-side counterparts.

  /**
   * Hold a player's entry fee: available -> locked, keyed so a retried
   * registration can never double-hold. Balance reads/writes happen inside a
   * serializable transaction because two registrations landing on the same
   * wallet concurrently must not both pass the balance check.
   */
  async holdTournamentEntry(userId: string, amount: number, tournamentId: string, idempotencyKey: string) {
    return this.prisma.runInSerializableTransaction(async (tx) => {
      const result = await this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'entry_fee_hold',
        referenceType: 'tournament',
        referenceId: tournamentId,
        idempotencyKey,
        minAvailable: amount,
        insufficientMessage: 'Insufficient balance for tournament entry fee',
        balanceChanges: [
          { field: 'availableBalance', op: 'decrement' },
          { field: 'lockedBalance', op: 'increment' },
        ],
      });
      return result!.transaction;
    });
  }

  /**
   * Return one player's held entry fee (cancelled tournament, rejected
   * registration, player leaving before the start). No-op when nothing was
   * ever held, so it is safe to call defensively.
   */
  async releaseTournamentEntry(userId: string, amount: number, tournamentId: string, idempotencyKey: string) {
    return this.prisma.runInSerializableTransaction(async (tx) => {
      const result = await this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'entry_fee_release',
        referenceType: 'tournament',
        referenceId: tournamentId,
        idempotencyKey,
        requireHoldKey: `tournament_entry_hold:${tournamentId}:${userId}`,
        balanceChanges: [
          { field: 'lockedBalance', op: 'decrement' },
          { field: 'availableBalance', op: 'increment' },
        ],
      });
      return result ? result.transaction : null;
    });
  }

  /**
   * Capture one player's held entry fee when the tournament starts — the
   * fees become platform revenue / the prize pool, so a lock stranded
   * mid-tournament can't happen: capture only runs for paid tournaments
   * that have actually begun.
   */
  async captureTournamentEntry(userId: string, amount: number, tournamentId: string, idempotencyKey: string) {
    return this.prisma.runInSerializableTransaction(async (tx) => {
      const result = await this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'entry_fee_capture',
        referenceType: 'tournament',
        referenceId: tournamentId,
        idempotencyKey,
        requireHoldKey: `tournament_entry_hold:${tournamentId}:${userId}`,
        balanceChanges: [{ field: 'lockedBalance', op: 'decrement' }],
      });
      return result ? result.transaction : null;
    });
  }

  /**
   * Credit a tournament prize to a winner's available balance. Uses the
   * same `prize_credit` type as match prizes, so it automatically feeds the
   * "lifetime earnings" number in getBalance. The tournament service is
   * responsible for paying out each rank exactly once (this method just
   * guarantees that a retried call can't double-credit).
   */
  async payoutTournamentPrize(userId: string, amount: number, tournamentId: string, idempotencyKey: string) {
    if (amount <= 0) return null;

    return this.prisma.runInSerializableTransaction(async (tx) => {
      const result = await this.applyLedgerEntry(tx, {
        userId,
        amount,
        type: 'prize_credit',
        referenceType: 'tournament',
        referenceId: tournamentId,
        idempotencyKey,
        balanceChanges: [{ field: 'availableBalance', op: 'increment' }],
      });
      return result!.transaction;
    });
  }

  // ==========================================================================
  // REFUNDS  (admin-approved reversal of a completed transaction — e.g.
  // confirmed anti-cheat ruling, duplicate charge, goodwill gesture)
  // ==========================================================================

  async requestRefund(userId: string, originalTransactionId: string, amount: number, reason: string) {
    const original = await this.prisma.walletTransaction.findUnique({
      where: { id: originalTransactionId },
      include: { wallet: { select: { userId: true } } },
    });
    if (!original) throw new NotFoundException('Original transaction not found');

    // Ownership check — without it any user could attach a refund request to
    // someone else's (e.g. high-value prize/deposit) transaction.
    if (original.wallet.userId !== userId) {
      throw new ForbiddenException('You can only request a refund for your own transactions');
    }

    // Amount is attacker-supplied; never allow crediting back more than the
    // original transaction was worth.
    if (amount > Number(original.amount)) {
      throw new BadRequestException('Refund amount cannot exceed the original transaction amount');
    }

    // One outstanding refund request per transaction, so a user can't stack
    // many pending requests and hope an admin approves more than the cap.
    const existing = await this.prisma.refund.findFirst({
      where: { originalTransactionId, status: { in: ['pending', 'approved', 'completed'] } },
    });
    if (existing) throw new ConflictException('A refund for this transaction already exists');

    return this.prisma.refund.create({
      data: { originalTransactionId, userId, amount, reason, status: 'pending' },
    });
  }

  async reviewRefund(refundId: string, adminId: string, decision: 'approve' | 'reject') {
    if (decision === 'reject') {
      // Atomic claim: only a still-pending refund can transition to rejected.
      const claimed = await this.prisma.refund.updateMany({
        where: { id: refundId, status: 'pending' },
        data: { status: 'rejected', approvedBy: adminId, processedAt: new Date() },
      });
      if (claimed.count === 0) throw new BadRequestException('Refund has already been reviewed');
      return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    }

    return this.prisma.runInSerializableTransaction(async (tx) => {
      // Same atomic claim inside the transaction as the withdrawal review —
      // the credit and the status flip commit together, so a concurrent
      // reject/approve can't leave a 'pending' refund that then credits.
      const claimed = await tx.refund.updateMany({
        where: { id: refundId, status: 'pending' },
        data: { status: 'completed', approvedBy: adminId, processedAt: new Date() },
      });
      if (claimed.count === 0) throw new BadRequestException('Refund has already been reviewed');

      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });

      await this.applyLedgerEntry(tx, {
        userId: refund.userId,
        amount: Number(refund.amount),
        type: 'refund',
        referenceType: 'refund',
        referenceId: refundId,
        idempotencyKey: `refund:${refundId}`,
        skipIdempotencyCheck: true,
        balanceChanges: [{ field: 'availableBalance', op: 'increment' }],
      });

      return refund;
    });
  }

  private formatMoney(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }
}
