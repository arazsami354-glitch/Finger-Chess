import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-discord';
import { ConfigService } from '@nestjs/config';
import { OAuthProfile } from './google.strategy';

@Injectable()
export class DiscordStrategy extends PassportStrategy(Strategy, 'discord') {
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const clientId = config.get<string>('discord.clientId');
    const clientSecret = config.get<string>('discord.clientSecret');
    const callbackURL = config.get<string>('discord.callbackUrl');
    super({
      clientID: clientId || 'oauth-not-configured',
      clientSecret: clientSecret || '',
      callbackURL,
      scope: ['identify', 'email'],
    });
    this.configured = Boolean(clientId && clientSecret);
  }

  authenticate(req: any, options?: any): any {
    if (!this.configured) {
      throw new ServiceUnavailableException('Discord sign-in is not configured on this server.');
    }
    return super.authenticate(req, options);
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: (err: any, user: any) => void) {
    if (!profile.email) {
      return done(new Error('Discord account has no verified email'), undefined);
    }

    const oauthProfile: OAuthProfile = {
      provider: 'discord',
      providerUserId: profile.id,
      email: profile.email,
      fullName: profile.username,
    };

    done(null, oauthProfile);
  }
}
