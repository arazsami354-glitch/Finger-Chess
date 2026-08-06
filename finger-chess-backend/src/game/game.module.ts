import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { GamesController } from './games.controller';
import { ChessEngineService } from './engine/chess-engine.service';
import { StockfishService } from './engine/stockfish.service';
import { AnticheatService } from './anticheat/anticheat.service';
import { RatingService } from './rating.service';
import { WalletModule } from '../wallet/wallet.module';
import { SocialModule } from '../social/social.module';
import { SecurityModule } from '../security/security.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [JwtModule.register({}), WalletModule, SocialModule, SecurityModule, NotificationsModule],
  controllers: [GamesController],
  providers: [GameGateway, GameService, ChessEngineService, StockfishService, AnticheatService, RatingService],
  exports: [GameService, RatingService],
})
export class GameModule {}
