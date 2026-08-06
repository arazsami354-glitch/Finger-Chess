import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { StripeProvider } from './providers/stripe.provider';
import { WalletModule } from '../wallet/wallet.module';
import { KycModule } from '../kyc/kyc.module';
import { ComplianceModule } from '../compliance/compliance.module';

@Module({
  imports: [WalletModule, KycModule, ComplianceModule],
  controllers: [PaymentController],
  providers: [PaymentService, StripeProvider],
})
export class PaymentModule {}
