import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

// A small representative seed list — a production deployment should load
// this from a maintained external list/service (e.g. an actual profanity-
// detection API) and support per-locale lists; hardcoding is a placeholder
// for the filtering LOGIC, not a claim that this list is complete.
const PROFANITY_SEED = ['badword1', 'badword2', 'slur1'];

const DUPLICATE_MESSAGE_WINDOW_SEC = 30;
const FLOOD_WINDOW_SEC = 10;
const FLOOD_MAX_MESSAGES = 8; // beyond this in the window, treat as flooding

export interface ModerationResult {
  allowed: boolean;
  flagged: boolean;
  reason?: string;
  filteredContent?: string;
}

@Injectable()
export class ModerationService {
  private readonly profanityPattern: RegExp;

  constructor(private readonly redis: RedisService) {
    this.profanityPattern = new RegExp(`\\b(${PROFANITY_SEED.join('|')})\\b`, 'gi');
  }

  /**
   * Runs before a message is ever persisted. Distinguishes "flag for
   * review but still deliver" (profanity — censored but sent, matching
   * how most modern chat platforms actually behave, since over-blocking
   * ordinary conversation erodes trust fast) from "reject outright"
   * (flooding — this one actually can't be allowed through at all, since
   * the whole point is protecting the recipient and the database from a
   * burst of messages).
   */
  async checkMessage(senderId: string, content: string): Promise<ModerationResult> {
    const floodCheck = await this.checkFlooding(senderId);
    if (!floodCheck.allowed) return floodCheck;

    const duplicateCheck = await this.checkDuplicate(senderId, content);
    if (!duplicateCheck.allowed) return duplicateCheck;

    const hasProfanity = this.profanityPattern.test(content);
    this.profanityPattern.lastIndex = 0; // reset global-flag regex state between calls

    if (hasProfanity) {
      return {
        allowed: true,
        flagged: true,
        reason: 'profanity_filtered',
        filteredContent: content.replace(this.profanityPattern, (match) => '*'.repeat(match.length)),
      };
    }

    return { allowed: true, flagged: false };
  }

  private async checkFlooding(senderId: string): Promise<ModerationResult> {
    const key = `moderation:flood:${senderId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, FLOOD_WINDOW_SEC);

    if (count > FLOOD_MAX_MESSAGES) {
      return { allowed: false, flagged: true, reason: 'message_flooding' };
    }
    return { allowed: true, flagged: false };
  }

  private async checkDuplicate(senderId: string, content: string): Promise<ModerationResult> {
    const normalized = content.trim().toLowerCase();
    const key = `moderation:last_msg:${senderId}`;
    const last = await this.redis.get(key);

    if (last === normalized) {
      return { allowed: false, flagged: true, reason: 'duplicate_message' };
    }

    await this.redis.set(key, normalized, 'EX', DUPLICATE_MESSAGE_WINDOW_SEC);
    return { allowed: true, flagged: false };
  }
}
