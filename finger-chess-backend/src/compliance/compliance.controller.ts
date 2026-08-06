import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AgeService } from './age.service';
import { RulesService } from './rules.service';
import { SubmitAgeDto } from './dto/compliance-requests.dto';

@Controller('compliance')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(
    private readonly ageService: AgeService,
    private readonly rulesService: RulesService,
  ) {}

  @Get('age')
  getAgeStatus(@CurrentUser() user: { userId: string }) {
    return this.ageService.getStatus(user.userId);
  }

  @Post('age')
  submitAge(@CurrentUser() user: { userId: string }, @Body() dto: SubmitAgeDto) {
    return this.ageService.submitDateOfBirth(user.userId, dto.dateOfBirth);
  }

  @Get('rules')
  getRules(@CurrentUser() user: { userId: string }) {
    return this.rulesService.getRulesForUser(user.userId);
  }

  @Post('rules/accept')
  acceptRules(@CurrentUser() user: { userId: string }, @Req() req: Request) {
    return this.rulesService.acceptRules(user.userId, req.ip);
  }
}
