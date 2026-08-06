import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

export interface OAuthProfile {
  provider: 'google' | 'discord';
  providerUserId: string;
  email: string;
  fullName?: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const clientId = config.get<string>('google.clientId');
    const clientSecret = config.get<string>('google.clientSecret');
    const callbackURL = config.get<string>('google.callbackUrl');
    super({
      clientID: clientId || 'oauth-not-configured',
      clientSecret: clientSecret || '',
      callbackURL,
      scope: ['email', 'profile'],
    });
    this.configured = Boolean(clientId && clientSecret);
  }

  authenticate(req: any, options?: any): any {
    if (!this.configured) {
      throw new ServiceUnavailableException('Google sign-in is not configured on this server.');
    }
    return super.authenticate(req, options);
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error('Google account has no email'), undefined);
    }

    const oauthProfile: OAuthProfile = {
      provider: 'google',
      providerUserId: profile.id,
      email,
      fullName: profile.displayName,
    };

    done(null, oauthProfile);
  }
}
