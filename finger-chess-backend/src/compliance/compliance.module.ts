import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { AgeService } from './age.service';
import { RulesService } from './rules.service';

@Module({
  controllers: [ComplianceController],
  providers: [AgeService, RulesService],
  exports: [AgeService, RulesService],
})
export class ComplianceModule {}
