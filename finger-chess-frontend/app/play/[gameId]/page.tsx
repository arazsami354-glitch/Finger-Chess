'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Chess } from 'chess.js';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { useGameSocket } from '@/hooks/use-game-socket';
import { usePresence } from '@/hooks/use-presence';
import { PresenceDot } from '@/components/social/presence-dot';
import type { PresenceStatus } from '@/hooks/use-social-socket';
import { ChessBoard } from '@/components/chess/chess-board';
import { ChessClock } from '@/components/chess/clock';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Flag, Handshake, Download, WifiOff } from 'lucide-react';

const GAME_OVER_LABELS: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  draw_rule: 'Draw',
  draw_agreement: 'Draw by agreement',
  resignation: 'Resignation',
  timeout: 'Time forfeit',
  abandonment: 'Opponent abandoned',
};

export default function GameScreenPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [resignConfirmOpen, setResignConfirmOpen] = useState(false);

  const {
    gameState,
    lastMove,
    gameOver,
    drawOfferedByOpponent,
    moveError,
    waiting,
    opponentConnected,
    makeMove,
    offerDraw,
    respondDraw,
    resign,
  } = useGameSocket(params.gameId, 'play', user?.id);

  const myColor: 'white' | 'black' | null = useMemo(() => {
    if (!gameState || !user) return null;
    if (gameState.whitePlayerId === user.id) return 'white';
    if (gameState.blackPlayerId === user.id) return 'black';
    return null;
  }, [gameState, user]);

  const opponentId = useMemo(() => {
    if (!gameState || !myColor) return null;
    return myColor === 'white' ? gameState.blackPlayerId : gameState.whitePlayerId;
  }, [gameState, myColor]);

  const { statusFor } = usePresence(opponentId ? [opponentId] : null);
  const opponentPresence = opponentId ? statusFor(opponentId) : undefined;

  function handleMove(from: string, to: string, promotion?: string) {
    if (!gameState) return;
    try {
      const probe = new Chess(gameState.fen);
      const move = probe.move({ from, to, promotion: promotion ?? 'q' } as any);
      if (move) makeMove(move.san, gameState.moves.length);
    } catch {
      // Illegal from the client's own probe — the board's legal-move
      // filtering should already have prevented this click.
    }
  }

  if (waiting) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground">Waiting for your opponent to connect…</p>
        </div>
      </AppShell>
    );
  }

  if (!gameState) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24 text-muted-foreground font-mono text-sm">loading game…</div>
      </AppShell>
    );
  }

  const orientation = myColor ?? 'white';
  const isMyTurn = myColor && gameState.turn === (myColor === 'white' ? 'w' : 'b');

  return (
    <AppShell>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 max-w-5xl mx-auto">
        <div className="flex flex-col items-center gap-4">
          {!opponentConnected && (
            <div className="w-full flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
              <WifiOff className="h-4 w-4" /> Opponent disconnected — waiting for reconnect…
            </div>
          )}

          <ClockRow gameState={gameState} orientation={orientation} topColor={orientation === 'white' ? 'black' : 'white'} presenceStatus={opponentPresence} />

          <ChessBoard fen={gameState.fen} orientation={orientation} interactive={Boolean(isMyTurn && !gameOver)} lastMove={lastMove} gameOver={!!gameOver} onMove={handleMove} />

          <ClockRow gameState={gameState} orientation={orientation} topColor={orientation} />

          {moveError && <div className="text-sm text-destructive">{moveError}</div>}

          <div className="flex gap-3">
            <Button variant="outline" onClick={offerDraw} disabled={!!gameOver}>
              <Handshake className="h-4 w-4" /> Offer Draw
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setResignConfirmOpen(true)} disabled={!!gameOver}>
              <Flag className="h-4 w-4" /> Resign
            </Button>
          </div>

          {drawOfferedByOpponent && !gameOver && (
            <Card className="w-full border-gold/30 bg-gold/5">
              <CardContent className="pt-4 flex items-center justify-between">
                <span className="text-sm">Your opponent offered a draw.</span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respondDraw(true)}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => respondDraw(false)}>
                    Decline
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Move List</div>
              <div className="max-h-96 overflow-y-auto space-y-1 font-mono text-sm">
                {gameState.moves.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No moves yet.</p>
                ) : (
                  groupMoves(gameState.moves).map((pair) => (
                    <div key={pair.moveNumber} className="flex gap-3">
                      <span className="text-muted-foreground w-6">{pair.moveNumber}.</span>
                      <span className="flex-1">{pair.white}</span>
                      <span className="flex-1">{pair.black}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Button variant="outline" className="w-full" asChild>
            <a href={`/api/v1/games/${params.gameId}/pgn`} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> Export PGN
            </a>
          </Button>
        </div>
      </div>

      <Dialog open={resignConfirmOpen} onOpenChange={setResignConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resign this game?</DialogTitle>
            <DialogDescription>Your opponent will be awarded the win and the pot, minus commission. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResignConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resign();
                setResignConfirmOpen(false);
              }}
            >
              Confirm Resignation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!gameOver} onOpenChange={() => router.push('/dashboard')}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Game Over</DialogTitle>
            <DialogDescription>{gameOver ? GAME_OVER_LABELS[gameOver.reason] ?? gameOver.reason : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => router.push('/dashboard')}>
              Back to Dashboard
            </Button>
            <Button onClick={() => router.push('/lobby')}>Find Another Match</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ClockRow({
  gameState,
  orientation,
  topColor,
  presenceStatus,
}: {
  gameState: { whiteClockMs: number; blackClockMs: number; turn: 'w' | 'b' };
  orientation: 'white' | 'black';
  topColor: 'white' | 'black';
  presenceStatus?: PresenceStatus;
}) {
  const ms = topColor === 'white' ? gameState.whiteClockMs : gameState.blackClockMs;
  const isRunning = gameState.turn === (topColor === 'white' ? 'w' : 'b');
  return (
    <div className="w-full max-w-md">
      <ChessClock ms={ms} isRunning={isRunning} label={topColor === orientation ? 'You' : 'Opponent'} presenceStatus={presenceStatus} />
    </div>
  );
}

function groupMoves(moves: { moveNumber: number; color: 'white' | 'black'; san: string }[]) {
  const pairs: { moveNumber: number; white?: string; black?: string }[] = [];
  for (const m of moves) {
    // `moveNumber` is a ply (server convention); pair two plies into one row.
    const fullMove = Math.ceil(m.moveNumber / 2);
    let pair = pairs.find((p) => p.moveNumber === fullMove);
    if (!pair) {
      pair = { moveNumber: fullMove };
      pairs.push(pair);
    }
    if (m.color === 'white') pair.white = m.san;
    else pair.black = m.san;
  }
  return pairs;
}
