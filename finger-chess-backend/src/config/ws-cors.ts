/**
 * Socket.IO's `cors` option is evaluated independently of Nest's HTTP CORS
 * config in main.ts, so it needs its own explicit allow-list rather than
 * inheriting one. Previously both gateways used `origin: '*'`, which lets
 * any website on the internet open an authenticated WebSocket connection to
 * a logged-in user's browser session (the JWT is supplied by the client's
 * own JS, but a malicious page could still trick a user into connecting
 * under conditions that leak timing/behavioral info, or simply abuse an
 * open relay for connection-flooding). Locked down the same way the HTTP
 * CORS config is.
 */
export const WS_CORS_ORIGINS: string[] =
  process.env.FINGER_CHESS_CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? ['http://localhost:3001', 'http://localhost:5174'];
