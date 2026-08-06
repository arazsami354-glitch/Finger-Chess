import { io, Socket } from 'socket.io-client';
import { getAccessToken, refreshAccessToken } from './api';

const SOCKET_BASE = process.env.NEXT_PUBLIC_FINGER_CHESS_WS_URL ?? 'http://localhost:3000';

export function createNamespaceSocket(namespace: '/game' | '/matchmaking' | '/social'): Socket {
  const socket = io(`${SOCKET_BASE}${namespace}`, {
    auth: { token: getAccessToken() },
    // websocket preferred; polling fallback keeps sockets alive through
    // proxies/ingress that block or delay the WS upgrade.
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  // The token in `auth` is snapshotted at connect time (~15 min expiry). On a
  // reconnect after a network blip the server would reject the stale token and
  // the socket would die silently mid-match/queue. On connect_error, refresh
  // the token and force a fresh handshake — bounded so a persistently rejected
  // socket can't spin in a tight reconnect loop.
  let connectErrors = 0;
  socket.on('connect', () => {
    connectErrors = 0;
  });
  socket.on('connect_error', async () => {
    if (connectErrors >= 2) {
      socket.disconnect();
      return;
    }
    connectErrors++;
    try {
      const newToken = await refreshAccessToken();
      if (newToken) {
        socket.auth = { token: getAccessToken() };
        socket.disconnect();
        socket.connect();
      } else {
        socket.disconnect();
      }
    } catch {
      socket.disconnect();
    }
  });

  return socket;
}
