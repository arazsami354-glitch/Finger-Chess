# Chess Gameplay Audit Report

Date: 2026-08-02
Scope: `finger-chess-backend` + `finger-chess-frontend` chess gameplay implementation
Method: live end-to-end games driven through the real matchmaking + game WebSocket gateways on the running dev server, a pure-engine rule harness executed against the compiled `dist/` modules, and direct Postgres verification of every persisted side-effect.

---

## 1. Test Evidence

### 1.1 End-to-end simulation (`sim-e2e.cjs`) — 39 assertions, 0 failures

Real users matched through `/matchmaking` (joinQueue → matchFound) then playing on `/game`. Five complete scenarios:

| Game | Scenario | Key verified outcomes |
|------|----------|-----------------------|
| 1 | Fool's mate + illegal move | Illegal move rejected ("Illegal move"); turn enforcement ("Not your turn"); `moveApplied` carries server `moveNumber`/`color`/`turn`/`lastMoveAt`; mate flagged `isCheck`+`isGameOver`; `gameOver` reason `checkmate` with `winnerColor=black` to both players; DB `result=black_win`, `winnerId` correct, 4 move rows in order with SANs + `fenAfter`; ratings updated (winner 1220, loser 1180, `ratingHistory` 2); PGN `[TimeControl "180+0"]`, `[Result "0-1"]`, movetext `1. f3 e5 2. g4 Qh4# 0-1`. |
| 2 | Threefold repetition | Eighth ply flagged `isGameOver`; `gameOver` reason `draw_rule`; no winner; DB `result=draw`. |
| 3 | Resignation | `gameOver` reason `resignation`, white wins; DB `result=white_win`. |
| 4 | Draw by agreement | Opponent receives `drawOffered` with offerer color; accept → `draw_agreement`; DB `result=draw`; ratings still recorded. |
| 5 | Draw-offer decline | Game continues (ply 3 accepted), no premature `gameOver`. |

### 1.2 Pure-engine rule harness (`engine-harness.cjs`) — 36 assertions, 0 failures

Executed against `dist/src/game/engine/chess-engine.service.js` and `dist/src/game/utils/pgn-builder.js`:

- **Stalemate** detected (known 10-move line), distinct from checkmate.
- **Fifty-move rule**: `isDraw` at halfmove 100; not at 50 (isolated with K+R material so insufficient-material is excluded).
- **Insufficient material**: K vs K, K+B vs K, K+N vs K → draw; K+R vs K → not; `hasInsufficientMatingMaterial` (FIDE flag-draw rule) correct.
- **Promotion** SAN/UCI `f8=Q+` (`f7f8q`) and underpromotion `f8=N`.
- **Castling** both sides (`e1g1`/`e1c1`), rights-loss rejection, and cannot-castle-through-check.
- **En passant** SAN `axb6`, UCI `a5b6`, captured pawn removed.
- **Threefold via `positionKey`**: Zobrist `hash()` (board + side-to-move + castling + ep; excludes halfmove/fullmove clocks); knight shuffle reaches the start position 3 times (including the initial count) at ply 8 across 4 distinct keys; same position with different fullmove → same key.
- **Turn/illegal enforcement**, **back-rank checkmate** SAN `Ra8#`.

### 1.3 Build hygiene

- Backend `npm run build` (nest build) → OK; `npx tsc --noEmit` → clean; `npm run lint` → clean.
- Frontend `npx tsc --noEmit` → clean.
- `/health/ready` → 200.

---

## 2. Problems Found & Fixed

1. **Ratings never updated for any finished game.** `startGame` overwrote `game.timeControl` with the display label (e.g. "10+0"); `finishGame` then called `getTimeControl("10+0")`, which threw, and the error was swallowed — so no finished game ever affected ratings. Fixed in `game.service.ts` (`finishGame` resolves the category from the Redis players record via `getGameCategory(gameId)` and passes it straight to `rating.service.ts: updateRatingsForGame(gameId, gameMode, whiteUserId, blackUserId, result)`). Verified end-to-end: winner +20, loser −20, `ratingHistory` rows written.
2. **Threefold repetition was never detected.** The initial keying on FEN was broken because FEN embeds the fullmove counter (the 3rd repetition of the initial board has fullmove 5). Fixed: `chess-engine.service.ts: positionKey(fen)` = chess.js `hash()` (Zobrist without clocks); `game.service.ts` seeds `positionCounts` with the initial position and increments on every legal move, checking for a count of 3 before persisting the move row.
3. **PGN `[TimeControl]` emitted the raw UI label** (`3+0`) instead of the PGN seconds form. Fixed in `pgn-builder.ts` via `toPgnTimeControl` → `180+0`.
4. **PGN movetext numbering used plies instead of fullmoves** — white's 2nd move printed as "3." not "2.". Fixed in `buildMovetext`: fullmove = `ceil(ply / 2)`, including the black-to-move `...` marker.
5. **Race conditions on every state-mutating WS handler.** `applyMove`, `offerDraw`, `respondToDraw`, `resign`, `endGameOnTimeout`, and `forfeitOnDisconnect` now execute inside a Redis-based `withLock` (`SET key token EX 30 NX`, polling acquisition, Lua compare-and-delete release) that serializes concurrent mutations per game.
6. **Self draw-offer dialog bug.** The offerer saw their own "opponent offered a draw" UI. Fixed in `use-game-socket.ts`: `drawOffered` only surfaces when `data.by !== myColor`.
7. **Clock desync.** Both clocks ticked between server updates; only the to-move clock should tick. Fixed via `toMoveClockMs`, applied on `gameState` and `moveApplied`, using the server's `lastMoveAt` + `incrementMs`.
8. **Move-history pairing** (frontend `groupMoves`) treated the server ply number as a fullmove number; fixed with `ceil(ply / 2)`, and `moveApplied` now appends server-authoritative `{moveNumber, color, san}` instead of re-deriving locally.
9. **Reconnect resync**: snapshot now carries `lastMoveAt`/`incrementMs`; `drawOfferedByOpponent` is restored from `drawOfferBy`.

---

## 3. Remaining Notes & Recommendations

- **Timeout (flag) and disconnect-forfeit paths** are code-reviewed and lock-protected but were not E2E-simulated (would require waiting the full clock or hard-killing sockets). Recommend a dedicated timing test before launch.
- **Reconnect-mid-game sync** restore logic is implemented but not E2E-verified.
- **Performance**: no load/concurrency test was run. Per-move DB writes plus one Redis lock round-trip are the hot path; recommend a concurrency harness (parallel `applyMove` from both sides) and a latency measurement before scale-out.
- **Schema smell**: `game.timeControl` stores the display label, not the time-control id; ratings/PGN derivation now bypasses it, but migrating the column would remove the footgun.
- **Test data**: the simulation left ~20 `sim_*@test.local` users and 8 completed games in the database; harmless for development, purge before production.

---

## 4. Scores

| Category | Score | Rationale |
|----------|-------|-----------|
| Gameplay | 9/10 | Full lifecycle verified E2E (match → play → all terminal paths: mate, threefold, resign, draw-agreement, decline, + illegal/turn enforcement); ratings, PGN, and result persistence all correct. |
| Chess Logic | 10/10 | 36/36 rule assertions pass (stalemate, fifty-move, insufficient material incl. FIDE flag rule, promotion/underpromotion, castling incl. through-check, en passant, threefold via Zobrist, checkmate, illegal/turn). |
| Synchronization | 9/10 | All mutating handlers serialized via Redis lock; server-authoritative move metadata; clock correction + reconnect restore implemented; concurrency not yet stress-tested. |
| Performance | 7/10 | No load benchmarks run; lock round-trip and per-move DB writes are the identified hot path; no obvious hot loops or unbounded work found in review. |

**Overall: 8.75 / 10**
