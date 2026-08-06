import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameService } from '../game/game.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getTimeControl } from '../game/config/time-controls';
import {
  buildDoubleEliminationPlan,
  buildSingleEliminationPlan,
  computeStandings,
  pairSwissRound,
  suggestSwissRounds,
  BracketPlan,
  BracketPlayer,
  PlannedMatch,
  SwissMatchResult,
} from './bracket-engine';
import {
  MAX_ENTRY_FEE,
  MAX_PRIZE_SPOTS,
  MATCH_START_GRACE_MS,
} from './tournament.constants';
import {
  DetailedMatchRow,
  MatchRow,
  RegistrationRow,
  TournamentRepository,
  TournamentRow,
} from './tournament.repository';

interface TournamentSettings {
  seeding: string;
  prizeDistribution: number[];
  stageIndex: number;
  stages: string[][];
  edges: Array<{ fromMatchId: string; fromSide: 'winner' | 'loser'; toMatchId: string; toSide: 'white' | 'black' }>;
  plan: PlannedMatch[];
}

function settingsOf(t: TournamentRow): TournamentSettings {
  const s = t.settings ?? {};
  return {
    seeding: (s.seeding as string) ?? 'none',
    prizeDistribution: Array.isArray(s.prizeDistribution) ? (s.prizeDistribution as number[]) : [],
    stageIndex: Number(s.stageIndex ?? 0),
    stages: Array.isArray(s.stages) ? (s.stages as string[][]) : [],
    edges: Array.isArray(s.edges) ? (s.edges as TournamentSettings['edges']) : [],
    plan: Array.isArray(s.plan) ? (s.plan as PlannedMatch[]) : [],
  };
}

const ELIMINATION_FORMATS = new Set(['single_elimination', 'double_elimination']);

/**
 * Tournament lifecycle orchestration. All mutating entry points are serialized
 * per tournament through an in-process mutex so two near-simultaneous match
 * results can't both try to advance the bracket.
 *
 * Money flow (paid tournaments): the entry fee is HELD at registration
 * (available -> locked), CAPTURED when the tournament starts (locked ->
 * platform), and prizes are PAID OUT from the prize pool to the top finishers
 * when it completes. A paid tournament created with prizePool 0 is funded from
 * the actual captured entries at start (the pool is never funded twice and an
 * explicit admin-set pool is never overwritten). Every wallet touch is
 * idempotency-keyed in WalletService, so retries — including retries after a
 * process restart — can never double-hold, double-capture, or double-pay.
 */
@Injectable()
export class TournamentService implements OnModuleInit {
  private readonly logger = new Logger(TournamentService.name);
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repo: TournamentRepository,
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly game: GameService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Register runtime hooks with GameService. This runs at boot and keeps the
    // game module free of any dependency on the tournament module.
    this.game.onGameSettled((gameId) => this.handleGameSettled(gameId));
    this.game.addStaleWaitingExemption((gameId) => this.isTournamentGame(gameId));
  }

  // ==========================================================================
  // MUTEX — serializes every tournament mutation per tournament id
  // ==========================================================================

  private withTournamentLock<T>(tournamentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(tournamentId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(tournamentId, next);
    return next.finally(() => {
      if (this.locks.get(tournamentId) === next) this.locks.delete(tournamentId);
    });
  }

  // ==========================================================================
  // QUERIES
  // ==========================================================================

  async listPublic(filters: { statuses?: string[]; search?: string; take?: number } = {}) {
    const rows = await this.repo.listTournaments({
      statuses: filters.statuses ?? ['registered', 'active', 'draft'],
      visibility: ['public'],
      search: filters.search,
      take: filters.take ?? 50,
      sortBy: 'startTime',
      order: 'asc',
    });
    const counts = await Promise.all(rows.map((t) => this.registrationCounts(t.id)));
    return rows.map((t, i) => ({ ...t, ...counts[i] }));
  }

  async registrationCounts(tournamentId: string) {
    const [registered, waitlisted] = await Promise.all([
      this.repo.countRegistrations(tournamentId, 'registered'),
      this.repo.countRegistrations(tournamentId, 'waitlisted'),
    ]);
    return { playerCount: registered, waitlistCount: waitlisted };
  }

  async getDetail(tournamentId: string, viewerUserId?: string) {
    const t = await this.mustLoad(tournamentId);
    const [counts, myRegistration, standings, bracket, players] = await Promise.all([
      this.registrationCounts(t.id),
      viewerUserId ? this.repo.findRegistration(t.id, viewerUserId) : null,
      t.format === 'swiss' && (t.status === 'active' || t.status === 'completed')
        ? this.computeSwissStandings(t)
        : null,
      t.format !== 'swiss' && (t.status === 'active' || t.status === 'completed')
        ? this.repo.listMatchesDetailed(t.id)
        : null,
      viewerUserId ? Promise.resolve(null) : this.repo.listRegisteredUsers(t.id),
    ]);
    return {
      ...t,
      ...counts,
      myRegistration: myRegistration
        ? { status: myRegistration.status, seed: myRegistration.seed, finalRank: myRegistration.finalRank, prizeAmount: myRegistration.prizeAmount }
        : null,
      standings,
      bracket,
      edges: settingsOf(t).edges,
      players,
    };
  }

  async getBracket(tournamentId: string) {
    const t = await this.mustLoad(tournamentId);
    if (t.format === 'swiss') throw new BadRequestException('Swiss tournaments have standings, not a bracket');
    const matches = await this.repo.listMatchesDetailed(t.id);
    return { matches, edges: settingsOf(t).edges };
  }

  async getStandings(tournamentId: string) {
    const t = await this.mustLoad(tournamentId);
    if (t.format !== 'swiss') throw new BadRequestException('Only Swiss tournaments have standings');
    return this.computeSwissStandings(t);
  }

  async listMyRegistrations(userId: string) {
    const regs = await this.repo.listRegistrationsByUser(userId, 50);
    const withTournaments = await Promise.all(
      regs.map(async (r) => {
        const t = await this.repo.findTournament(r.tournamentId);
        return { ...r, tournament: t };
      }),
    );
    return withTournaments;
  }

  async listAll(filters: { statuses?: string[]; search?: string; take?: number } = {}) {
    const rows = await this.repo.listTournaments({
      statuses: filters.statuses,
      search: filters.search,
      take: filters.take ?? 100,
      sortBy: 'createdAt',
      order: 'desc',
    });
    const counts = await Promise.all(rows.map((t) => this.registrationCounts(t.id)));
    return rows.map((t, i) => ({ ...t, ...counts[i] }));
  }

  async statusOverview() {
    return this.repo.countByStatus();
  }

  /** 'registered' tournaments that are due to start: startTime reached, or registration deadline passed. */
  async listDue(now: Date) {
    const rows = await this.repo.listTournaments({ statuses: ['registered'], take: 100 });
    return rows.filter((t) => {
      if (t.startTime && t.startTime.getTime() <= now.getTime()) return true;
      return !!t.registrationDeadline && t.registrationDeadline.getTime() <= now.getTime();
    });
  }

  async listActive() {
    return this.repo.listTournaments({ statuses: ['active'], take: 100 });
  }

  async getMatchByGameId(gameId: string): Promise<MatchRow | null> {
    return this.repo.findMatchByGameId(gameId);
  }

  /**
   * Admin financial summary for a tournament, built from the append-only
   * wallet ledger (referenceType 'tournament'). Read-only: it never mutates a
   * balance, so it is safe to expose to every admin role.
   *
   * Returns the resolved prize pool, expected/captured/refunded entry money,
   * per-participant payment state, the configured reward distribution with
   * computed amounts, and the recent ledger rows for audit.
   */
  async getFinancialSummary(tournamentId: string) {
    const t = await this.mustLoad(tournamentId);
    const regs = (await this.repo.listRegistrations(t.id)).filter((r) => r.status !== 'waitlisted');

    const rows = await this.prisma.$queryRaw<
      { type: string; amount: number; userId: string; status: string; createdAt: Date; id: string }[]
    >`
      SELECT wt.type AS type, wt.amount AS amount, wt.status AS status, wt.id AS id, wt.created_at AS "createdAt",
             w.user_id AS "userId"
      FROM "wallet_transactions" wt
      JOIN "wallets" w ON w.id = wt.wallet_id
      WHERE wt.reference_type = 'tournament' AND wt.reference_id = ${tournamentId}
      ORDER BY wt.created_at ASC
    `;

    const sum = (type: string) =>
      Number(
        rows
          .filter((r) => r.type === type && r.status === 'completed')
          .reduce((acc, r) => acc + Number(r.amount), 0)
          .toFixed(2),
      );

    const held = sum('entry_fee_hold');
    const captured = sum('entry_fee_capture');
    const refunded = sum('entry_fee_release');
    const prizesPaid = sum('prize_credit');

    const perUser = new Map<string, { held: number; captured: number; refunded: number }>();
    for (const r of rows) {
      const agg = perUser.get(r.userId) ?? { held: 0, captured: 0, refunded: 0 };
      if (r.type === 'entry_fee_hold' && r.status === 'completed') agg.held += Number(r.amount);
      if (r.type === 'entry_fee_capture' && r.status === 'completed') agg.captured += Number(r.amount);
      if (r.type === 'entry_fee_release' && r.status === 'completed') agg.refunded += Number(r.amount);
      perUser.set(r.userId, agg);
    }

    const entryFee = Number(t.entryFee);
    const payments = regs.map((r) => {
      const agg = perUser.get(r.userId) ?? { held: 0, captured: 0, refunded: 0 };
      let entryStatus: 'none' | 'held' | 'refunded' | 'paid';
      if (agg.refunded > 0) entryStatus = 'refunded';
      else if (agg.captured > 0) entryStatus = 'paid';
      else if (agg.held > 0) entryStatus = 'held';
      else entryStatus = 'none';
      return {
        userId: r.userId,
        status: r.status,
        finalRank: r.finalRank,
        entryFee: t.entryType === 'paid' ? entryFee : 0,
        entryStatus,
        prizeAmount: r.prizeAmount ? Number(r.prizeAmount) : null,
        paidOutAt: r.paidOutAt,
      };
    });

    const distribution = settingsOf(t).prizeDistribution.length ? settingsOf(t).prizeDistribution : [100];
    const pool = Number(t.prizePool);
    const rewardSpots = distribution.slice(0, MAX_PRIZE_SPOTS).map((pct, index) => ({
      rank: index + 1,
      percent: pct,
      amount: Number((pool * (pct / 100)).toFixed(2)),
    }));

    return {
      tournament: {
        id: t.id,
        name: t.name,
        format: t.format,
        entryType: t.entryType,
        entryFee: t.entryType === 'paid' ? entryFee : 0,
        prizePool: pool,
        status: t.status,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        cancellationReason: t.cancellationReason,
      },
      totals: {
        participants: regs.length,
        expectedEntries: t.entryType === 'paid' ? Number((entryFee * regs.length).toFixed(2)) : 0,
        held,
        captured,
        refunded,
        prizesPaid,
        platformRetained: Number((captured - prizesPaid).toFixed(2)),
        prizePoolResolved: pool,
      },
      payments,
      distribution: rewardSpots,
      recentTransactions: rows.slice(-50).reverse().map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        userId: r.userId,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  async isTournamentGame(gameId: string): Promise<boolean> {
    return (await this.repo.findMatchByGameId(gameId)) !== null;
  }

  // ==========================================================================
  // ADMIN: CREATE / UPDATE / PUBLISH / START / CANCEL
  // ==========================================================================

  async create(input: {
    name: string;
    description?: string | null;
    format: string;
    visibility: string;
    entryType: string;
    entryFee?: number;
    prizePool?: number;
    maxPlayers: number;
    minPlayers?: number;
    registrationDeadline?: Date | null;
    startTime?: Date | null;
    timeControl: string;
    rules?: string | null;
    rounds?: number | null;
    seeding?: string;
    prizeDistribution?: number[];
    createdBy: string;
  }): Promise<TournamentRow> {
    const validated = this.validateDefinition(input);
    return this.repo.createTournament({
      ...validated,
      settings: {
        seeding: validated.seeding,
        prizeDistribution: validated.prizeDistribution,
      },
      status: 'draft',
      currentRound: 0,
      createdBy: input.createdBy,
    });
  }

  async update(tournamentId: string, input: Parameters<TournamentService['create']>[0], adminId: string) {
    const t = await this.mustLoad(tournamentId);
    if (t.status !== 'draft') throw new ConflictException('Only draft tournaments can be edited');

    const validated = this.validateDefinition(input);
    await this.repo.updateTournament(t.id, {
      name: validated.name,
      description: validated.description,
      format: validated.format,
      visibility: validated.visibility,
      entryType: validated.entryType,
      entryFee: validated.entryFee,
      prizePool: validated.prizePool,
      maxPlayers: validated.maxPlayers,
      minPlayers: validated.minPlayers,
      registrationDeadline: validated.registrationDeadline,
      startTime: validated.startTime,
      timeControl: validated.timeControl,
      rules: validated.rules,
      rounds: validated.rounds,
      settings: JSON.stringify({
        seeding: validated.seeding,
        prizeDistribution: validated.prizeDistribution,
      }),
    });
    this.logger.log(`Tournament ${t.id} updated by ${adminId}`);
    return this.repo.findTournament(t.id);
  }

  async publish(tournamentId: string, adminId: string) {
    const t = await this.mustLoad(tournamentId);
    if (t.status !== 'draft') throw new ConflictException('Only draft tournaments can be published');
    await this.repo.updateTournament(t.id, { status: 'registered' });
    this.logger.log(`Tournament ${t.id} published by ${adminId}`);
    return this.repo.findTournament(t.id);
  }

  async start(tournamentId: string, adminId?: string) {
    return this.withTournamentLock(tournamentId, async () => {
      const t = await this.mustLoad(tournamentId);
      if (t.status === 'active' || t.status === 'completed') {
        throw new ConflictException('Tournament has already started');
      }
      if (t.status === 'cancelled') throw new ConflictException('Tournament was cancelled');

      return this.startTournament(t, adminId);
    });
  }

  async cancel(tournamentId: string, reason: string, adminId: string) {
    return this.withTournamentLock(tournamentId, async () => {
      const t = await this.mustLoad(tournamentId);
      if (t.status === 'completed') throw new ConflictException('Cannot cancel a completed tournament');
      if (t.status === 'active') throw new ConflictException('Cannot cancel a started tournament');
      if (t.status === 'cancelled') return this.repo.findTournament(t.id);

      await this.releaseAllHolds(t);

      await this.repo.updateTournament(t.id, {
        status: 'cancelled',
        cancellationReason: reason,
        endedAt: new Date(),
      });

      const regs = await this.repo.listRegistrations(t.id);
      for (const r of regs) {
        await this.notify(
          r.userId,
          'Your tournament was cancelled',
          `"${t.name}" was cancelled. ${reason ? `Reason: ${reason}` : 'Any entry fee has been returned to your balance.'}`,
          { tournamentId: t.id, type: 'cancelled' },
        );
      }
      this.logger.log(`Tournament ${t.id} cancelled by ${adminId}: ${reason}`);
      return this.repo.findTournament(t.id);
    });
  }

  // ==========================================================================
  // PLAYER: REGISTER / WITHDRAW
  // ==========================================================================

  async register(tournamentId: string, userId: string) {
    return this.withTournamentLock(tournamentId, async () => {
      const t = await this.mustLoad(tournamentId);
      if (t.status !== 'registered' && t.status !== 'draft') {
        throw new ForbiddenException('Registration for this tournament is closed');
      }
      if (t.registrationDeadline && t.registrationDeadline.getTime() < Date.now()) {
        throw new ForbiddenException('The registration deadline has passed');
      }
      const existing = await this.repo.findRegistration(t.id, userId);
      if (existing) {
        throw new ConflictException(existing.status === 'waitlisted' ? 'You are already on the waitlist' : 'You are already registered');
      }

      const registeredCount = await this.repo.countRegistrations(t.id, 'registered');
      if (registeredCount >= t.maxPlayers) {
        const reg = await this.repo.createRegistration(t.id, userId, 'waitlisted');
        this.logger.log(`Player ${userId} waitlisted for tournament ${t.id}`);
        return { ...reg, waitlisted: true };
      }

      if (t.entryType === 'paid' && t.entryFee > 0) {
        await this.wallet.holdTournamentEntry(userId, Number(t.entryFee), t.id, `tournament_entry_hold:${t.id}:${userId}`);
        try {
          await this.repo.createRegistration(t.id, userId, 'registered');
        } catch (err) {
          await this.wallet
            .releaseTournamentEntry(userId, Number(t.entryFee), t.id, `tournament_entry_release:${t.id}:${userId}`)
            .catch(() => {});
          throw err;
        }
      } else {
        await this.repo.createRegistration(t.id, userId, 'registered');
      }

      const reg = (await this.repo.findRegistration(t.id, userId))!;
      this.logger.log(`Player ${userId} registered for tournament ${t.id}`);
      return { ...reg, waitlisted: false };
    });
  }

  async withdraw(tournamentId: string, userId: string) {
    return this.withTournamentLock(tournamentId, async () => {
      const t = await this.mustLoad(tournamentId);
      if (t.status === 'active') throw new ForbiddenException('Cannot withdraw after the tournament has started');
      const reg = await this.repo.findRegistration(t.id, userId);
      if (!reg) throw new NotFoundException('You are not registered for this tournament');

      await this.repo.deleteRegistration(t.id, userId);
      if (t.entryType === 'paid' && t.entryFee > 0 && reg.status === 'registered') {
        await this.wallet.releaseTournamentEntry(userId, Number(t.entryFee), t.id, `tournament_entry_release:${t.id}:${userId}`);
      }

      // Promote the oldest waitlisted player into the freed slot.
      if (reg.status === 'registered' && t.status === 'registered') {
        await this.promoteNextWaitlisted(t);
      }

      this.logger.log(`Player ${userId} withdrew from tournament ${t.id}`);
      return { success: true };
    });
  }

  /** Admin removal of a registered/waitlisted player before the tournament goes live. */
  async removePlayer(tournamentId: string, userId: string) {
    return this.withTournamentLock(tournamentId, async () => {
      const t = await this.mustLoad(tournamentId);
      if (t.status === 'active' || t.status === 'completed') {
        throw new BadRequestException('Cannot remove players once the tournament is live or finished');
      }
      const reg = await this.repo.findRegistration(t.id, userId);
      if (!reg) throw new NotFoundException('Player is not registered for this tournament');

      await this.repo.deleteRegistration(t.id, userId);
      if (t.entryType === 'paid' && t.entryFee > 0 && reg.status === 'registered') {
        await this.wallet.releaseTournamentEntry(userId, Number(t.entryFee), t.id, `tournament_entry_release:${t.id}:${userId}`);
      }
      if (reg.status === 'registered' && t.status === 'registered') {
        await this.promoteNextWaitlisted(t);
      }
      await this.notify(userId, 'Removed from tournament', `You were removed from "${t.name}" by an administrator.`, {
        tournamentId: t.id,
        type: 'removed',
      });
      this.logger.log(`Admin removed player ${userId} from tournament ${t.id}`);
      return { success: true };
    });
  }

  private async promoteNextWaitlisted(t: TournamentRow) {
    const waitlisted = await this.repo.listRegistrations(t.id);
    const next = waitlisted
      .filter((r) => r.status === 'waitlisted')
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
    if (!next) return;

    if (t.entryType === 'paid' && t.entryFee > 0) {
      try {
        await this.wallet.holdTournamentEntry(next.userId, Number(t.entryFee), t.id, `tournament_entry_hold:${t.id}:${next.userId}`);
      } catch {
        // Promoted player can no longer afford the fee — leave them waitlisted
        // and stop; they can re-register later if they top up.
        this.logger.warn(`Waitlisted player ${next.userId} could not afford the entry fee on promotion`);
        return;
      }
    }
    await this.repo.updateRegistration(t.id, next.userId, { status: 'registered' });
    await this.notify(
      next.userId,
      'You are in the tournament',
      `A spot opened in "${t.name}" — you have been registered.`,
      { tournamentId: t.id, type: 'promoted' },
    );
  }

  // ==========================================================================
  // START (also called by the scheduler when a tournament comes due)
  // ==========================================================================

  private async startTournament(t: TournamentRow, adminId?: string) {
    const regs = (await this.repo.listRegistrations(t.id)).filter((r) => r.status === 'registered');
    if (regs.length < t.minPlayers) {
      // The tournament can't run — cancel it and refund every hold rather than
      // starting a hollow bracket.
      await this.releaseAllHolds(t);
      await this.repo.updateTournament(t.id, {
        status: 'cancelled',
        cancellationReason: 'Not enough players by the start time',
        endedAt: new Date(),
      });
      for (const r of regs) {
        await this.notify(r.userId, 'Tournament cancelled', `"${t.name}" did not get enough players and was cancelled.`, {
          tournamentId: t.id,
          type: 'cancelled',
        });
      }
      this.logger.log(`Tournament ${t.id} cancelled at start: insufficient players (${regs.length}/${t.minPlayers})`);
      return this.repo.findTournament(t.id);
    }

    const category = getTimeControl(t.timeControl).category;
    const players = await this.buildPlayers(regs, category);
    const settings = settingsOf(t);

    // Capture entry fees BEFORE any bracket work so a failure mid-capture
    // can't leave a started tournament with stranded locks.
    let fundedPool = Number(t.prizePool);
    if (t.entryType === 'paid' && t.entryFee > 0) {
      for (const r of regs) {
        await this.wallet.captureTournamentEntry(r.userId, Number(t.entryFee), t.id, `tournament_entry_capture:${t.id}:${r.userId}`);
      }

      // A paid tournament created with prizePool 0 is documented as "computed
      // from actual entries at payout" — fund the pool from the fees that were
      // just captured so prizes always match what the players actually paid.
      // An explicit admin-set pool is never overwritten (it may be subsidized).
      if (fundedPool === 0) {
        fundedPool = Number((Number(t.entryFee) * regs.length).toFixed(2));
        await this.repo.updateTournament(t.id, { prizePool: fundedPool });
        this.logger.log(`Tournament ${t.id}: prize pool funded from entries ($${fundedPool.toFixed(2)})`);
      }
    }

    if (t.format === 'swiss') {
      await this.startSwiss(t, players, settings);
    } else {
      await this.startElimination(t, players, settings);
    }

    await this.repo.updateTournament(t.id, { status: 'active', startedAt: new Date(), currentRound: 1 });

    for (const r of regs) {
      await this.notify(
        r.userId,
        'Your tournament has started',
        `"${t.name}" has started — your round 1 game is ready to play.`,
        { tournamentId: t.id, type: 'started' },
      );
    }
    this.logger.log(`Tournament ${t.id} started (${t.format}, ${regs.length} players) by ${adminId ?? 'scheduler'}`);
    return this.repo.findTournament(t.id);
  }

  private async buildPlayers(regs: RegistrationRow[], category: string): Promise<BracketPlayer[]> {
    const ids = regs.map((r) => r.userId);
    const ratings = await this.prisma.rating.findMany({ where: { userId: { in: ids }, gameMode: category }, select: { userId: true, rating: true } });
    const ratingMap = new Map(ratings.map((r) => [r.userId, Number(r.rating)]));
    return regs.map((r) => ({ id: r.userId, rating: ratingMap.get(r.userId) ?? null }));
  }

  private async startElimination(t: TournamentRow, players: BracketPlayer[], settings: TournamentSettings) {
    const mode = settings.seeding as 'none' | 'rating' | 'random';
    // Randomized seeding draws a fresh seed per tournament — without this every
    // 'random'-seeded bracket would be identical (the engine's default seed is
    // fixed so unit tests stay reproducible). The seed is persisted inside the
    // plan, so restarts re-read the same bracket.
    const seeding = mode === 'random' ? { mode, randomSeed: Math.floor(Math.random() * 0xffffffff), prefix: t.id } : { mode, prefix: t.id };
    const plan =
      t.format === 'double_elimination'
        ? buildDoubleEliminationPlan(players, seeding)
        : buildSingleEliminationPlan(players, seeding);

    await this.repo.updateTournament(t.id, {
      rounds: plan.stages.length,
      settings: JSON.stringify({
        ...t.settings,
        seeding: settings.seeding,
        prizeDistribution: settings.prizeDistribution,
        stageIndex: 0,
        stages: plan.stages.map((stage) => stage.map((m) => m.id)),
        edges: plan.edges,
        plan: plan.matches,
      }),
    });

    await this.insertPlannedStage(t, plan, plan.stages[0]);
  }

  private async startSwiss(t: TournamentRow, players: BracketPlayer[], settings: TournamentSettings) {
    const totalRounds = t.rounds ?? suggestSwissRounds(players.length);
    await this.repo.updateTournament(t.id, {
      rounds: totalRounds,
      settings: JSON.stringify({ ...t.settings, seeding: settings.seeding, prizeDistribution: settings.prizeDistribution }),
    });
    await this.pairSwissRoundAndStart(t, 1);
  }

  // ==========================================================================
  // MATCH-START / ADVANCEMENT
  // ==========================================================================

  /** Inserts a planned stage's match rows, resolves edge-fed participants, marks byes, and starts games. */
  private async insertPlannedStage(t: TournamentRow, plan: BracketPlan, stage: PlannedMatch[]) {
    for (const pm of stage) {
      const white = pm.whiteUserId ?? (await this.resolveEdgeSide(t, plan, pm.id, 'white'));
      const black = pm.blackUserId ?? (await this.resolveEdgeSide(t, plan, pm.id, 'black'));
      await this.repo.insertMatch({
        id: pm.id,
        tournamentId: t.id,
        round: pm.round,
        bracket: pm.bracket,
        slot: pm.slot,
        whiteUserId: white,
        blackUserId: black,
        status: 'scheduled',
      });
    }

    for (const pm of stage) {
      if (!pm.bye) continue;
      const match = await this.repo.findMatchBySlot(t.id, pm.round, pm.bracket, pm.slot);
      if (!match) continue;
      const winner = match.whiteUserId ?? match.blackUserId!;
      await this.repo.updateMatch(match.id, { status: 'bye', winnerUserId: winner, endedAt: new Date() });
    }

    await this.createGamesForStage(t, stage);
  }

  private async resolveEdgeSide(t: TournamentRow, plan: BracketPlan, matchId: string, side: 'white' | 'black'): Promise<string | null> {
    const edge = plan.edges.find((e) => e.toMatchId === matchId && e.toSide === side);
    if (!edge) return null;
    const source = await this.repo.findMatch(edge.fromMatchId);
    if (!source || !source.winnerUserId) return null;
    if (edge.fromSide === 'winner') return source.winnerUserId;
    return source.whiteUserId === source.winnerUserId ? source.blackUserId : source.whiteUserId;
  }

  private async createGamesForStage(t: TournamentRow, stage: PlannedMatch[]) {
    for (const pm of stage) {
      const match = await this.repo.findMatchBySlot(t.id, pm.round, pm.bracket, pm.slot);
      if (!match || match.status !== 'scheduled' || !match.whiteUserId || !match.blackUserId) continue;
      await this.linkGameToMatch(t, match);
    }
  }

  /** Creates the underlying game row (status 'waiting') and notifies both players to join. */
  private async linkGameToMatch(t: TournamentRow, match: MatchRow, rematch = false) {
    const [white, black] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: match.whiteUserId! }, select: { fullName: true, email: true } }),
      this.prisma.user.findUnique({ where: { id: match.blackUserId! }, select: { fullName: true, email: true } }),
    ]);

    const game = await this.prisma.game.create({
      data: {
        playerWhiteId: match.whiteUserId!,
        playerBlackId: match.blackUserId!,
        entryFee: 0,
        timeControl: t.timeControl,
        status: 'waiting',
      },
    });
    await this.repo.updateMatch(match.id, { gameId: game.id, status: 'ongoing', scheduledAt: new Date(), endedAt: null });

    const whiteName = white?.fullName ?? white?.email ?? 'your opponent';
    const blackName = black?.fullName ?? black?.email ?? 'your opponent';
    const title = rematch ? 'Tournament rematch ready' : 'Tournament match ready';
    const message = rematch
      ? `Your previous game vs ${blackName} was drawn — a rematch is ready. Join now.`
      : `Your game vs ${blackName} is ready — join now.`;
    await this.notify(match.whiteUserId!, title, message, { tournamentId: t.id, gameId: game.id, type: 'match_ready' });
    await this.notify(match.blackUserId!, title, `Your game vs ${whiteName} is ready — join now.`, {
      tournamentId: t.id,
      gameId: game.id,
      type: 'match_ready',
    });
    this.logger.log(`Tournament ${t.id}: created game ${game.id} for match ${match.id}`);
  }

  private async pairSwissRoundAndStart(t: TournamentRow, round: number) {
    const standings = await this.computeSwissStandings(t);
    const pairings = pairSwissRound(standings, round);

    for (const [index, pairing] of pairings.entries()) {
      const id = `${t.id}-swiss-r${round}-s${index + 1}`;
      if (pairing.bye) {
        await this.repo.insertMatch({
          id,
          tournamentId: t.id,
          round,
          bracket: 'swiss',
          slot: index + 1,
          whiteUserId: pairing.byeUserId ?? pairing.whiteUserId,
          blackUserId: null,
          status: 'scheduled',
        });
        const match = await this.repo.findMatchBySlot(t.id, round, 'swiss', index + 1);
        if (match) {
          await this.repo.updateMatch(match.id, { status: 'bye', winnerUserId: match.whiteUserId!, endedAt: new Date() });
        }
      } else {
        await this.repo.insertMatch({
          id,
          tournamentId: t.id,
          round,
          bracket: 'swiss',
          slot: index + 1,
          whiteUserId: pairing.whiteUserId,
          blackUserId: pairing.blackUserId,
          status: 'scheduled',
        });
        const match = await this.repo.findMatchBySlot(t.id, round, 'swiss', index + 1);
        if (match) await this.linkGameToMatch(t, match);
      }
    }
  }

  // ==========================================================================
  // GAME-RESULT HOOK
  // ==========================================================================

  /** Called (fire-and-forget) by GameService after any game settles. */
  async handleGameSettled(gameId: string) {
    try {
      const match = await this.repo.findMatchByGameId(gameId);
      if (!match) return;
      await this.withTournamentLock(match.tournamentId, async () => {
        const t = await this.mustLoad(match.tournamentId);
        if (t.status !== 'active') return;

        const fresh = await this.repo.findMatch(match.id);
        if (!fresh || fresh.status === 'completed' || fresh.status === 'bye' || fresh.status === 'cancelled') return;

        const game = await this.prisma.game.findUnique({ where: { id: gameId } });
        if (!game || game.status !== 'completed') return;

        if (game.result === 'draw' && ELIMINATION_FORMATS.has(t.format)) {
          // A knockout draw can't advance anyone — both players replay the match.
          await this.replayMatch(t, fresh);
          return;
        }

        const winnerId = game.winnerId;
        await this.repo.updateMatch(fresh.id, {
          status: 'completed',
          result: game.result,
          winnerUserId: winnerId,
          endedAt: new Date(),
        });

        if (winnerId && t.format !== 'swiss') {
          const loserId = fresh.whiteUserId === winnerId ? fresh.blackUserId : fresh.whiteUserId;
          const isEliminating =
            t.format === 'single_elimination' || fresh.bracket === 'losers' || fresh.bracket === 'grand_final';
          if (loserId && isEliminating) {
            await this.repo.updateRegistration(t.id, loserId, { status: 'eliminated', eliminatedAt: new Date() });
          }
        }

        await this.applyMatchResult(t.id);
      });
    } catch (err) {
      this.logger.error(`Failed to handle game-settled for ${gameId}: ${(err as Error).message}`);
    }
  }

  private async replayMatch(t: TournamentRow, match: MatchRow) {
    await this.linkGameToMatch(t, match, true);
    this.logger.log(`Tournament ${t.id}: match ${match.id} drawn — replay scheduled`);
  }

  /**
   * Re-reads the freshest match state and advances whatever is now complete.
   * Idempotent: re-invoking after a completed match is a no-op, so concurrent
   * settlement paths racing here are safe.
   */
  private async applyMatchResult(tournamentId: string) {
    const t = await this.mustLoad(tournamentId);
    if (t.status !== 'active') return;

    if (t.format === 'swiss') {
      const round = t.currentRound;
      const matches = await this.repo.listMatchesByRound(t.id, round);
      if (matches.length && matches.every((m) => m.status === 'completed' || m.status === 'bye')) {
        if (round >= (t.rounds ?? 1)) {
          await this.finishTournament(t);
        } else {
          await this.repo.updateTournament(t.id, { currentRound: round + 1 });
          await this.pairSwissRoundAndStart(t, round + 1);
        }
      }
      return;
    }

    // Elimination — was the current stage's last match just completed?
    const settings = settingsOf(t);
    const stage = settings.stages[settings.stageIndex];
    if (!stage || stage.length === 0) return;

    const matches = await this.repo.listMatches(t.id);
    const byId = new Map(matches.map((m) => [m.id, m]));
    const stageComplete = stage.every((id) => {
      const m = byId.get(id);
      return m && (m.status === 'completed' || m.status === 'bye');
    });
    if (!stageComplete) return;

    if (settings.stageIndex >= settings.stages.length - 1) {
      await this.finishTournament(t);
    } else {
      await this.advanceEliminationStage(t);
    }
  }

  private async advanceEliminationStage(t: TournamentRow) {
    const settings = settingsOf(t);
    const nextIndex = settings.stageIndex + 1;
    const stageIds = settings.stages[nextIndex];
    if (!stageIds || stageIds.length === 0) return;

    const plan: BracketPlan = { matches: settings.plan, edges: settings.edges, stages: [] };
    const stage = stageIds
      .map((id) => settings.plan.find((m) => m.id === id))
      .filter((m): m is PlannedMatch => Boolean(m));

    await this.insertPlannedStage(t, plan, stage);

    const nextRound = await this.computeNextMainRound(t);
    await this.repo.updateTournament(t.id, {
      currentRound: nextRound,
      settings: JSON.stringify({ ...t.settings, stageIndex: nextIndex }),
    });
  }

  private async computeNextMainRound(t: TournamentRow): Promise<number> {
    const matches = await this.repo.listMatches(t.id);
    const rounds = [...new Set(matches.filter((m) => m.bracket === 'main').map((m) => m.round))];
    return rounds.length ? Math.max(...rounds) : t.currentRound;
  }

  // ==========================================================================
  // FINISH / PAYOUT
  // ==========================================================================

  private async finishTournament(t: TournamentRow) {
    const regs = (await this.repo.listRegistrations(t.id)).filter((r) => r.status !== 'waitlisted');
    const matches = await this.repo.listMatches(t.id);
    const ranked = await this.computeFinalRanks(t, regs, matches);

    for (const { userId, rank } of ranked) {
      await this.repo.updateRegistration(t.id, userId, { finalRank: rank });
    }

    // Prizes only for paid tournaments with a funded prize pool.
    if (t.entryType === 'paid' && Number(t.prizePool) > 0) {
      await this.payPrizes(t, ranked);
    }

    await this.repo.updateTournament(t.id, { status: 'completed', endedAt: new Date() });

    const champion = ranked.find((r) => r.rank === 1);
    for (const r of regs) {
      await this.notify(
        r.userId,
        'Tournament complete',
        `"${t.name}" has finished.${champion && champion.userId === r.userId ? ' Congratulations — you won!' : ''}`,
        { tournamentId: t.id, type: 'completed', finalRank: ranked.find((x) => x.userId === r.userId)?.rank },
      );
    }
    this.logger.log(`Tournament ${t.id} completed (${t.format})`);
  }

  private async computeFinalRanks(t: TournamentRow, regs: RegistrationRow[], matches: MatchRow[]): Promise<{ userId: string; rank: number }[]> {
    if (t.format === 'swiss') {
      const standings = await this.computeSwissStandingsFromMatches(t, matches);
      return standings.map((s, i) => ({ userId: s.id, rank: i + 1 }));
    }

    // Elimination: champion is the winner of the most recently completed match
    // (the final); everyone else is ranked by how late they were eliminated.
    const completed = matches.filter((m) => m.status === 'completed' && m.winnerUserId);
    const finalMatch = [...completed].sort((a, b) => new Date(b.endedAt ?? 0).getTime() - new Date(a.endedAt ?? 0).getTime())[0];
    const championId = finalMatch?.winnerUserId ?? null;

    const bySeed = new Map(regs.map((r) => [r.userId, r.seed ?? Number.MAX_SAFE_INTEGER]));
    const others = regs
      .filter((r) => r.userId !== championId)
      .sort((a, b) => {
        const ae = a.eliminatedAt ? a.eliminatedAt.getTime() : 0;
        const be = b.eliminatedAt ? b.eliminatedAt.getTime() : 0;
        return be - ae || bySeed.get(a.userId)! - bySeed.get(b.userId)! || a.userId.localeCompare(b.userId);
      });

    const ranked: { userId: string; rank: number }[] = [];
    if (championId) ranked.push({ userId: championId, rank: 1 });
    others.forEach((r, i) => ranked.push({ userId: r.userId, rank: i + 2 }));
    return ranked;
  }

  private async payPrizes(t: TournamentRow, ranked: { userId: string; rank: number }[]) {
    const distribution = settingsOf(t).prizeDistribution;
    const pctList = distribution.length ? distribution : [100];
    const pool = Number(t.prizePool);

    for (const [index, pct] of pctList.slice(0, MAX_PRIZE_SPOTS).entries()) {
      const amount = Number((pool * (pct / 100)).toFixed(2));
      if (amount <= 0) continue;
      const winner = ranked.find((r) => r.rank === index + 1);
      if (!winner) continue;

      await this.wallet.payoutTournamentPrize(
        winner.userId,
        amount,
        t.id,
        `tournament_prize:${t.id}:${winner.userId}`,
      );
      await this.repo.updateRegistration(t.id, winner.userId, { prizeAmount: amount, paidOutAt: new Date() });
      await this.notify(winner.userId, 'Tournament prize paid', `You won $${amount.toFixed(2)} in "${t.name}".`, {
        tournamentId: t.id,
        type: 'prize_paid',
        amount,
      });
    }
    this.logger.log(`Tournament ${t.id}: paid ${pctList.length} prize spots from a pool of $${pool.toFixed(2)}`);
  }

  // ==========================================================================
  // SWISS STANDINGS
  // ==========================================================================

  private async computeSwissStandings(t: TournamentRow) {
    const matches = await this.repo.listMatches(t.id);
    return this.computeSwissStandingsFromMatches(t, matches);
  }

  private async computeSwissStandingsFromMatches(t: TournamentRow, matches: MatchRow[]) {
    const regs = (await this.repo.listRegistrations(t.id)).filter((r) => r.status !== 'waitlisted');
    const category = getTimeControl(t.timeControl).category;
    const players = await this.buildPlayers(regs, category);

    const results: SwissMatchResult[] = matches
      .filter((m) => m.status === 'completed' && m.whiteUserId && m.blackUserId)
      .map((m) => ({ whiteUserId: m.whiteUserId!, blackUserId: m.blackUserId!, winnerUserId: m.winnerUserId }));
    const standings = computeStandings(players, results);

    const ids = standings.map((s) => s.id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return standings.map((s) => ({
      ...s,
      name: userMap.get(s.id)?.fullName ?? userMap.get(s.id)?.email ?? null,
      email: userMap.get(s.id)?.email ?? null,
    }));
  }

  // ==========================================================================
  // NO-SHOW RESOLUTION (scheduler)
  // ==========================================================================

  /** Resolves matches whose game never got both players in, awarding a walkover to the player who did join. */
  async resolveNoShowMatches(tournamentId: string) {
    return this.withTournamentLock(tournamentId, async () => {
      const t = await this.mustLoad(tournamentId);
      if (t.status !== 'active') return { resolved: 0 };

      const matches = await this.repo.listMatches(t.id);
      const graceMs = MATCH_START_GRACE_MS;
      const now = Date.now();
      let resolved = 0;

      // Higher seed advances by default when a match can't produce a winner
      // (nobody joined, or the game was cancelled/unrecoverable after a
      // restart). Swiss doesn't eliminate, but still needs a result so the
      // round can complete.
      const seedMap = new Map(
        (await this.repo.listRegistrations(t.id)).map((r) => [r.userId, r.seed ?? Number.MAX_SAFE_INTEGER]),
      );

      for (const match of matches.filter((m) => m.status === 'ongoing' && m.gameId)) {
        const game = await this.prisma.game.findUnique({ where: { id: match.gameId! } });
        if (!game) continue;

        if (game.status === 'aborted') {
          // The game was cancelled / unrecoverable (e.g. Redis state lost with
          // no moves after a restart, or the recovery sweep gave up on it).
          // Settlement never fired, so the tournament hook never ran and the
          // match would otherwise stall the bracket forever. Void the match and
          // default-advance the higher seed so tournament progress resumes.
          await this.resolveWalkover(t, match, seedMap, 'cancelled');
          resolved += 1;
          continue;
        }

        if (game.status !== 'waiting') continue;
        if (now - game.createdAt.getTime() < graceMs) continue;

        const joined = await this.game.getJoinedPlayers(game.id);
        const white = match.whiteUserId!;
        const black = match.blackUserId!;
        const whiteJoined = joined.includes(white);
        const blackJoined = joined.includes(black);

        let winner: string;
        let loser: string;
        if (whiteJoined && !blackJoined) {
          winner = white;
          loser = black;
        } else if (blackJoined && !whiteJoined) {
          winner = black;
          loser = white;
        } else {
          // Neither player showed up — the higher seed advances by default.
          winner = (seedMap.get(white) ?? 0) <= (seedMap.get(black) ?? 0) ? white : black;
          loser = winner === white ? black : white;
        }

        await this.resolveWalkover(t, match, seedMap, 'no_show', winner, loser);
        await this.prisma.game.update({ where: { id: game.id }, data: { status: 'aborted', result: 'aborted', endedAt: new Date() } });
        resolved += 1;
      }

      if (resolved > 0) await this.applyMatchResult(t.id);
      return { resolved };
    });
  }

  /** Marks a tournament match resolved via walkover and eliminates the loser (single/double elim). */
  private async resolveWalkover(
    t: TournamentRow,
    match: MatchRow,
    seedMap: Map<string, number>,
    result: 'no_show' | 'cancelled',
    winner?: string,
    loser?: string,
  ) {
    const white = match.whiteUserId!;
    const black = match.blackUserId!;
    const w = winner ?? ((seedMap.get(white) ?? 0) <= (seedMap.get(black) ?? 0) ? white : black);
    const l = loser ?? (w === white ? black : white);

    await this.repo.updateMatch(match.id, { status: 'completed', result, winnerUserId: w, endedAt: new Date() });
    if (t.format !== 'swiss') {
      await this.repo.updateRegistration(t.id, l, { status: 'eliminated', eliminatedAt: new Date() });
    }
    await this.notify(
      l,
      result === 'no_show' ? 'You lost by no-show' : 'Your match was cancelled',
      result === 'no_show'
        ? `You did not join your game in "${t.name}" in time.`
        : `Your game in "${t.name}" could not be played — the higher seed advanced.`,
      { tournamentId: t.id, type: result },
    );
    this.logger.log(`Tournament ${t.id}: match ${match.id} resolved as ${result} (${w} advances)`);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private async mustLoad(tournamentId: string): Promise<TournamentRow> {
    const t = await this.repo.findTournament(tournamentId);
    if (!t) throw new NotFoundException('Tournament not found');
    return t;
  }

  private async releaseAllHolds(t: TournamentRow) {
    if (t.entryType !== 'paid' || Number(t.entryFee) <= 0) return;
    const regs = await this.repo.listRegistrations(t.id);
    for (const r of regs.filter((x) => x.status === 'registered')) {
      await this.wallet.releaseTournamentEntry(r.userId, Number(t.entryFee), t.id, `tournament_entry_release:${t.id}:${r.userId}`);
    }
  }

  private async notify(userId: string, title: string, message: string, metadata: Record<string, unknown>) {
    try {
      await this.notifications.send(userId, 'push', 'tournament', title, message, metadata);
    } catch (err) {
      this.logger.warn(`Failed to notify ${userId}: ${(err as Error).message}`);
    }
  }

  private validateDefinition(input: {
    name: string;
    description?: string | null;
    format: string;
    visibility: string;
    entryType: string;
    entryFee?: number;
    prizePool?: number;
    maxPlayers: number;
    minPlayers?: number;
    registrationDeadline?: Date | null;
    startTime?: Date | null;
    timeControl: string;
    rules?: string | null;
    rounds?: number | null;
    seeding?: string;
    prizeDistribution?: number[];
  }) {
    const name = (input.name ?? '').trim();
    if (!name || name.length > 120) throw new BadRequestException('Name is required (max 120 characters)');

    if (!['single_elimination', 'double_elimination', 'swiss'].includes(input.format)) {
      throw new BadRequestException('Unsupported tournament format');
    }
    if (!['public', 'private'].includes(input.visibility)) {
      throw new BadRequestException('Unsupported visibility');
    }
    if (!['free', 'paid'].includes(input.entryType)) {
      throw new BadRequestException('Unsupported entry type');
    }
    // getTimeControl throws on an unknown id (fail-fast callers elsewhere rely
    // on that), so normalize it to a clean 400 here rather than leaking a 500.
    let knownTimeControl = false;
    try {
      knownTimeControl = Boolean(getTimeControl(input.timeControl));
    } catch {
      knownTimeControl = false;
    }
    if (!knownTimeControl) throw new BadRequestException('Unknown time control');

    const entryFee = Number(input.entryFee ?? 0);
    const prizePool = Number(input.prizePool ?? 0);
    if (!Number.isFinite(entryFee) || entryFee < 0 || entryFee > MAX_ENTRY_FEE) {
      throw new BadRequestException(`Entry fee must be between 0 and ${MAX_ENTRY_FEE}`);
    }
    if (input.entryType === 'paid' && entryFee <= 0) {
      throw new BadRequestException('Paid tournaments require an entry fee');
    }
    if (input.entryType === 'free' && entryFee !== 0) {
      throw new BadRequestException('Free tournaments cannot charge an entry fee');
    }
    if (!Number.isFinite(prizePool) || prizePool < 0) {
      throw new BadRequestException('Prize pool must be a non-negative number');
    }

    const maxPlayers = Math.floor(Number(input.maxPlayers));
    const minPlayers = Math.floor(Number(input.minPlayers ?? 2));
    if (!Number.isFinite(maxPlayers) || maxPlayers < 2 || maxPlayers > 512) {
      throw new BadRequestException('Max players must be between 2 and 512');
    }
    if (!Number.isFinite(minPlayers) || minPlayers < 2 || minPlayers > maxPlayers) {
      throw new BadRequestException('Min players must be at least 2 and no more than max players');
    }

    let rounds = input.rounds == null ? null : Math.floor(Number(input.rounds));
    if (input.format === 'swiss') {
      const suggested = suggestSwissRounds(maxPlayers);
      rounds = rounds == null ? suggested : Math.max(1, Math.min(rounds, 9));
    } else if (rounds != null) {
      rounds = null; // elimination rounds are derived from the bracket
    }

    const seeding = input.seeding ?? 'none';
    if (!['none', 'rating', 'random'].includes(seeding)) throw new BadRequestException('Unsupported seeding mode');

    const prizeDistribution = Array.isArray(input.prizeDistribution)
      ? input.prizeDistribution.map((p) => Number(p))
      : [];
    if (prizeDistribution.length > MAX_PRIZE_SPOTS) {
      throw new BadRequestException(`Prize distribution can define at most ${MAX_PRIZE_SPOTS} spots`);
    }
    const total = prizeDistribution.reduce((sum, p) => sum + p, 0);
    if (prizeDistribution.some((p) => !Number.isFinite(p) || p < 0)) {
      throw new BadRequestException('Prize distribution percentages must be non-negative');
    }
    if (total > 100) throw new BadRequestException('Prize distribution percentages cannot exceed 100');

    return {
      name,
      description: input.description?.trim() || null,
      format: input.format,
      visibility: input.visibility,
      entryType: input.entryType,
      entryFee,
      prizePool,
      maxPlayers,
      minPlayers,
      registrationDeadline: input.registrationDeadline ?? null,
      startTime: input.startTime ?? null,
      timeControl: input.timeControl,
      rules: input.rules?.trim() || null,
      rounds,
      seeding,
      prizeDistribution,
    };
  }
}

export type { DetailedMatchRow, TournamentRow };
