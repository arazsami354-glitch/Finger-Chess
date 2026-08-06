# Matchmaking Upgrade

## What already existed, and wasn't rebuilt

A lot of what was asked for was already real, working infrastructure from earlier passes — this
upgrade extended it rather than duplicating it:
- **Free/Paid Matches**: already structurally separated — a `$0` room and a paid room are
  different queues by construction (`roomKey(timeControl, entryFee)`), so they can never mix.
- **Skill Matching / Rating Filter**: already real — a widening rating band the longer a player
  waits (classic ranked-matchmaking backoff). This pass didn't rebuild it; it made the *existing*
  live value visible to the player instead of leaving it invisible server-side logic.
- **Reconnect Support**: already real — a disconnected queued player's socket reconnecting resumes
  their queue position rather than starting over.
- **Cancel Queue**: already real.
- **Avoiding repeated rematches**: already handled — `MatchIntegrityService`'s head-to-head limit
  (originally built as a collusion-prevention measure) already keeps the same two players from
  being paired excessively often in a short window.

## What's genuinely new

- **Estimated Wait Time**: a real rolling average of actual recent wait durations per room (Redis
  list, last 30 samples, 1-hour TTL) — not a fabricated countdown. Before any real samples exist
  for a room, it shows an honest default (45s) rather than a precise-looking number with nothing
  behind it.
- **Live rating band, pushed continuously**: the existing band-widening formula now gets
  recomputed from the *actual* elapsed queue time on every heartbeat and pushed to the client —
  previously this value existed only inside the server's own matching logic and was never surfaced
  at all.
- **Connection Quality**: a real ping/pong round-trip measurement, deliberately a stateless echo
  (the server does zero work beyond bouncing the client's own timestamp back) so it's essentially
  free even at a few-second interval — measured continuously, not just while queued.
- **Animated Searching Screen**: a shared `SearchingScreen` component (radar-style concentric pulse,
  pure CSS animation, no JS driving it) used by both the free and paid lobby flows instead of
  duplicating the UI — shows a live countdown grounded in the real wait estimate, the live
  widening rating band, and the connection-quality reading together.

## Verified, not asserted

- Every WS event name (`ping`/`pong`/`queueStatus`, plus the pre-existing ones) cross-checked
  between the frontend hook and the backend gateway's `@SubscribeMessage` handlers and `.emit()`
  calls — full matches.
- `tsc --noEmit` clean (zero real syntax/type errors) on both backend and frontend.
- One flagged discrepancy investigated to a real conclusion rather than left as a shrug: a
  `Badge variant="gold"` type error surfaced during the real-error sweep that didn't immediately
  match the project's known "missing `@types/react` in this sandbox" noise pattern. Confirmed it
  *was* that same environmental noise — not a bug introduced this session — by checking that the
  identical error appears on `app/players/[id]/page.tsx`, a file untouched this pass, using the
  exact same `Badge variant="..."` pattern.
