import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { PresenceService } from '../../social/presence/presence.service';

/**
 * Live presence for the admin dashboard. Read-only, REST-polled by the
 * admin frontend (which intentionally has no WebSocket client). All reads go
 * through PresenceService.getAdminOverview — bounded scans, no full-table
 * iteration. Admins see real statuses including invisible (that's the point
 * of an ops view), so no privacy masking is applied here.
 */
@Controller('admin/presence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
export class AdminPresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get('overview')
  getOverview() {
    return this.presence.getAdminOverview();
  }
}
