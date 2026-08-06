import { Module } from '@nestjs/common';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminGamesController } from './games/admin-games.controller';
import { AdminGamesService } from './games/admin-games.service';
import { AdminReportsController } from './reports/admin-reports.controller';
import { AdminReportsService } from './reports/admin-reports.service';
import { AdminSupportController } from './support/admin-support.controller';
import { AdminSupportService } from './support/admin-support.service';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminDashboardService } from './dashboard/admin-dashboard.service';
import { AdminRolesController } from './roles/admin-roles.controller';
import { AdminFairPlayController } from './fairplay/admin-fairplay.controller';
import { AdminFairPlayService } from './fairplay/admin-fairplay.service';
import { AdminPresenceController } from './presence/admin-presence.controller';
import { SocialModule } from '../social/social.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [NotificationsModule, WalletModule, SecurityModule, SocialModule],
  controllers: [
    AdminUsersController,
    AdminGamesController,
    AdminReportsController,
    AdminSupportController,
    AdminDashboardController,
    AdminRolesController,
    AdminFairPlayController,
    AdminPresenceController,
  ],
  providers: [
    AdminUsersService,
    AdminGamesService,
    AdminReportsService,
    AdminSupportService,
    AdminDashboardService,
    AdminFairPlayService,
  ],
})
export class AdminModule {}
