import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_RULES_SECTIONS } from './rules-content';

@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get currentVersion(): string {
    return this.config.get<string>('compliance.platformRulesVersion')!;
  }

  async getRulesForUser(userId: string) {
    const acceptance = await this.prisma.ruleAcceptance.findUnique({
      where: { userId_version: { userId, version: this.currentVersion } },
    });
    return {
      version: this.currentVersion,
      sections: PLATFORM_RULES_SECTIONS,
      hasAcceptedCurrentVersion: acceptance !== null,
      acceptedAt: acceptance?.acceptedAt ?? null,
      penalties: {
        cheatingSuspensionHours: this.config.get<number>('compliance.penaltyCheatingSuspensionHours')!,
        chatAbuseMuteHours: this.config.get<number>('compliance.penaltyChatAbuseMuteHours')!,
      },
    };
  }

  async hasAcceptedCurrentVersion(userId: string): Promise<boolean> {
    const acceptance = await this.prisma.ruleAcceptance.findUnique({
      where: { userId_version: { userId, version: this.currentVersion } },
    });
    return acceptance !== null;
  }

  async acceptRules(userId: string, ipAddress?: string) {
    // Idempotent — accepting the same version twice (a double-click, a
    // retried request) just returns the existing row rather than erroring.
    return this.prisma.ruleAcceptance.upsert({
      where: { userId_version: { userId, version: this.currentVersion } },
      create: { userId, version: this.currentVersion, ipAddress },
      update: {},
    });
  }

  /** Used by the gating guard applied to matchmaking/messaging/wallet actions. */
  async assertAccepted(userId: string): Promise<void> {
    const accepted = await this.hasAcceptedCurrentVersion(userId);
    if (!accepted) {
      throw new ForbiddenException('You must read and accept the platform rules before continuing');
    }
  }
}
