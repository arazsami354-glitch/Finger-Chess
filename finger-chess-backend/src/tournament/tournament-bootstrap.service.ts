import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Locates the tournament DDL. Candidates in order of preference:
 *  1. the standalone source SQL (dev / ts-node, cwd-agnostic);
 *  2. the prisma migration mirror (works in production too, where `nest build`
 *     compiles to dist/ and the source .sql isn't copied across — the
 *     migration folder IS shipped because `prisma migrate deploy` needs it).
 */
function resolveDdlPath(): string {
  const candidates = [
    join(__dirname, 'tournament.sql'),
    join(process.cwd(), 'prisma', 'migrations', '0016_tournament_system', 'migration.sql'),
    join(__dirname, '..', '..', '..', 'prisma', 'migrations', '0016_tournament_system', 'migration.sql'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Tournament DDL not found anywhere');
}

/** Splits the DDL file into standalone statements (strips `--` comment lines first — the DDL contains no in-string semicolons, so a plain split is safe). */
export function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Creates the tournament tables at startup. The Prisma client can't be
 * regenerated on Windows while a dev server holds the query-engine DLL, so the
 * tournament schema lives outside schema.prisma and is applied idempotently
 * here (`CREATE TABLE IF NOT EXISTS`), mirroring
 * prisma/migrations/0016_tournament_system/migration.sql. Runs on every
 * instance; converging statements make concurrent startups harmless.
 */
@Injectable()
export class TournamentBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(TournamentBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const sql = readFileSync(resolveDdlPath(), 'utf8');
      for (const statement of splitSqlStatements(sql)) {
        await this.prisma.$executeRawUnsafe(statement);
      }
      this.logger.log('Tournament tables ready');
    } catch (err) {
      this.logger.error(`Failed to bootstrap tournament tables: ${(err as Error).message}`);
    }
  }
}
