import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Typed persistence layer for the tournament subsystem. The tournament schema
 * lives OUTSIDE schema.prisma (the Prisma client can't be regenerated on
 * Windows while a dev server holds the query-engine DLL), so every access is a
 * parameterized `$queryRaw`/`$executeRaw` — no raw string concatenation with
 * user input anywhere: values are passed via tagged-template parameters and
 * all identifiers are compile-time literals below.
 *
 * DECIMAL columns arrive from `$queryRaw` as Prisma.Decimal objects, so every
 * money value is normalized to `number` before it leaves this layer.
 */
@Injectable()
export class TournamentRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private money(value: unknown): number {
    return Number(value ?? 0);
  }

  private json(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return (value as Record<string, unknown> | null) ?? {};
  }

  /** camelCase service keys → snake_case DB columns (keys are trusted literals from the service layer). */
  private columnName(key: string): string {
    return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  }

  private readonly TOURNAMENT_COLUMNS = `
    id, name, description,
    format, visibility,
    entry_type AS "entryType",
    entry_fee AS "entryFee",
    prize_pool AS "prizePool",
    max_players AS "maxPlayers",
    min_players AS "minPlayers",
    registration_deadline AS "registrationDeadline",
    start_time AS "startTime",
    time_control AS "timeControl",
    rules,
    status,
    current_round AS "currentRound",
    rounds,
    settings,
    created_by AS "createdBy",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    started_at AS "startedAt",
    ended_at AS "endedAt",
    cancellation_reason AS "cancellationReason"
  `;

  private readonly REGISTRATION_COLUMNS = `
    r.id, r.tournament_id AS "tournamentId", r.user_id AS "userId",
    r.status, r.seed, r.joined_at AS "joinedAt",
    r.eliminated_at AS "eliminatedAt", r.final_rank AS "finalRank",
    r.prize_amount AS "prizeAmount", r.paid_out_at AS "paidOutAt"
  `;

  private readonly REGISTRATION_RETURNING_COLUMNS = `
    id, tournament_id AS "tournamentId", user_id AS "userId",
    status, seed, joined_at AS "joinedAt",
    eliminated_at AS "eliminatedAt", final_rank AS "finalRank",
    prize_amount AS "prizeAmount", paid_out_at AS "paidOutAt"
  `;

  private readonly MATCH_COLUMNS = `
    m.id, m.tournament_id AS "tournamentId", m.round, m.bracket, m.slot,
    m.game_id AS "gameId", m.white_user_id AS "whiteUserId", m.black_user_id AS "blackUserId",
    m.status, m.result, m.winner_user_id AS "winnerUserId",
    m.scheduled_at AS "scheduledAt", m.started_at AS "startedAt", m.ended_at AS "endedAt"
  `;

  private readonly MATCH_RETURNING_COLUMNS = `
    id, tournament_id AS "tournamentId", round, bracket, slot,
    game_id AS "gameId", white_user_id AS "whiteUserId", black_user_id AS "blackUserId",
    status, result, winner_user_id AS "winnerUserId",
    scheduled_at AS "scheduledAt", started_at AS "startedAt", ended_at AS "endedAt"
  `;

  private mapTournament(row: Record<string, unknown>): TournamentRow {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? null,
      format: row.format as string,
      visibility: row.visibility as string,
      entryType: row.entryType as string,
      entryFee: this.money(row.entryFee),
      prizePool: this.money(row.prizePool),
      maxPlayers: row.maxPlayers as number,
      minPlayers: row.minPlayers as number,
      registrationDeadline: (row.registrationDeadline as Date) ?? null,
      startTime: (row.startTime as Date) ?? null,
      timeControl: row.timeControl as string,
      rules: (row.rules as string) ?? null,
      status: row.status as string,
      currentRound: row.currentRound as number,
      rounds: (row.rounds as number) ?? null,
      settings: this.json(row.settings),
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
      startedAt: (row.startedAt as Date) ?? null,
      endedAt: (row.endedAt as Date) ?? null,
      cancellationReason: (row.cancellationReason as string) ?? null,
    };
  }

  private mapRegistration(row: Record<string, unknown>): RegistrationRow {
    return {
      id: row.id as string,
      tournamentId: row.tournamentId as string,
      userId: row.userId as string,
      status: row.status as string,
      seed: (row.seed as number) ?? null,
      joinedAt: row.joinedAt as Date,
      eliminatedAt: (row.eliminatedAt as Date) ?? null,
      finalRank: (row.finalRank as number) ?? null,
      prizeAmount: row.prizeAmount === null || row.prizeAmount === undefined ? null : this.money(row.prizeAmount),
      paidOutAt: (row.paidOutAt as Date) ?? null,
    };
  }

  // ==========================================================================
  // TOURNAMENTS
  // ==========================================================================

  async createTournament(data: {
    id?: string;
    name: string;
    description?: string | null;
    format: string;
    visibility: string;
    entryType: string;
    entryFee: number;
    prizePool: number;
    maxPlayers: number;
    minPlayers: number;
    registrationDeadline?: Date | null;
    startTime?: Date | null;
    timeControl: string;
    rules?: string | null;
    status: string;
    currentRound?: number;
    rounds?: number | null;
    settings: Record<string, unknown>;
    createdBy: string;
  }): Promise<TournamentRow> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      INSERT INTO "tournaments" (
        id, name, description, format, visibility, entry_type, entry_fee, prize_pool,
        max_players, min_players, registration_deadline, start_time, time_control, rules,
        status, current_round, rounds, settings, created_by
      ) VALUES (
        ${data.id ?? crypto.randomUUID()}, ${data.name}, ${data.description ?? null}, ${data.format},
        ${data.visibility}, ${data.entryType}, ${data.entryFee}, ${data.prizePool},
        ${data.maxPlayers}, ${data.minPlayers}, ${data.registrationDeadline ?? null}, ${data.startTime ?? null},
        ${data.timeControl}, ${data.rules ?? null}, ${data.status}, ${data.currentRound ?? 0},
        ${data.rounds ?? null}, ${Prisma.raw('CAST(')}${JSON.stringify(data.settings) as unknown as Prisma.InputJsonValue}${Prisma.raw(' AS jsonb)')}, ${data.createdBy}
      )
      RETURNING ${Prisma.raw(this.TOURNAMENT_COLUMNS)}
    `;
    return this.mapTournament(rows[0]);
  }

  async findTournament(id: string): Promise<TournamentRow | null> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.TOURNAMENT_COLUMNS)} FROM "tournaments" WHERE id = ${id}
    `;
    return rows[0] ? this.mapTournament(rows[0]) : null;
  }

  async listTournaments(filters: {
    statuses?: string[];
    visibility?: string[];
    search?: string;
    take?: number;
    offset?: number;
    sortBy?: 'startTime' | 'createdAt';
    order?: 'asc' | 'desc';
  } = {}): Promise<TournamentRow[]> {
    const conditions: Prisma.Sql[] = [];
    if (filters.statuses?.length) {
      conditions.push(Prisma.sql`status = ANY(${filters.statuses}::text[])`);
    }
    if (filters.visibility?.length) {
      conditions.push(Prisma.sql`visibility = ANY(${filters.visibility}::text[])`);
    }
    if (filters.search) {
      conditions.push(Prisma.sql`(name ILIKE ${`%${filters.search}%`} OR description ILIKE ${`%${filters.search}%`})`);
    }
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const sortCol = filters.sortBy === 'startTime' ? 'start_time' : 'created_at';
    const order = filters.order ?? 'desc';
    const limit = filters.take ?? 50;
    const offset = filters.offset ?? 0;
    return (
      await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${Prisma.raw(this.TOURNAMENT_COLUMNS)} FROM "tournaments"
        ${where}
        ORDER BY ${Prisma.raw(sortCol)} ${Prisma.raw(order)}
        LIMIT ${limit} OFFSET ${offset}
      `
    ).map((r) => this.mapTournament(r));
  }

  async updateTournament(id: string, data: Partial<Record<string, unknown>>): Promise<TournamentRow | null> {
    const entries = Object.entries(data);
    if (entries.length === 0) return this.findTournament(id);
    const sets = entries.map(([key, value]) => {
      if (key === 'settings') {
        return Prisma.sql`"settings" = CAST(${(typeof value === 'string' ? value : JSON.stringify(value)) as never} AS jsonb)`;
      }
      return Prisma.sql`${Prisma.raw(`"${this.columnName(key)}"`)} = ${value as never}`;
    });
    await this.prisma.$executeRaw`
      UPDATE "tournaments" SET ${Prisma.join(sets, ', ')}, updated_at = now() WHERE id = ${id}
    `;
    return this.findTournament(id);
  }

  async countByStatus(): Promise<{ status: string; count: number }[]> {
    const rows = await this.prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT status, COUNT(*) AS count FROM "tournaments" GROUP BY status
    `;
    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  // ==========================================================================
  // REGISTRATIONS
  // ==========================================================================

  async findRegistration(tournamentId: string, userId: string): Promise<RegistrationRow | null> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.REGISTRATION_COLUMNS)}
      FROM "tournament_registrations" r
      WHERE r.tournament_id = ${tournamentId} AND r.user_id = ${userId}
    `;
    return rows[0] ? this.mapRegistration(rows[0]) : null;
  }

  async createRegistration(tournamentId: string, userId: string, status = 'registered', seed?: number): Promise<RegistrationRow> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      INSERT INTO "tournament_registrations" (tournament_id, user_id, status, seed)
      VALUES (${tournamentId}, ${userId}, ${status}, ${seed ?? null})
      ON CONFLICT (tournament_id, user_id) DO NOTHING
      RETURNING ${Prisma.raw(this.REGISTRATION_RETURNING_COLUMNS)}
    `;
    return this.mapRegistration(rows[0]);
  }

  async updateRegistration(tournamentId: string, userId: string, data: Partial<Record<string, unknown>>): Promise<RegistrationRow | null> {
    const sets = Object.entries(data).map(([key, value]) => Prisma.sql`${Prisma.raw(`"${this.columnName(key)}"`)} = ${value as never}`);
    await this.prisma.$executeRaw`
      UPDATE "tournament_registrations"
      SET ${Prisma.join(sets, ', ')}
      WHERE tournament_id = ${tournamentId} AND user_id = ${userId}
    `;
    return this.findRegistration(tournamentId, userId);
  }

  async deleteRegistration(tournamentId: string, userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "tournament_registrations"
      WHERE tournament_id = ${tournamentId} AND user_id = ${userId}
    `;
  }

  async countRegistrations(tournamentId: string, status?: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "tournament_registrations"
      WHERE tournament_id = ${tournamentId}
      ${status ? Prisma.sql`AND status = ${status}` : Prisma.empty}
    `;
    return Number(rows[0].count);
  }

  async listRegistrations(tournamentId: string): Promise<RegistrationRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.REGISTRATION_COLUMNS)}
      FROM "tournament_registrations" r
      WHERE r.tournament_id = ${tournamentId}
      ORDER BY r.joined_at ASC
    `;
    return rows.map((r) => this.mapRegistration(r));
  }

  /** Registrations joined with user profile for display (ratings attached by the service). */
  async listRegisteredUsers(tournamentId: string): Promise<RegisteredUserRow[]> {
    return this.prisma.$queryRaw<RegisteredUserRow[]>`
      SELECT
        r.id, r.tournament_id AS "tournamentId", r.user_id AS "userId",
        r.status, r.seed, r.joined_at AS "joinedAt",
        r.eliminated_at AS "eliminatedAt", r.final_rank AS "finalRank",
        r.prize_amount AS "prizeAmount", r.paid_out_at AS "paidOutAt",
        u.email, u.full_name AS "fullName"
      FROM "tournament_registrations" r
      JOIN "users" u ON u.id = r.user_id
      WHERE r.tournament_id = ${tournamentId}
      ORDER BY COALESCE(r.seed, 2147483647) ASC, r.joined_at ASC
    `;
  }

  async listRegistrationsByUser(userId: string, take = 50): Promise<RegistrationRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.REGISTRATION_COLUMNS)}
      FROM "tournament_registrations" r
      WHERE r.user_id = ${userId}
      ORDER BY r.joined_at DESC
      LIMIT ${take}
    `;
    return rows.map((r) => this.mapRegistration(r));
  }

  /** Registration statuses as a map keyed by user id, for one-shot lookups. */
  async registrationStatuses(tournamentId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<{ userId: string; status: string }[]>`
      SELECT user_id AS "userId", status FROM "tournament_registrations" WHERE tournament_id = ${tournamentId}
    `;
    return new Map(rows.map((r) => [r.userId, r.status]));
  }

  // ==========================================================================
  // MATCHES
  // ==========================================================================

  private mapMatch(row: Record<string, unknown>): MatchRow {
    return {
      id: row.id as string,
      tournamentId: row.tournamentId as string,
      round: row.round as number,
      bracket: row.bracket as string,
      slot: row.slot as number,
      gameId: (row.gameId as string) ?? null,
      whiteUserId: (row.whiteUserId as string) ?? null,
      blackUserId: (row.blackUserId as string) ?? null,
      status: row.status as string,
      result: (row.result as string) ?? null,
      winnerUserId: (row.winnerUserId as string) ?? null,
      scheduledAt: (row.scheduledAt as Date) ?? null,
      startedAt: (row.startedAt as Date) ?? null,
      endedAt: (row.endedAt as Date) ?? null,
    };
  }

  async insertMatch(m: {
    id: string;
    tournamentId: string;
    round: number;
    bracket: string;
    slot: number;
    whiteUserId?: string | null;
    blackUserId?: string | null;
    status: string;
  }): Promise<MatchRow> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      INSERT INTO "tournament_matches" (
        id, tournament_id, round, bracket, slot, white_user_id, black_user_id, status
      ) VALUES (
        ${m.id}, ${m.tournamentId}, ${m.round}, ${m.bracket}, ${m.slot},
        ${m.whiteUserId ?? null}, ${m.blackUserId ?? null}, ${m.status}
      )
      ON CONFLICT (tournament_id, round, bracket, slot) DO UPDATE
        SET white_user_id = EXCLUDED.white_user_id,
            black_user_id = EXCLUDED.black_user_id,
            status = CASE WHEN "tournament_matches".status IN ('completed', 'bye', 'cancelled')
              THEN "tournament_matches".status ELSE EXCLUDED.status END
      RETURNING ${Prisma.raw(this.MATCH_RETURNING_COLUMNS)}
    `;
    return this.mapMatch(rows[0]);
  }

  async findMatch(id: string): Promise<MatchRow | null> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.MATCH_COLUMNS)} FROM "tournament_matches" m WHERE m.id = ${id}
    `;
    return rows[0] ? this.mapMatch(rows[0]) : null;
  }

  async findMatchBySlot(tournamentId: string, round: number, bracket: string, slot: number): Promise<MatchRow | null> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.MATCH_COLUMNS)}
      FROM "tournament_matches" m
      WHERE m.tournament_id = ${tournamentId} AND m.round = ${round} AND m.bracket = ${bracket} AND m.slot = ${slot}
    `;
    return rows[0] ? this.mapMatch(rows[0]) : null;
  }

  async updateMatch(id: string, data: Partial<Record<string, unknown>>): Promise<MatchRow | null> {
    const sets = Object.entries(data).map(([key, value]) => Prisma.sql`${Prisma.raw(`"${this.columnName(key)}"`)} = ${value as never}`);
    if (sets.length === 0) return this.findMatch(id);
    await this.prisma.$executeRaw`
      UPDATE "tournament_matches" SET ${Prisma.join(sets, ', ')} WHERE id = ${id}
    `;
    return this.findMatch(id);
  }

  async listMatches(tournamentId: string): Promise<MatchRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.MATCH_COLUMNS)}
      FROM "tournament_matches" m
      WHERE m.tournament_id = ${tournamentId}
      ORDER BY m.round ASC, m.slot ASC
    `;
    return rows.map((r) => this.mapMatch(r));
  }

  /** Matches joined to their game and both players' profiles for the bracket view. */
  async listMatchesDetailed(tournamentId: string): Promise<DetailedMatchRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        ${Prisma.raw(this.MATCH_COLUMNS)},
        g.status AS "gameStatus",
        w.email AS "whiteEmail", w.full_name AS "whiteFullName",
        b.email AS "blackEmail", b.full_name AS "blackFullName"
      FROM "tournament_matches" m
      LEFT JOIN "games" g ON g.id = m.game_id
      LEFT JOIN "users" w ON w.id = m.white_user_id
      LEFT JOIN "users" b ON b.id = m.black_user_id
      WHERE m.tournament_id = ${tournamentId}
      ORDER BY m.round ASC, m.bracket ASC, m.slot ASC
    `;
    return rows.map((r) => {
      const base = this.mapMatch(r);
      return {
        ...base,
        game: r.gameId
          ? { id: r.gameId as string, status: (r.gameStatus as string) ?? 'unknown', result: (r.result as string) ?? null }
          : null,
        whiteUser: base.whiteUserId
          ? { id: base.whiteUserId, email: (r.whiteEmail as string) ?? '', fullName: (r.whiteFullName as string) ?? null }
          : null,
        blackUser: base.blackUserId
          ? { id: base.blackUserId, email: (r.blackEmail as string) ?? '', fullName: (r.blackFullName as string) ?? null }
          : null,
      };
    });
  }

  async listMatchesByRound(tournamentId: string, round: number, bracket?: string): Promise<MatchRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.MATCH_COLUMNS)}
      FROM "tournament_matches" m
      WHERE m.tournament_id = ${tournamentId} AND m.round = ${round}
      ${bracket ? Prisma.sql`AND m.bracket = ${bracket}` : Prisma.empty}
      ORDER BY m.slot ASC
    `;
    return rows.map((r) => this.mapMatch(r));
  }

  async countMatchesByStatus(tournamentId: string): Promise<{ status: string; count: number }[]> {
    const rows = await this.prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT status, COUNT(*) AS count FROM "tournament_matches" WHERE tournament_id = ${tournamentId} GROUP BY status
    `;
    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  async findMatchByGameId(gameId: string): Promise<MatchRow | null> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${Prisma.raw(this.MATCH_COLUMNS)} FROM "tournament_matches" m WHERE m.game_id = ${gameId}
    `;
    return rows[0] ? this.mapMatch(rows[0]) : null;
  }
}

export interface TournamentRow {
  id: string;
  name: string;
  description: string | null;
  format: string;
  visibility: string;
  entryType: string;
  entryFee: number;
  prizePool: number;
  maxPlayers: number;
  minPlayers: number;
  registrationDeadline: Date | null;
  startTime: Date | null;
  timeControl: string;
  rules: string | null;
  status: string;
  currentRound: number;
  rounds: number | null;
  settings: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  cancellationReason: string | null;
}

export interface RegistrationRow {
  id: string;
  tournamentId: string;
  userId: string;
  status: string;
  seed: number | null;
  joinedAt: Date;
  eliminatedAt: Date | null;
  finalRank: number | null;
  prizeAmount: number | null;
  paidOutAt: Date | null;
}

export interface RegisteredUserRow extends RegistrationRow {
  email: string;
  fullName: string | null;
}

export interface MatchRow {
  id: string;
  tournamentId: string;
  round: number;
  bracket: string;
  slot: number;
  gameId: string | null;
  whiteUserId: string | null;
  blackUserId: string | null;
  status: string;
  result: string | null;
  winnerUserId: string | null;
  scheduledAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface DetailedMatchRow extends MatchRow {
  game: { id: string; status: string; result: string | null } | null;
  whiteUser: { id: string; email: string; fullName: string | null } | null;
  blackUser: { id: string; email: string; fullName: string | null } | null;
}
