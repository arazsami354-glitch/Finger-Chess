-- Tournament tables — source of truth, mirrored in prisma/migrations/0016_tournament_system/migration.sql.
-- Executed idempotently at app startup by TournamentBootstrapService so every environment
-- (dev/test/prod) converges without a running `prisma migrate` (the Prisma client cannot be
-- regenerated on Windows while a dev server holds the query-engine DLL). All access goes through
-- parameterized Prisma $queryRaw/$executeRaw wrappers in TournamentRepository.

CREATE TABLE IF NOT EXISTS "tournaments" (
  "id"                    TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"                  TEXT NOT NULL,
  "description"           TEXT,
  "format"                TEXT NOT NULL,
  "visibility"            TEXT NOT NULL DEFAULT 'public',
  "entry_type"            TEXT NOT NULL DEFAULT 'free',
  "entry_fee"             DECIMAL(18,2) NOT NULL DEFAULT 0,
  "prize_pool"            DECIMAL(18,2) NOT NULL DEFAULT 0,
  "max_players"           INTEGER NOT NULL,
  "min_players"           INTEGER NOT NULL DEFAULT 2,
  "registration_deadline" TIMESTAMPTZ,
  "start_time"            TIMESTAMPTZ,
  "time_control"          TEXT NOT NULL,
  "rules"                 TEXT,
  "status"                TEXT NOT NULL DEFAULT 'draft',
  "current_round"         INTEGER NOT NULL DEFAULT 0,
  "rounds"                INTEGER,
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
  "status"        TEXT NOT NULL DEFAULT 'registered',
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
  "round"         INTEGER NOT NULL,
  "bracket"       TEXT NOT NULL DEFAULT 'main',
  "slot"          INTEGER NOT NULL,
  "game_id"       TEXT REFERENCES "games"("id") ON DELETE SET NULL,
  "white_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "black_user_id" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "status"        TEXT NOT NULL DEFAULT 'scheduled',
  "result"        TEXT,
  "winner_user_id" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "scheduled_at"  TIMESTAMPTZ,
  "started_at"    TIMESTAMPTZ,
  "ended_at"      TIMESTAMPTZ,
  CONSTRAINT "uq_tournament_matches_slot" UNIQUE ("tournament_id", "round", "bracket", "slot")
);

CREATE INDEX IF NOT EXISTS "idx_tournament_matches_tournament" ON "tournament_matches" ("tournament_id");
CREATE INDEX IF NOT EXISTS "idx_tournament_matches_game" ON "tournament_matches" ("game_id");
