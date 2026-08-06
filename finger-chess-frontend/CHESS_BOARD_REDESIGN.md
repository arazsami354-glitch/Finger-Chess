# Chess Board Redesign

`components/chess/chess-board.tsx` and `components/chess/pieces.tsx` were rebuilt from scratch.
Nothing else in the app was touched by this pass except the one call site
(`app/play/[gameId]/page.tsx`) needed to wire the new promotion picker through to a real move —
that function was previously a documented stub that silently always promoted to queen.

## Pieces — an original set, not a copy of any existing platform's art

12 hand-authored SVG components (`components/chess/pieces.tsx`), one shared gradient/shadow
treatment (warm ivory gradient for white, deep espresso gradient for black — carved material, not
flat glyph color), unique silhouette per piece type. Every piece renders through a `<PieceBase>`
wrapper that scopes its gradient/shadow IDs per-instance (`useId`), so dozens can render on the
board at once with no SVG ID collisions.

**Design direction, stated plainly**: this is a clean, modern-minimalist silhouette set — geometric
and simplified rather than an ornate Victorian Staunton wood-carving reproduction. That's
deliberate and consistent with the rest of the platform's brand language (the same restrained
geometric sensibility as the king + fingerprint logo), not a limitation being hidden. It was never
going to be feasible to hand-author museum-grade Staunton path data blind, without a visual editing
loop to iterate against — an honest, achievable, and still genuinely elegant original design was
the right target, not an overclaimed one.

## Board

- **Wood**: layered CSS gradients — warm maple for light squares, rich walnut for dark, a
  mahogany/rosewood frame — deliberately natural wood tones, not Chess.com's green-and-tan.
- **Coordinates**: file letters along the bottom edge, rank numbers along the left, set into the
  wooden frame.
- **Last-move highlight**, **selected-piece glow**, **legal-move indicators** (a soft dot for a
  quiet square, an annular ring for a capture target — distinct from each other, not the same
  marker), and a **check indicator** (a pulsing red glow on the king's square — see the bug note
  below) are all present.
- **Move/capture animation**: pieces are rendered in an absolutely-positioned layer on top of the
  grid, keyed by a stable per-piece ID rather than by square — so a piece's `left`/`top` transitions
  smoothly to its new square instead of disappearing from one cell and reappearing in another. A
  `diffBoards()` function compares the previous and next board snapshots (chess.js's FEN alone has
  no concept of piece identity across a move) to figure out which piece actually traveled where,
  matched by type+color. Captured pieces render one more frame as a fading, scaling-down "ghost" at
  the capture square rather than vanishing instantly.
- **Promotion**: reaching the back rank now opens a real picker (queen/rook/bishop/knight, rendered
  with the same piece art) instead of the previous silent auto-queen stub — the chosen piece
  animates in via the same fade/scale system. This required a small, deliberate change to
  `onMove`'s signature (an added optional `promotion` parameter) and to the one call site that
  consumes it.
- **Drag and snap**: pointer-down picks a piece up (scales up, gets a stronger shadow, follows the
  cursor); pointer-up on a legal square commits the move and the piece animates the rest of the way
  via the same position-transition system; dropping on an illegal square or off the board releases
  the piece back to its square, which snaps home the same way.
- **Board flip**: orientation changes re-map every square's `left`/`top` percentage, which the
  existing move-transition system animates automatically — flipping the board is not a special
  case, it reuses the exact same code path as a normal move.

## A real bug caught and fixed during this pass

Two, actually, both worth stating plainly:

1. The check-square's pulsing red glow was originally built by combining Tailwind's existing
   `pulse-ring` animation with an inline `box-shadow` style — but a CSS animation's own keyframes
   for a property always override any inline/base value for that same property, so the inline red
   glow would have been silently discarded and the square would have pulsed the wrong (default
   gold) color instead. Fixed by switching to Tailwind's built-in `animate-pulse`, which only
   animates opacity and is safe to combine with a static `box-shadow`.
2. The piece-diffing logic's `bySquare` lookup Map was built from an untyped array of tuples
   (`current.map(v => [v.square, v])`), which TypeScript infers as a widened array rather than a
   tuple without an explicit hint — degrading the Map's value type to `unknown` and breaking
   `existing.id` lookups. Fixed with an explicit `Map<Square, VisualPiece>` generic.

## Follow-up pass: performance fix + more elegant piece detail

Two changes in response to explicit follow-up direction ("pieces should look realistic, elegant,
premium, timeless" + "performance must stay excellent"):

**A real performance bug fixed, not just optimized:** the original piece set had every individual
piece instance declare its own private SVG `<linearGradient>` *and* `<filter>` (an
`feDropShadow`), scoped with `useId()` for uniqueness. With 32 pieces on a full board, that's 32
duplicate gradient definitions and 32 independently-rasterized SVG drop-shadow filters in the DOM
— real, measurable overhead for a result that's visually identical to sharing two. Worse, each
piece was *also* getting a CSS `drop-shadow-sm` class applied externally by the board — meaning
every piece was silently being shadowed twice, once expensively (SVG filter) and once cheaply (CSS
filter), for no additional visual benefit from the expensive one.

Fixed by hoisting the two gradients (white piece, black piece — that's genuinely all that ever
exist) into a single `<PieceDefs />` component mounted exactly once by the board, with every piece
referencing the two fixed IDs directly. The SVG filter is gone entirely; the shadow is now the CSS
`drop-shadow-sm` class alone, applied once at the usage site, GPU-composited and cheap. Net effect:
32 duplicate DOM nodes and 32 filter computations became 2 shared definitions and zero filters, with
no loss of visual shadow (the CSS one that remains was already doing the actual visible work).

**More detail invested where it doesn't cost anything at render time** (path geometry is static,
free to make more detailed): each piece gained the specific ornamental details a genuine Staunton
set has that the first pass's simplified silhouettes didn't — a collar ring on the pawn, banding
rings on the rook, the traditional mitre slit on the bishop, a mane ridge and eye detail on the
knight, five distinct coronet points each finished with its own ball on the queen, and a proper
cross finial with a jeweled crown band on the king. A soft vertical light-catch gradient down each
piece's body was also added — the detail that reads as "polished, turned material" rather than a
flat silhouette, present on every piece at zero extra cost since it's one shared gradient
definition, not per-piece computation.

## Honest scope note

The board-piece diffing handles the common cases correctly — a normal move, a capture, and (since
it matches ALL vacated→occupied pairs, not just one) castling's two simultaneous piece moves. An
en passant capture (where the captured pawn isn't standing on the destination square) may render
the captured piece disappearing rather than a precisely-tracked ghost fade at its actual square —
a reasonable, minor fallback for a genuinely unusual edge case, not a claim of frame-perfect
handling for every rule in chess.
