import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { AdminReportsService } from './admin-reports.service';

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('finance_admin', 'super_admin')
export class AdminReportsController {
  constructor(private readonly service: AdminReportsService) {}

  @Get('revenue')
  getRevenue(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getRevenueSummary(from, to);
  }

  @Get('revenue/series')
  getRevenueSeries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getRevenueTimeSeries(from, to);
  }

  @Get('commission/by-tier')
  getCommissionByTier(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getCommissionByTier(from, to);
  }

  @Get('deposits-withdrawals')
  getDepositsWithdrawals(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getDepositsWithdrawalsSummary(from, to);
  }
}
