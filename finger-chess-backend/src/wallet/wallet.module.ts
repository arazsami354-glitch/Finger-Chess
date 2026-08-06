import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController, AdminWalletController } from './wallet.controller';
import { FraudService } from './fraud/fraud.service';
import { AccountingService } from './accounting/accounting.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ComplianceModule, NotificationsModule],
  controllers: [WalletController, AdminWalletController],
  providers: [WalletService, FraudService, AccountingService],
  exports: [WalletService, FraudService, AccountingService],
})
export class WalletModule {}
