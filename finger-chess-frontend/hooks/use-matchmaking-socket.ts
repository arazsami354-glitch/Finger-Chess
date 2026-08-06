'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { createNamespaceSocket } from '@/lib/socket';

export type QueueState = 'idle' | 'queued' | 'matched' | 'timeout';
export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

function qualityFromRtt(ms: number): ConnectionQuality {
  if (ms < 100) return 'excellent';
  if (ms < 200) return 'good';
  if (ms < 400) return 'fair';
  return 'poor';
}

export function useMatchmakingSocket() {
  const socketRef = useRef<Socket | null>(null);
  const queuedRef = useRef(false);
  const [state, setState] = useState<QueueState>('idle');
  const [room, setRoom] = useState<string | null>(null);
  const [matchedGameId, setMatchedGameId] = useState<string | null>(null);
  const [queuedSince, setQueuedSince] = useState<number | null>(null);
  const [estimatedWaitSeconds, setEstimatedWaitSeconds] = useState<number | null>(null);
  const [currentRatingBand, setCurrentRatingBand] = useState<number | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>('unknown');
  const [pingMs, setPingMs] = useState<number | null>(null);

  useEffect(() => {
    const socket = createNamespaceSocket('/matchmaking');
    socketRef.current = socket;

    socket.on('queued', (data: { room: string; estimatedWaitSeconds?: number; currentRatingBand?: number }) => {
      queuedRef.current = true;
      setState('queued');
      setRoom(data.room);
      setQueuedSince(Date.now());
      if (data.estimatedWaitSeconds !== undefined) setEstimatedWaitSeconds(data.estimatedWaitSeconds);
      if (data.currentRatingBand !== undefined) setCurrentRatingBand(data.currentRatingBand);
    });

    // Live updates while queued — pushed on every heartbeat, computed from
    // the ACTUAL elapsed wait time server-side, not just the value seen at
    // the moment of joining. This is what makes the searching screen feel
    // alive rather than a static number.
    socket.on('queueStatus', (data: { currentRatingBand: number; estimatedWaitSeconds: number }) => {
      setCurrentRatingBand(data.currentRatingBand);
      setEstimatedWaitSeconds(data.estimatedWaitSeconds);
    });

    socket.on('matchFound', (data: { gameId: string }) => {
      queuedRef.current = false;
      setState('matched');
      setMatchedGameId(data.gameId);
    });

    socket.on('queueTimeout', () => {
      queuedRef.current = false;
      setState('timeout');
      setQueuedSince(null);
    });

    socket.on('queueCancelled', () => {
      queuedRef.current = false;
      setState('idle');
      setQueuedSince(null);
    });

    // Connection quality — a lightweight round-trip echo, independent of
    // matchmaking state itself (useful to see even before joining a queue).
    socket.on('pong', (data: { t: number }) => {
      const rtt = Date.now() - data.t;
      setPingMs(rtt);
      setConnectionQuality(qualityFromRtt(rtt));
    });

    // Heartbeat only while actually queued — it exists to keep the server-side
    // presence key alive so this user stays a viable match candidate, which is
    // meaningless (and costs a Redis round-trip) when not in a queue. The ping
    // loop is state-independent since it powers the connection-quality meter,
    // but is paused while the tab is hidden (an invisible user has no meter to
    // update) and resumed on reveal.
    const heartbeat = setInterval(() => {
      if (queuedRef.current) socket.emit('heartbeat');
    }, 5000);
    const ping = () => {
      if (document.visibilityState === 'visible') socket.emit('ping', { t: Date.now() });
    };
    const pingLoop = setInterval(ping, 4000);
    const onPingVisibility = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onPingVisibility);
    socket.emit('ping', { t: Date.now() }); // measure immediately on connect rather than waiting for the first interval tick

    return () => {
      clearInterval(heartbeat);
      clearInterval(pingLoop);
      document.removeEventListener('visibilitychange', onPingVisibility);
      socket.disconnect();
    };
  }, []);

  const joinQueue = useCallback(
    (timeControlId: string, entryFee: number, opts?: { rated?: boolean; colorPreference?: 'random' | 'white' | 'black' }) => {
      // If the socket isn't ready the emit would silently no-op and the user
      // would stare at a settings form that does nothing. Return false so
      // callers can surface a real error instead of dead-clicking.
      if (!socketRef.current) return false;
      socketRef.current.emit('joinQueue', { timeControlId, entryFee, rated: opts?.rated ?? true, colorPreference: opts?.colorPreference ?? 'random' });
      return true;
    },
    [],
  );

  const cancelQueue = useCallback(() => {
    socketRef.current?.emit('cancelQueue');
    setState('idle');
    setEstimatedWaitSeconds(null);
    setCurrentRatingBand(null);
  }, []);

  return {
    state,
    room,
    matchedGameId,
    queuedSince,
    estimatedWaitSeconds,
    currentRatingBand,
    connectionQuality,
    pingMs,
    joinQueue,
    cancelQueue,
  };
}
