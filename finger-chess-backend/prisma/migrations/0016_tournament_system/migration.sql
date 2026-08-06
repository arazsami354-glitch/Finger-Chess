-- ============================================================================
-- Tournament System (0016)
--
-- The Prisma client cannot be regenerated on Windows while a dev server holds
-- the query-engine DLL, so these tables are NOT part of schema.prisma. They are
-- created idempotently at app startup by TournamentBootstrapService (and applied
-- to the dev DB by `npm run tournament:apply`) and accessed through parameterized
-- Prisma $queryRaw/$executeRaw wrappers in TournamentRepository. Columns follow
-- the same snake_case + TIMESTAMPTZ + gen_random_uuid() conventions as the rest
-- of the schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "tournaments" (
  "id"                    TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"                  TEXT NOT NULL,
  "description"           TEXT,
  "format"                TEXT NOT NULL,                -- 'single_elim' | 'double_elim' | 'swiss'
  "visibility"            TEXT NOT NULL DEFAULT 'public', -- 'public' | 'private'
  "entry_type"            TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'paid'
  "entry_fee"             DECIMAL(18,2) NOT NULL DEFAULT 0,
  "prize_pool"            DECIMAL(18,2) NOT NULL DEFAULT 0, -- 0 => computed from actual entries at payout
  "max_players"           INTEGER NOT NULL,
  "min_players"           INTEGER NOT NULL DEFAULT 2,
  "registration_deadline" TIMESTAMPTZ,
  "start_time"            TIMESTAMPTZ,
  "time_control"          TEXT NOT NULL,                -- TIME_CONTROLS id, same as games at creation
  "rules"                 TEXT,
  "status"                TEXT NOT NULL DEFAULT 'draft', -- draft|open|closed|active|paused|completed|cancelled
  "current_round"         INTEGER NOT NULL DEFAULT 0,
  "rounds"                INTEGER,                      -- Swiss round count (auto if NULL)
  "settings"              JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_by"            TEXT NOT NULL,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at"            TIMESTAMPTZ,
  "ended_at"              TIMESTAMPTZ,
  "cancellation_reason"   TEXT
);

CREATE INDEX IF NOT EXISTS "idx_tournaments_status" ON "tournaments" ("status");
CREATE INDEX IF NOT EXISTS "idx_tournaments_start_time" ON "tournaments" ("start_time");

CREATE TABLE IF NOT EXISTS "tournament_registrations" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "tournament_id" TEXT NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "user_id"       TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status"        TEXT NOT NULL DEFAULT 'registered',   -- registered|waitlist|cancelled|eliminated|withdrawn
  "seed"          INTEGER,
  "joined_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "eliminated_at" TIMESTAMPTZ,
  "final_rank"    INTEGER,
  "prize_amount"  DECIMAL(18,2),
  "paid_out_at"   TIMESTAMPTZ,
  CONSTRAINT "uq_tournament_registrations_pair" UNIQUE ("tournament_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_tournament_registrations_tournament" ON "tournament_registrations" ("tournament_id", "status");
CREATE INDEX IF NOT EXISTS "idx_tournament_registrations_user" ON "tournament_registrations" ("user_id");

CREATE TABLE IF NOT EXISTS "tournament_matches" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "tournament_id" TEXT NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "round"         INTEGER NOT NULL,                     -- chronological round batch
  "bracket"       TEXT NOT NULL DEFAULT 'main',         -- main|winners|losers|grand_final (elim) / main (swiss)
  "slot"          INTEGER NOT NULL,                     -- index within the round
  "game_id"       TEXT REFERENCES "games"("id") ON DELETE SET NULL,
  "white_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "black_user_id" TEXT REFERENCES "users"("id") ON DELETE CASCADE, -- NULL => bye / auto-win
  "status"        TEXT NOT NULL DEFAULT 'scheduled',    -- scheduled|in_progress|completed|bye
  "result"        TEXT,                                 -- white_win|black_win|draw|bye
  "winner_user_id" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "scheduled_at"  TIMESTAMPTZ,
  "started_at"    TIMESTAMPTZ,
  "ended_at"      TIMESTAMPTZ,
  CONSTRAINT "uq_tournament_matches_slot" UNIQUE ("tournament_id", "round", "bracket", "slot")
);

CREATE INDEX IF NOT EXISTS "idx_tournament_matches_tournament" ON "tournament_matches" ("tournament_id");
CREATE INDEX IF NOT EXISTS "idx_tournament_matches_game" ON "tournament_matches" ("game_id");
