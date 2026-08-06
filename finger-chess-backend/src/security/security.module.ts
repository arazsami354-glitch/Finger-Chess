import { Module } from '@nestjs/common';
import { SecurityController, AdminSecurityController } from './security.controller';
import { DeviceFingerprintService } from './device-fingerprint.service';
import { BehaviorAnalysisService } from './behavior-analysis.service';
import { RiskScoreService } from './risk-score.service';
import { FairPlayAuditService } from './fairplay/fair-play-audit.service';
import { FairPlayDetectorService } from './fairplay/fair-play-detector.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule], // FraudService — the shared fraud_signals write path
  controllers: [SecurityController, AdminSecurityController],
  providers: [DeviceFingerprintService, BehaviorAnalysisService, RiskScoreService, FairPlayAuditService, FairPlayDetectorService],
  exports: [DeviceFingerprintService, RiskScoreService, FairPlayAuditService, FairPlayDetectorService],
})
export class SecurityModule {}
