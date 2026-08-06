import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DeviceFingerprintService } from './device-fingerprint.service';
import { RiskScoreService } from './risk-score.service';
import { SubmitFingerprintDto } from './dto/security-requests.dto';

@Controller('security')
@UseGuards(JwtAuthGuard)
export class SecurityController {
  constructor(private readonly fingerprint: DeviceFingerprintService) {}

  /**
   * Called by the frontend once per session, right after login — fire-and-
   * forget from the client's perspective, never blocks or gates access on
   * its own. The signal this produces only matters in aggregate, across
   * many logins over time, not as a single login-time gate that would
   * lock someone out over one unusual reading.
   */
  @Post('fingerprint')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@CurrentUser() user: { userId: string }, @Body() dto: SubmitFingerprintDto, @Req() req: Request) {
    return this.fingerprint.recordFingerprint(user.userId, dto, req.ip ?? 'unknown', req.headers['user-agent'] ?? 'unknown');
  }
}

@Controller('admin/security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('finance_admin', 'super_admin') // risk data touches the same sensitivity tier as fraud signals and KYC
export class AdminSecurityController {
  constructor(private readonly riskScore: RiskScoreService) {}

  @Get('high-risk-users')
  listHighRisk(@Query('take') take?: string) {
    return this.riskScore.listHighRiskUsers(take ? Number(take) : undefined);
  }

  @Get('risk-score/:userId')
  getScore(@Param('userId') userId: string, @Query('refresh') refresh?: string) {
    return this.riskScore.getScore(userId, refresh === 'true');
  }
}
