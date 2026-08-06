import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
    });
  }

  // Whatever is returned here becomes `request.user`.
  async validate(payload: JwtPayload) {
    // SECURITY FIX: without this check, banning or suspending a user only
    // revoked their refresh tokens — their currently-held ACCESS token
    // stayed valid for up to its full 15-minute lifetime regardless, since
    // access tokens are stateless JWTs verified by signature alone. That's
    // a real window where a just-banned user (or a hijacked, since-banned
    // account) can keep acting on the platform. AdminUsersService.ban/
    // suspend/reactivate now maintain a lightweight Redis flag checked on
    // every single authenticated request — one cheap GET, no DB round trip,
    // and it closes the gap to effectively immediate instead of "eventually,
    // once every outstanding access token happens to expire."
    const isRevoked = await this.redis.get(`user:revoked:${payload.sub}`);
    if (isRevoked) {
      throw new UnauthorizedException('This account no longer has access');
    }

    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
