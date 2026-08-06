import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameModule } from '../game/game.module';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuditModule } from '../admin/audit/admin-audit.module';
import { TournamentRepository } from './tournament.repository';
import { TournamentBootstrapService } from './tournament-bootstrap.service';
import { TournamentService } from './tournament.service';
import { TournamentScheduler } from './tournament.scheduler';
import { TournamentController } from './tournament.controller';
import { AdminTournamentController } from './admin-tournament.controller';

@Module({
  imports: [JwtModule.register({}), GameModule, WalletModule, NotificationsModule, AdminAuditModule],
  controllers: [TournamentController, AdminTournamentController],
  providers: [
    TournamentRepository,
    TournamentBootstrapService,
    TournamentService,
    TournamentScheduler,
  ],
  exports: [TournamentService],
})
export class TournamentModule {}
