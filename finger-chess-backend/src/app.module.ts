import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';

import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './mail/mail.module';
import { AdminAuditModule } from './admin/audit/admin-audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { GameModule } from './game/game.module';
import { MatchmakingModule } from './matchmaking/matchmaking.module';
import { PaymentModule } from './payment/payment.module';
import { UploadModule } from './upload/upload.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SupportModule } from './support/support.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health/health.controller';
import { SocialRealtimeModule } from './social/realtime/social-realtime.module';
import { SocialModule } from './social/social.module';
import { ComplianceModule } from './compliance/compliance.module';
import { KycModule } from './kyc/kyc.module';
import { SecurityModule } from './security/security.module';
import { TournamentModule } from './tournament/tournament.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),

    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        // Secrets must never reach request logs: the access token header, the
        // password body, the refresh-token cookie, and any legacy
        // `?token=`-style socket token in the URL query string.
        redact: [
          'req.headers.authorization',
          'req.body.password',
          'req.headers.cookie',
          'req.query.token',
        ],
      },
    }),

    // Global rate limiting: 100 requests / 60s per IP by default.
    // Individual controllers (auth, withdrawals) override this with stricter limits.
    // Reads the FINGER_CHESS_ prefixed vars (matching .env.example and the
    // k8s ConfigMap) — the unprefixed THROTTLE_TTL/LIMIT names were never set
    // anywhere, so the configured limits were silently ignored in production.
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.FINGER_CHESS_THROTTLE_TTL ?? 60) * 1000,
        limit: Number(process.env.FINGER_CHESS_THROTTLE_LIMIT ?? 100),
      },
    ]),

    PrismaModule,
    RedisModule,
    SocialRealtimeModule,
    MailModule,
    AdminAuditModule,
    AuthModule,
    UsersModule,
    WalletModule,
    GameModule,
    MatchmakingModule,
    TournamentModule,
    PaymentModule,
    UploadModule,
    NotificationsModule,
    SupportModule,
    AdminModule,
    SocialModule,
    ComplianceModule,
    KycModule,
    SecurityModule,
  ],
  controllers: [HealthController],
  providers: [
    // Applies rate limiting to every route unless overridden with @SkipThrottle().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
