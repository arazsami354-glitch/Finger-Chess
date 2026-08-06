import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface FraudCheckResult {
  blocked: boolean;
  signals: string[];
}

const DEPOSIT_VELOCITY_LIMIT = 5; // max deposits per rolling hour
const WITHDRAWAL_VELOCITY_LIMIT = 3; // max withdrawal requests per rolling 24h
const DEPOSIT_WITHDRAW_CYCLE_WINDOW_SEC = 600; // 10 minutes — classic layering pattern window
const LARGE_AMOUNT_THRESHOLD = 5000; // flags for manual review regardless of velocity

/**
 * Fraud checks here are deliberately conservative: they FLAG for review
 * (writing to fraud_signals) far more often than they BLOCK outright.
 * Only high-confidence patterns (severity 'critical') auto-block; everything
 * else surfaces in the admin queue so a human makes the final call — false
 * positives that lock out legitimate players are their own kind of damage.
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async checkDeposit(userId: string, amount: number, ipAddress?: string): Promise<FraudCheckResult> {
    const signals: string[] = [];

    const depositCount = await this.incrementAndGetCount(`fraud:deposit:${userId}:hourly`, 3600);
    if (depositCount > DEPOSIT_VELOCITY_LIMIT) {
      signals.push('velocity_deposit');
      await this.recordSignal(userId, 'velocity_deposit', 'medium', { depositCount, amount });
    }

    if (amount >= LARGE_AMOUNT_THRESHOLD) {
      signals.push('large_amount');
      await this.recordSignal(userId, 'large_amount', 'medium', { amount });
    }

    if (ipAddress) {
      const ipUserCount = await this.trackIpUserAssociation(ipAddress, userId);
      if (ipUserCount > 3) {
        signals.push('multi_account_device');
        await this.recordSignal(userId, 'multi_account_device', 'high', { ipAddress, distinctUsersFromIp: ipUserCount });
      }
    }

    // Nothing here auto-blocks a deposit — worst case is extra scrutiny on
    // a later withdrawal, which is the point where money can actually leave.
    return { blocked: false, signals };
  }

  async checkWithdrawal(userId: string, amount: number): Promise<FraudCheckResult> {
    const signals: string[] = [];
    let blocked = false;

    const withdrawalCount = await this.incrementAndGetCount(`fraud:withdrawal:${userId}:daily`, 86400);
    if (withdrawalCount > WITHDRAWAL_VELOCITY_LIMIT) {
      signals.push('velocity_withdrawal');
      await this.recordSignal(userId, 'velocity_withdrawal', 'medium', { withdrawalCount, amount });
    }

    const recentDepositKey = `fraud:last_deposit_at:${userId}`;
    const lastDepositTs = await this.redis.get(recentDepositKey);
    if (lastDepositTs) {
      const secondsSinceDeposit = (Date.now() - Number(lastDepositTs)) / 1000;
      if (secondsSinceDeposit < DEPOSIT_WITHDRAW_CYCLE_WINDOW_SEC) {
        signals.push('deposit_withdraw_cycle');
        // Rapid deposit->withdraw is a classic card-testing / laundering
        // pattern — high severity, held for mandatory manual review rather
        // than auto-blocked (could still be a legitimate change of mind).
        await this.recordSignal(userId, 'deposit_withdraw_cycle', 'high', { secondsSinceDeposit, amount });
      }
    }

    if (amount >= LARGE_AMOUNT_THRESHOLD) {
      signals.push('large_amount');
      await this.recordSignal(userId, 'large_amount', 'medium', { amount });
    }

    // A confirmed 'critical' signal from a prior chargeback is the one case
    // that auto-blocks — a user who's already defrauded the platform once
    // via chargeback doesn't get an automatic second attempt.
    const criticalOpenSignals = await this.prisma.fraudSignal.count({
      where: { userId, severity: 'critical', status: { in: ['open', 'confirmed'] } },
    });
    if (criticalOpenSignals > 0) {
      blocked = true;
      signals.push('blocked_prior_critical_signal');
    }

    return { blocked, signals };
  }

  async markDepositTimestamp(userId: string) {
    await this.redis.set(`fraud:last_deposit_at:${userId}`, Date.now().toString(), 'EX', DEPOSIT_WITHDRAW_CYCLE_WINDOW_SEC * 2);
  }

  async recordChargeback(userId: string, depositId: string, amount: number) {
    await this.recordSignal(userId, 'chargeback', 'critical', { depositId, amount });
    this.logger.warn(`Chargeback recorded for user ${userId}, deposit ${depositId}`);
  }

  /** Public so other signal sources (the risk-score engine, match integrity) share one write path into fraud_signals rather than each maintaining their own. Optional reference ties the signal to a specific deposit/withdrawal/game for the admin review screens. */
  async recordSignal(userId: string, signalType: string, severity: string, details: Record<string, unknown>, referenceType?: string, referenceId?: string) {
    await this.prisma.fraudSignal.create({
      data: { userId, signalType, severity, details: details as Prisma.InputJsonValue, status: 'open', referenceType, referenceId },
    });
  }

  private async incrementAndGetCount(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return count;
  }

  /** Tracks how many distinct user IDs have deposited from a given IP recently — a multi-accounting signal. */
  private async trackIpUserAssociation(ipAddress: string, userId: string): Promise<number> {
    const key = `fraud:ip_users:${ipAddress}`;
    await this.redis.sadd(key, userId);
    await this.redis.expire(key, 86400);
    return this.redis.scard(key);
  }
}
