import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadModule } from '../upload/upload.module';
import { FriendsController } from './friends/friends.controller';
import { FriendsService } from './friends/friends.service';
import { AvatarResolverService } from './friends/avatar-resolver.service';
import { MessagingController } from './messaging/messaging.controller';
import { MessagingService } from './messaging/messaging.service';
import { MessageEncryptionService } from './messaging/util/message-encryption.service';
import { PresenceService } from './presence/presence.service';
import { PresenceController } from './presence/presence.controller';
import { ModerationService } from './moderation/moderation.service';
import { ReportService } from './moderation/report.service';
import { ReportController, AdminReportController } from './moderation/report.controller';
import { AchievementsService } from './achievements/achievements.service';
import { PlayerProfileController } from './profile/player-profile.controller';
import { ProfileStatsService } from './profile/profile-stats.service';
import { ProfileStatsController } from './profile/profile-stats.controller';
import { PrivacySettingsController } from './privacy/privacy-settings.controller';
import { SocialGateway } from './social.gateway';
import { MatchInvitationsController } from './invitations/match-invitations.controller';
import { MatchInvitationsService } from './invitations/match-invitations.service';

@Module({
  imports: [JwtModule.register({}), NotificationsModule, UploadModule],
  controllers: [
    FriendsController,
    MessagingController,
    ReportController,
    AdminReportController,
    PlayerProfileController,
    ProfileStatsController,
    PrivacySettingsController,
    PresenceController,
    MatchInvitationsController,
  ],
  providers: [
    FriendsService,
    AvatarResolverService,
    MessagingService,
    MessageEncryptionService,
    PresenceService,
    ModerationService,
    ReportService,
    AchievementsService,
    ProfileStatsService,
    SocialGateway,
    MatchInvitationsService,
  ],
  exports: [FriendsService, MessagingService, PresenceService, AchievementsService],
})
export class SocialModule {}
