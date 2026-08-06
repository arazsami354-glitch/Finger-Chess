import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { RedisService } from '../../redis/redis.service';

/**
 * Verifies the JWT carried in the socket handshake auth payload, checks the
 * Redis ban/suspend revocation key, then binds the userId onto the socket's
 * data. Returns the userId on success, or null after emitting 'Authentication
 * failed' and force-disconnecting the socket.
 *
 * Shared by every gateway so the three copies can't drift: the token must
 * only ever travel via `handshake.auth` (never the URL query string, which
 * ends up in proxy/access logs), and a since-banned user must lose socket
 * access immediately — matching the HTTP path (see JwtStrategy) — rather
 * than keeping the socket alive for the token's remaining lifetime.
 */
export async function authenticateSocket(
  client: Socket,
  jwt: JwtService,
  config: ConfigService,
  redis: RedisService,
): Promise<string | null> {
  try {
    const token = client.handshake.auth?.token;
    const payload = await jwt.verifyAsync(token as string, {
      secret: config.get<string>('jwt.accessSecret'),
    });
    const revoked = await redis.get(`user:revoked:${payload.sub}`);
    if (revoked) throw new Error('revoked');
    client.data.userId = payload.sub;
    return payload.sub as string;
  } catch {
    client.emit('error', { message: 'Authentication failed' });
    client.disconnect(true);
    return null;
  }
}
