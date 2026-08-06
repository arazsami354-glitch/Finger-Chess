import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import * as express from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisIoAdapter } from './common/ws/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Structured logging (nestjs-pino) replaces the default Nest logger.
  app.useLogger(app.get(Logger));

  // Socket.IO's Redis adapter — required for the /game and /matchmaking
  // gateways to correctly broadcast across more than one backend instance.
  // See redis-io.adapter.ts for the full explanation of what this does and
  // doesn't solve.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Trust the first hop reverse proxy (nginx/ALB/Cloudflare) so req.ip
  // resolves to the real client address rather than the proxy's own IP.
  // Without this, every rate limiter, fraud-detection IP check, and
  // security_logs entry in this codebase would silently record the load
  // balancer's IP for every single request — a real gap, not a cosmetic one.
  // Set to the actual number of trusted hops in front of this service in
  // production (1 for a single reverse proxy); never `true` (trusts any
  // X-Forwarded-For header verbatim, which lets a client spoof its own IP).
  app.getHttpAdapter().getInstance().set('trust proxy', Number(process.env.FINGER_CHESS_TRUST_PROXY_HOPS ?? 1));

  // Security headers, with an explicit CSP rather than helmet's permissive
  // default — this is an API server with no HTML views of its own, so the
  // policy is deliberately locked down to "nothing renders here."
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Needed to read the httpOnly refresh-token cookie (see auth.controller.ts)
  // — cookie-parser populates req.cookies from the raw Cookie header.
  app.use(cookieParser());

  // Response compression — gzip/brotli negotiated automatically per client.
  // Skips the Stripe webhook (compressing a body we only ever read, never
  // re-serve, buys nothing) and anything under 1KB, where compression
  // overhead exceeds the savings (e.g. a single wallet balance response).
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => !req.path.includes('/deposit/webhook') && compression.filter(req, res),
    }),
  );

  // Stripe webhook signature verification needs the RAW request body.
  // CRITICAL ORDERING: this must be registered BEFORE the general
  // express.json()/urlencoded() parsers below. Express runs body-parsing
  // middleware in registration order regardless of path specificity — if
  // the general JSON parser (mounted at '/', matching every path) ran
  // first, it would consume and parse the webhook's body before this
  // path-scoped raw parser ever saw it, silently breaking Stripe's
  // signature verification (which needs the exact original byte sequence,
  // not a re-serialized JSON.parse/stringify round-trip of it).
  app.use('/api/v1/payments/deposit/webhook', express.raw({ type: 'application/json' }));

  // Explicit body size limit — small enough that no legitimate request
  // (chess moves, DTOs, JSON payloads) ever approaches it, and small enough
  // that a flood of oversized bodies can't be used to exhaust memory/CPU
  // before validation even runs. File uploads go through multer's own
  // limit (see upload.controller.ts), not this parser. Applied AFTER the
  // webhook's raw parser above, for the ordering reason explained there.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // CORS — no wildcard fallback. `credentials: true` combined with
  // `origin: '*'` is actually rejected by browsers anyway (the spec
  // disallows a wildcard origin alongside credentialed requests), but more
  // importantly: an unset CORS_ORIGINS in production should fail loudly,
  // not silently open the API to every origin on the internet.
  const allowedOrigins = process.env.FINGER_CHESS_CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  if (!allowedOrigins || allowedOrigins.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FINGER_CHESS_CORS_ORIGINS must be set to an explicit comma-separated origin list in production');
    }
  }
  app.enableCors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : ['http://localhost:3001', 'http://localhost:5174'],
    credentials: true,
  });

  // Secrets — refuse to boot in production with placeholder or unset secrets.
  // The committed .env ships 'change_me_*' / '_xxx' placeholders, so a deploy
  // that forgets to override them would otherwise start with publicly-known
  // signing keys: instantly forgeable JWTs, decryptable messages, and a Stripe
  // account that accepts anything. Same fail-loud philosophy as the CORS check.
  if (process.env.NODE_ENV === 'production') {
    const secretEnvVars = [
      'FINGER_CHESS_JWT_ACCESS_SECRET',
      'FINGER_CHESS_JWT_REFRESH_SECRET',
      'FINGER_CHESS_MESSAGE_ENCRYPTION_KEY',
      'FINGER_CHESS_STRIPE_SECRET_KEY',
      'FINGER_CHESS_STRIPE_WEBHOOK_SECRET',
    ];
    for (const name of secretEnvVars) {
      const value = process.env[name] ?? '';
      if (!value || value.includes('change_me') || value.endsWith('_xxx')) {
        throw new Error(`${name} must be set to a real secret in production (refusing to start with a placeholder)`);
      }
    }
  }

  // Global validation: every DTO is validated & unknown properties stripped.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter: consistent error shape, no leaking stack traces.
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });

  // Graceful shutdown: on SIGTERM/SIGINT (k8s pod termination, `docker stop`,
  // Ctrl-C) Nest runs every provider's lifecycle hooks — PrismaService
  // $disconnect() (DB pool), RedisService disconnect() — and closes the HTTP
  // server so in-flight requests finish instead of being hard-killed mid-
  // response. Without this, a RollingUpdate rollout would cut responses and
  // WebSocket handshakes off mid-write on every replaced pod.
  app.enableShutdownHooks();

  // The RedisIoAdapter owns its own pub/sub clients (not a Nest provider), so
  // its cleanup is wired here rather than through the lifecycle hooks above.
  const shutdown = () => redisIoAdapter.disconnectClients();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
