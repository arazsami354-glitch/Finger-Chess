import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PresenceService } from './presence.service';

const MAX_IDS_PER_REQUEST = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bulk live presence for an arbitrary set of users — used by pages that show
 * players who are not necessarily the requester's friends (tournament
 * rosters, match opponents). Privacy-aware: showOnlineStatus=false and
 * blocked users resolve to offline/no-lastSeen, invisible is masked to
 * offline, and the requester's own id always returns the truth.
 */
@Controller('social/presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  async getBulk(@CurrentUser() user: { userId: string }, @Query('ids') ids: string | string[]) {
    const raw = Array.isArray(ids) ? ids : ids?.split(',');
    const valid = (raw ?? [])
      .map((id) => id?.trim())
      .filter((id): id is string => !!id && UUID_RE.test(id))
      .slice(0, MAX_IDS_PER_REQUEST);

    if (valid.length === 0) return {};

    return this.presence.getBulkPresence(valid, user.userId);
  }
}
