import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }

  @Get('logs/admin')
  @Roles('super_admin')
  getAdminLogs(@Query('adminId') adminId?: string, @Query('targetType') targetType?: string) {
    return this.service.getAdminLogs({ adminId, targetType });
  }

  @Get('logs/security')
  @Roles('super_admin')
  getSecurityLogs(@Query('userId') userId?: string, @Query('eventType') eventType?: string) {
    return this.service.getSecurityLogs({ userId, eventType });
  }
}
