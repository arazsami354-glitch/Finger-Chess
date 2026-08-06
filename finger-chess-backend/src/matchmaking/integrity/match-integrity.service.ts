import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const HEAD_TO_HEAD_WINDOW_DAYS = 7;
const HEAD_TO_HEAD_SOFT_LIMIT = 3; // more than this many games together in a week is unusual for genuine random matchmaking
const LOPSIDED_WIN_RATE_THRESHOLD = 0.8; // one side winning 80%+ of a small sample suggests intentional feeding, not skill gap

export interface PairingCheckResult {
  blocked: boolean;
  reason?: string;
}

/**
 * The core threat this guards against: two accounts controlled by the same
 * person (or a coordinated pair) repeatedly matching each other and one
 * deliberately losing, laundering entry fees into "prize money" that's
 * really just a transfer with the platform's commission as the only cost.
 * Every check here runs at match-finalization time, right before a game
 * row is created — cheap relative to a game actually starting.
 */
@Injectable()
export class MatchIntegrityService {
  private readonly logger = new Logger(MatchIntegrityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async shouldBlockPairing(userAId: string, userBId: string): Promise<PairingCheckResult> {
    if (await this.areLikelySameActor(userAId, userBId)) {
      await this.recordSignal(userAId, userBId, 'multi_account_pairing');
      return { blocked: true, reason: 'Linked accounts cannot be matched together' };
    }

    const headToHead = await this.getRecentHeadToHead(userAId, userBId);
    if (headToHead.length > HEAD_TO_HEAD_SOFT_LIMIT) {
      const lopsided = this.isLopsided(headToHead, userAId);
      await this.recordSignal(userAId, userBId, lopsided ? 'collusion_suspected' : 'excessive_pairing_frequency');
      return {
        blocked: true,
        reason: lopsided
          ? 'Repeated one-sided results between these accounts flagged for review'
          : 'These accounts have been matched together too frequently recently',
      };
    }

    return { blocked: false };
  }

  /** Compares recent session IPs and device fingerprints for overlap — the classic multi-accounting signal. */
  private async areLikelySameActor(userAId: string, userBId: string): Promise<boolean> {
    const [sessionsA, sessionsB] = await Promise.all([
      this.prisma.session.findMany({
        where: { userId: userAId },
        select: { ipAddress: true, deviceFingerprint: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.session.findMany({
        where: { userId: userBId },
        select: { ipAddress: true, deviceFingerprint: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const ipsA = new Set(sessionsA.map((s) => s.ipAddress).filter(Boolean));
    const fingerprintsA = new Set(sessionsA.map((s) => s.deviceFingerprint).filter(Boolean));

    return sessionsB.some(
      (s) => (s.ipAddress && ipsA.has(s.ipAddress)) || (s.deviceFingerprint && fingerprintsA.has(s.deviceFingerprint)),
    );
  }

  private async getRecentHeadToHead(userAId: string, userBId: string) {
    const since = new Date(Date.now() - HEAD_TO_HEAD_WINDOW_DAYS * 86_400_000);
    return this.prisma.game.findMany({
      where: {
        status: 'completed',
        createdAt: { gte: since },
        OR: [
          { playerWhiteId: userAId, playerBlackId: userBId },
          { playerWhiteId: userBId, playerBlackId: userAId },
        ],
      },
      select: { winnerId: true, result: true },
    });
  }

  private isLopsided(games: { winnerId: string | null }[], userAId: string): boolean {
    const decisive = games.filter((g) => g.winnerId !== null);
    if (decisive.length === 0) return false;
    const userAWins = decisive.filter((g) => g.winnerId === userAId).length;
    const winRate = userAWins / decisive.length;
    return winRate >= LOPSIDED_WIN_RATE_THRESHOLD || winRate <= 1 - LOPSIDED_WIN_RATE_THRESHOLD;
  }

  private async recordSignal(userAId: string, userBId: string, signalType: string) {
    this.logger.warn(`Pairing blocked (${signalType}): ${userAId} <-> ${userBId}`);
    await this.prisma.fraudSignal.createMany({
      data: [
        { userId: userAId, signalType, severity: 'high', details: { pairedWith: userBId }, status: 'open' },
        { userId: userBId, signalType, severity: 'high', details: { pairedWith: userAId }, status: 'open' },
      ],
    });
  }
}
