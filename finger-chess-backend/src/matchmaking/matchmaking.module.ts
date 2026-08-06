import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingGateway } from './matchmaking.gateway';
import { MatchIntegrityService } from './integrity/match-integrity.service';
import { WalletModule } from '../wallet/wallet.module';
import { ComplianceModule } from '../compliance/compliance.module';

@Module({
  imports: [JwtModule.register({}), WalletModule, ComplianceModule],
  providers: [MatchmakingService, MatchmakingGateway, MatchIntegrityService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
