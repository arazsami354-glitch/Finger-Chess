import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// A shared IP is only meaningful as a signal above a threshold — 2 or 3
// people on the same home/office WiFi is completely normal; the signal is
// in the shape of MANY distinct accounts funneling through one IP, which
// is what a VPN exit node or a proxy farm actually looks like.
const SHARED_IP_ACCOUNT_THRESHOLD = 4;
const SHARED_IP_WINDOW_DAYS = 7;

export interface ClientFingerprintSignals {
  screenResolution?: string;
  timezone?: string;
  platform?: string;
  language?: string;
  languages?: string[];
  hardwareConcurrency?: number;
  deviceMemory?: number;
  canvasHash?: string;
  audioHash?: string;
  webdriver?: boolean;
  pluginCount?: number;
  touchSupport?: boolean;
}

@Injectable()
export class DeviceFingerprintService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A stable hash of the signals that genuinely identify a physical
   * device/browser combination (screen, hardware, canvas/audio rendering
   * fingerprint) — deliberately EXCLUDES things that change across
   * sessions on the same real device (language can be toggled, timezone
   * can shift while traveling) so the hash stays stable for the
   * multi-account query to actually work, while still being specific
   * enough that two different physical devices essentially never collide.
   */
  private computeHash(signals: ClientFingerprintSignals): string {
    const stableParts = [
      signals.screenResolution ?? '',
      signals.platform ?? '',
      signals.hardwareConcurrency ?? '',
      signals.deviceMemory ?? '',
      signals.canvasHash ?? '',
      signals.audioHash ?? '',
    ].join('|');
    return createHash('sha256').update(stableParts).digest('hex');
  }

  /**
   * Browser-side tamper detection — these are all things a legitimate
   * browser session should never report, and each is a real, independently
   * documented bot/automation signal (not a guess): `navigator.webdriver`
   * is set `true` by Selenium/Puppeteer/Playwright by design; a zero
   * plugin count is characteristic of headless Chrome; canvas fingerprint
   * blocking (returning a constant/empty hash) is a known anti-fingerprint
   * extension behavior worth noting even though it's not inherently
   * malicious on its own.
   */
  private detectTamperFlags(signals: ClientFingerprintSignals): string[] {
    const flags: string[] = [];
    if (signals.webdriver) flags.push('webdriver_flag');
    if (signals.pluginCount === 0) flags.push('zero_plugins');
    if (!signals.canvasHash || signals.canvasHash === '0000000000000000') flags.push('canvas_blocked_or_empty');
    if (signals.languages && signals.languages.length === 0) flags.push('no_languages_reported');
    return flags;
  }

  async recordFingerprint(userId: string, signals: ClientFingerprintSignals, ipAddress: string, userAgent: string) {
    const fingerprintHash = this.computeHash(signals);
    const tamperFlags = this.detectTamperFlags(signals);

    await this.prisma.deviceFingerprint.create({
      data: {
        userId,
        fingerprintHash,
        rawSignals: signals as any,
        ipAddress,
        userAgent: userAgent.slice(0, 500),
        tamperFlags,
      },
    });

    return { fingerprintHash, tamperFlags };
  }

  /** Other user IDs that have ever logged in with the exact same device fingerprint hash — the core multi-account signal. */
  async findLinkedAccounts(userId: string): Promise<string[]> {
    const own = await this.prisma.deviceFingerprint.findMany({ where: { userId }, select: { fingerprintHash: true } });
    const hashes = [...new Set(own.map((f) => f.fingerprintHash))];
    if (hashes.length === 0) return [];

    const matches = await this.prisma.deviceFingerprint.findMany({
      where: { fingerprintHash: { in: hashes }, userId: { not: userId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return matches.map((m) => m.userId);
  }

  /** Distinct OTHER users who logged in from any of this user's recent IPs — the VPN/proxy-adjacent heuristic. */
  async countSharedIpUsers(userId: string): Promise<number> {
    const since = new Date(Date.now() - SHARED_IP_WINDOW_DAYS * 86_400_000);
    const ownIps = await this.prisma.deviceFingerprint.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { ipAddress: true },
      distinct: ['ipAddress'],
    });
    if (ownIps.length === 0) return 0;

    const others = await this.prisma.deviceFingerprint.findMany({
      where: { ipAddress: { in: ownIps.map((i) => i.ipAddress) }, userId: { not: userId }, createdAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return others.length;
  }

  async getRecentTamperFlags(userId: string): Promise<string[]> {
    const recent = await this.prisma.deviceFingerprint.findMany({
      where: { userId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select: { tamperFlags: true },
    });
    return [...new Set(recent.flatMap((r) => r.tamperFlags))];
  }

  isSharedIpSuspicious(count: number): boolean {
    return count >= SHARED_IP_ACCOUNT_THRESHOLD;
  }
}
