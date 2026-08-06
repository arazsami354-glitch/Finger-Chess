import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtPayload, JwtPayloadWithRefreshToken } from '../interfaces/jwt-payload.interface';
import { REFRESH_COOKIE_NAME } from '../refresh-cookie.util';

function extractFromCookie(req: Request): string | null {
  return req.cookies?.[REFRESH_COOKIE_NAME] ?? null;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractFromCookie]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<JwtPayloadWithRefreshToken> {
    const refreshToken = extractFromCookie(req)!;
    // Map payload.sub -> userId exactly like the access strategy does; the
    // controller relies on request.user.userId being populated (this was the
    // root cause of /auth/refresh 500ing: an undefined userId).
    return { userId: payload.sub, email: payload.email, role: payload.role, refreshToken };
  }
}
