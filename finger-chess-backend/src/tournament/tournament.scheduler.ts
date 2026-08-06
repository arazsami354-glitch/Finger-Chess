import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TournamentService } from './tournament.service';

/**
 * Tournament housekeeping sweep. Idempotent by design — starting a tournament
 * that's already active is a no-op Conflict that's swallowed here, resolving
 * no-shows re-checks the game status before acting, and the round-advance /
 * finish logic in TournamentService is guarded by the per-tournament mutex, so
 * multiple instances (or an overlap with an admin "start" click) can never
 * double-process a tournament.
 */
@Injectable()
export class TournamentScheduler {
  private readonly logger = new Logger(TournamentScheduler.name);

  constructor(private readonly tournament: TournamentService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleTournamentSweep() {
    await this.startDueTournaments();
    await this.settleNoShows();
  }

  private async startDueTournaments() {
    const now = new Date();
    const due = await this.tournament.listDue(now);
    for (const t of due) {
      try {
        await this.tournament.start(t.id);
      } catch (err) {
        this.logger.warn(`Scheduler failed to start tournament ${t.id}: ${(err as Error).message}`);
      }
    }
  }

  private async settleNoShows() {
    const active = await this.tournament.listActive();
    for (const t of active) {
      try {
        await this.tournament.resolveNoShowMatches(t.id);
      } catch (err) {
        this.logger.warn(`Scheduler failed no-show sweep for tournament ${t.id}: ${(err as Error).message}`);
      }
    }
  }
}
