# UI/UX Redesign Pass — Finger Chess

A design-system-level pass: rather than touching every individual page, this redesign concentrated
on the design tokens and shared primitive components every page already composes from — Button,
Card, Input, Badge, the app shell's header/nav, plus the color/radius/shadow/motion tokens
themselves. That's what makes a coherent visual transformation possible without risking regressions
across dozens of pages: fix the foundation once, and every page inherits it automatically.

**Zero business logic, routes, API calls, or component props were changed.** Every edit in this
pass is either a CSS/token value or an additive `className`/Tailwind utility — nothing was removed,
renamed, or restructured. Verified with a `tsc --noEmit` syntax check both before committing to any
individual change and again at the end — zero errors, meaning every file still parses and every
existing prop/type contract is intact.

## The accessibility finding

While auditing contrast (an explicit requirement — "Accessibility friendly," "Perfect contrast"),
the brand gold (`#D4AF37`) used as literal **text/icon color directly on the page background**
measured **~2.1:1** in light mode — well under WCAG AA's 4.5:1 floor for text, and even under the
3:1 floor for meaningful UI-component contrast. This wasn't caught before because it was almost
always rendered on the dark background (~9:1, comfortably AAA), which masked the light-mode
failure entirely. It affected roughly 18 usages across 9 files — the landing hero, stakes section,
leaderboard, dashboard, profile pages, and the app shell nav.

**Fix**: rather than hand-editing 18 call sites, `--gold` itself is now theme-aware —
`app/globals.css` defines a darker, still-recognizably-gold "ink" value for light mode
(`hsl(42 74% 32%)`, calculated to ~4.6:1 against white — clears AA) and keeps the full bright brand
swatch for dark mode, where it already had huge headroom. Every existing `text-gold`/`border-gold`
usage across the app is fixed automatically, with zero component-level changes. `--primary` (used
for solid gold **button fills**, where black text sits *on top of* the gold rather than the gold
sitting on the page background) was deliberately left untouched — that pairing was always fine
regardless of theme, since a button's own text only ever needs to contrast against its own fill,
not the page background.

## What changed, and where

| Area | Change |
|---|---|
| `app/globals.css` | The gold contrast fix above; larger base radius (`0.75rem` → `1rem`) for a softer, more modern feel; refined `.glass-panel` (blur + saturation boost + hairline border, reads as true glass instead of just blur); new `.surface-interactive` utility (soft shadow at rest, lift + stronger shadow on hover, opt-in per element); thin custom scrollbar; smooth-scroll (respecting `prefers-reduced-motion`) |
| `tailwind.config.js` | New layered soft-shadow scale (`shadow-soft`/`premium`/`premium-lg`/`glow` — two shadows stacked reads as physically soft rather than the harsh flat default); a single consistent "ease-out-expo" easing curve (`ease-premium`) used everywhere instead of ad hoc timing; entrance-animation keyframes (`fade-up`/`fade-in`/`scale-in`); expanded radius scale (`xl`/`2xl`) |
| `components/ui/button.tsx` | Soft shadow with hover lift, subtle press feedback (`active:scale-[0.98]`), the premium easing curve — sizes, variants, and every prop are unchanged, so no call site needed updating |
| `components/ui/card.tsx` | Upgraded from Tailwind's flat default shadow to the new soft layered shadow |
| `components/ui/input.tsx` | Smoother, more visible focus transition (border + ring animate in together rather than snapping) |
| `components/ui/badge.tsx` | Smoothed transition timing — automatically inherits the accessible gold contrast fix |
| `components/layout/app-shell.tsx` | Header now uses the true `.glass-panel` treatment instead of a manual blur-only class; nav item hover/active transitions smoothed |
| `components/landing/hero.tsx` | Staggered fade-up entrance sequence on first load — a considered, premium first impression, respects reduced-motion |
| Admin console (`finger-chess-admin`) | Same soft-shadow scale and premium easing curve added to its own Tailwind config and `.panel`/`.input` utilities; `Button`/`Badge` primitives got the same transition/press-feedback polish |

## A decision stated plainly, not silently made: the admin console stays dark-only

The admin console (`finger-chess-admin`) was deliberately designed in an earlier pass as an
always-dark "ledger/trading terminal" — a legitimate, common choice for internal ops tools (Stripe's
and Vercel's own internal dashboards work the same way), distinct from the player-facing app which
needs to serve a general consumer audience in whichever mode they prefer. Converting it to support
a real light mode would mean migrating its entire color system from hardcoded hex values to
CSS-variable-driven tokens — a much larger, higher-risk structural change than a redesign pass
should make casually. Its gold-as-text usage never sits on a light background (the app has none),
so it never had the contrast problem the player app did — no fix was needed there, just the same
shadow/motion polish. If a real light mode for the admin console is wanted, that's a deliberate,
scoped follow-up, not something to fold into "polish the UI."

## What this pass did not touch

Individual page layouts, spacing, and content were left as-is — the ask was to elevate the *feel*
of the interface, not restructure every page's information architecture. A handful of the highest-
visibility surfaces (the landing hero, the app shell chrome) got direct attention beyond the shared
primitives; the rest of the app's dozens of pages inherit the transformation through the token and
component layer rather than being individually touched, which is also what keeps the regression
risk close to zero for a change of this apparent scope.
