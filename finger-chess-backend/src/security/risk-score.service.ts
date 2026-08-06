import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FraudService } from '../wallet/fraud/fraud.service';
import { DeviceFingerprintService } from './device-fingerprint.service';
import { BehaviorAnalysisService } from './behavior-analysis.service';
import { FairPlayAuditService } from './fairplay/fair-play-audit.service';

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface RiskEvidenceItem {
  type: string; // signal type or category key, e.g. 'fairplay_collusion' | 'flaggedAnticheatReport'
  category: string; // which scored category it belongs to
  severity?: RiskTier; // for open signals
  points: number; // how many points this item contributed
  description: string; // human-readable WHY, shown verbatim in the admin dossier
  createdAt?: string;
  referenceId?: string;
}

export interface RiskScoreBreakdown {
  userId: string;
  score: number;
  tier: RiskTier;
  components: {
    flaggedAnticheatReports: number;
    openFraudSignals: number;
    linkedAccounts: string[];
    sharedIpAccountCount: number;
    tamperFlags: string[];
    // additive — kept alongside the above for backward-compatible reads
    activeCheatingPenalties: number;
    openPlayerReports: number;
  };
  /** Every contributing factor with its points — the "explainable" half of the score. */
  evidence: RiskEvidenceItem[];
  computedAt: string;
}

@Injectable()
export class RiskScoreService {
  private readonly logger = new Logger(RiskScoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly fraud: FraudService,
    private readonly fingerprint: DeviceFingerprintService,
    private readonly behavior: BehaviorAnalysisService,
    private readonly audit: FairPlayAuditService,
  ) {}

  private get cfg() {
    return this.config.get('fairplay');
  }

  private cacheKey(userId: string) {
    return `risk-score:${userId}`;
  }

  /**
   * Point weights are deliberately explicit, tunable configuration rather
   * than buried magic numbers — a starting configuration a security team
   * refines against real outcome data, not a claim of calibrated precision.
   * Every weight is documented with WHY it's weighted the way it is.
   */
  private weight(key: string, fallback: number): number {
    return Number(this.cfg.weights[key] ?? fallback);
  }

  private cap(key: string, fallback: number): number {
    return Number(this.cfg.capPerCategory[key] ?? fallback);
  }

  private severityPoints(severity: string): number {
    return Number(this.cfg.severityPoints[severity] ?? this.cfg.severityPoints.low ?? 4);
  }

  private signalTypeBonus(signalType: string): number {
    return Number(this.cfg.signalTypeBonus[signalType] ?? 0);
  }

  private tierFromScore(score: number): RiskTier {
    const t = this.cfg.tiers;
    if (score >= Number(t.critical ?? 75)) return 'critical';
    if (score >= Number(t.high ?? 50)) return 'high';
    if (score >= Number(t.medium ?? 25)) return 'medium';
    return 'low';
  }

  private autoFlagThreshold(): number {
    return Number(this.cfg.autoFlagThreshold ?? 50);
  }

  async getScore(userId: string, forceRefresh = false): Promise<RiskScoreBreakdown> {
    const previous = forceRefresh ? null : await this.readCached(userId);

    const breakdown = await this.computeScore(userId);
    await this.redis.set(this.cacheKey(userId), JSON.stringify(breakdown), 'EX', Number(this.cfg.scoreCacheTtlSec ?? 300));

    if (previous && previous.tier !== breakdown.tier) {
      // Every tier move is audited so an admin can later answer "why did this
      // user's risk escalate?" — the evidence array is what makes that answer
      // a lookup rather than a reconstruction.
      await this.audit.recordEvent({
        userId,
        eventType: 'risk_tier_change',
        metadata: {
          previousTier: previous.tier,
          newTier: breakdown.tier,
          score: breakdown.score,
          topEvidence: breakdown.evidence.slice(0, 5),
        },
      });
    }

    if (breakdown.score >= this.autoFlagThreshold()) {
      await this.autoFlagIfNeeded(userId, breakdown);
    }

    return breakdown;
  }

  private async readCached(userId: string): Promise<RiskScoreBreakdown | null> {
    const cached = await this.redis.get(this.cacheKey(userId));
    if (!cached) return null;
    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }

  private async computeScore(userId: string): Promise<RiskScoreBreakdown> {
    const [flaggedReports, openSignals, linkedAccounts, sharedIpCount, tamperFlags, cheatingPenalties, playerReports] = await Promise.all([
      this.prisma.anticheatReport.count({ where: { userId, flagged: true } }),
      this.prisma.fraudSignal.findMany({
        where: { userId, status: 'open' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, signalType: true, severity: true, createdAt: true, referenceId: true },
      }),
      this.fingerprint.findLinkedAccounts(userId),
      this.fingerprint.countSharedIpUsers(userId),
      this.fingerprint.getRecentTamperFlags(userId),
      this.prisma.penaltyRecord.count({
        where: {
          userId,
          category: 'cheating',
          liftedAt: null,
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
      }),
      this.prisma.report.count({
        where: {
          reportedUserId: userId,
          status: 'open',
          category: { in: ['cheating', 'match_manipulation'] },
        },
      }),
    ]);

    const evidence: RiskEvidenceItem[] = [];

    // 1) Flagged engine-use reports — the strongest single signal.
    const flaggedCap = this.cap('flaggedAnticheat', 75);
    const flaggedWeight = this.weight('flaggedAnticheat', 25);
    const flaggedPoints = Math.min(flaggedWeight * flaggedReports, flaggedCap);
    for (let i = 0; i < Math.min(flaggedReports, 5); i++) {
      evidence.push({
        type: 'flaggedAnticheatReport',
        category: 'flaggedAnticheat',
        points: Math.min(flaggedWeight, flaggedCap),
        description: 'Game flagged by the Stockfish engine-use detector (very low centipawn loss + high top-move match)',
      });
    }
    if (flaggedReports > 5) {
      evidence.push({ type: 'flaggedAnticheatReport', category: 'flaggedAnticheat', points: 0, description: `+ ${flaggedReports - 5} more flagged engine-use report(s) (category capped)` });
    }

    // 2) Open fraud/fair-play signals — points scale with severity, so one
    //    'critical' collusion flag outranks a handful of 'low' nags, and the
    //    per-type bonus reflects the most damning signals.
    const signalsCap = this.cap('openSignals', 80);
    let signalsPoints = 0;
    for (const s of openSignals) {
      const pts = this.severityPoints(s.severity) + this.signalTypeBonus(s.signalType);
      signalsPoints += pts;
      evidence.push({
        type: s.signalType,
        category: 'openSignals',
        severity: (s.severity as RiskTier),
        points: pts,
        description: `Open ${s.signalType} signal (${s.severity})`,
        createdAt: s.createdAt.toISOString(),
        referenceId: s.referenceId ?? undefined,
      });
    }
    signalsPoints = Math.min(signalsPoints, signalsCap);

    // 3) Active cheating penalties — a confirmed human decision to punish
    //    cheating is weightier than any automated signal.
    const penaltyCap = this.cap('cheatingPenalty', 70);
    const penaltyWeight = this.weight('cheatingPenalty', 35);
    const penaltyPoints = Math.min(penaltyWeight * cheatingPenalties, penaltyCap);
    if (cheatingPenalties > 0) {
      evidence.push({
        type: 'cheatingPenalty',
        category: 'cheatingPenalty',
        points: penaltyPoints,
        description: `${cheatingPenalties} active cheating penalty record(s) (admin-confirmed)`,
      });
    }

    // 4) Open player reports in cheating-adjacent categories.
    const reportCap = this.cap('playerReport', 40);
    const reportWeight = this.weight('playerReport', 8);
    const reportPoints = Math.min(reportWeight * playerReports, reportCap);
    if (playerReports > 0) {
      evidence.push({
        type: 'playerReport',
        category: 'playerReport',
        points: reportPoints,
        description: `${playerReports} open cheating/manipulation/collusion report(s) against this player`,
      });
    }

    // 5) Linked accounts via device fingerprint.
    const linkedCap = this.cap('linkedAccounts', 60);
    const linkedWeight = this.weight('linkedAccount', 20);
    const linkedPoints = Math.min(linkedWeight * linkedAccounts.length, linkedCap);
    if (linkedAccounts.length > 0) {
      evidence.push({
        type: 'linkedAccount',
        category: 'linkedAccounts',
        points: linkedPoints,
        description: `${linkedAccounts.length} other account(s) share this exact device fingerprint`,
      });
    }

    // 6) Shared-IP cluster (VPN/proxy-adjacent) — flat, once over threshold.
    const sharedIpPoints = this.fingerprint.isSharedIpSuspicious(sharedIpCount) ? Number(this.weight('sharedIpCluster', 15)) : 0;
    if (sharedIpPoints > 0) {
      evidence.push({
        type: 'sharedIpCluster',
        category: 'sharedIp',
        points: sharedIpPoints,
        description: `${sharedIpCount} distinct accounts on a shared IP within the last 7 days`,
      });
    }

    // 7) Browser tamper flags.
    const tamperCap = this.cap('tamperFlags', 45);
    const tamperWeight = this.weight('tamperFlag', 15);
    const tamperPoints = Math.min(tamperWeight * tamperFlags.length, tamperCap);
    if (tamperFlags.length > 0) {
      evidence.push({
        type: 'tamperFlag',
        category: 'tamperFlags',
        points: tamperPoints,
        description: `Browser automation/tamper flag(s): ${tamperFlags.join(', ')}`,
      });
    }

    const points = flaggedPoints + signalsPoints + penaltyPoints + reportPoints + linkedPoints + sharedIpPoints + tamperPoints;
    const score = Math.min(Math.round(points), 100);

    evidence.sort((a, b) => b.points - a.points);

    return {
      userId,
      score,
      tier: this.tierFromScore(score),
      components: {
        flaggedAnticheatReports: flaggedReports,
        openFraudSignals: openSignals.length,
        linkedAccounts,
        sharedIpAccountCount: sharedIpCount,
        tamperFlags,
        activeCheatingPenalties: cheatingPenalties,
        openPlayerReports: playerReports,
      },
      evidence: evidence.slice(0, 25),
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * A user crossing into the auto-flag tier creates a fraud_signals entry
   * (idempotent within a day, via a Redis dedup key) — this is what makes the
   * risk score an ACTUAL automatic-flagging system rather than a number an
   * admin has to remember to go check. It lands in the exact same admin
   * review queue every other signal does.
   */
  private async autoFlagIfNeeded(userId: string, breakdown: RiskScoreBreakdown) {
    const dedupKey = `risk-score:auto-flagged:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const alreadyFlaggedToday = await this.redis.get(dedupKey);
    if (alreadyFlaggedToday) return;

    await this.fraud.recordSignal(userId, 'high_risk_score', breakdown.tier === 'critical' ? 'critical' : 'high', {
      score: breakdown.score,
      tier: breakdown.tier,
      components: breakdown.components,
      evidence: breakdown.evidence.slice(0, 10),
    });
    await this.redis.set(dedupKey, '1', 'EX', 86_400);
  }

  /** Fire-and-forget, called from GameService.finishGame alongside the existing Stockfish anti-cheat pass — persists a signal once, so the risk-score read path never has to recompute timing analysis live. */
  async runPostGameBehaviorCheck(gameId: string, playerWhiteId: string, playerBlackId: string) {
    try {
      const timing = await this.behavior.analyzeGameTiming(gameId);
      if (timing.white.suspicious) {
        await this.fraud.recordSignal(playerWhiteId, 'uniform_move_timing', 'medium', { gameId, coefficientOfVariation: timing.white.coefficientOfVariation });
      }
      if (timing.black.suspicious) {
        await this.fraud.recordSignal(playerBlackId, 'uniform_move_timing', 'medium', { gameId, coefficientOfVariation: timing.black.coefficientOfVariation });
      }
    } catch (err) {
      this.logger.error(`Behavior analysis failed for game ${gameId}: ${(err as Error).message}`);
    }
  }

  async listHighRiskUsers(take = 50) {
    // Deliberately reads from fraud_signals (the same auto-flag mechanism
    // writes there) rather than re-scoring every user on the platform on
    // every dashboard load — the expensive aggregation already happened
    // once per user, at the point their score was last computed.
    const recentHighRiskSignals = await this.prisma.fraudSignal.findMany({
      where: { signalType: 'high_risk_score', status: 'open' },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const usersById = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: recentHighRiskSignals.map((s) => s.userId) } },
          select: { id: true, email: true, fullName: true, status: true, kycStatus: true },
        })
      ).map((u) => [u.id, u] as const),
    );

    return recentHighRiskSignals
      .filter((s) => usersById.has(s.userId))
      .map((s) => ({ ...s, user: usersById.get(s.userId)! }));
  }
}
