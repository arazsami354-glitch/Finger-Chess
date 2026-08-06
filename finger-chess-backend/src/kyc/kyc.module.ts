import { Module } from '@nestjs/common';
import { KycController, AdminKycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { UploadModule } from '../upload/upload.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ComplianceModule } from '../compliance/compliance.module';

@Module({
  imports: [UploadModule, NotificationsModule, ComplianceModule],
  controllers: [KycController, AdminKycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
