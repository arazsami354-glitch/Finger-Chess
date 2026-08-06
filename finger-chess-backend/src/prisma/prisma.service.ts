import { Injectable, OnModuleInit, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

const MAX_SERIALIZATION_RETRIES = 5;
const BASE_BACKOFF_MS = 25;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs a callback inside a serializable transaction — use for any flow
   * that reads a balance and then writes based on it (entry-fee holds,
   * settlement, withdrawals) to prevent race conditions between concurrent
   * requests on the same wallet.
   *
   * SERIALIZABLE isolation doesn't prevent concurrent transactions from
   * both proceeding — it detects the conflict and makes Postgres abort one
   * of them (error code 40001) so the caller can retry. Without a retry
   * loop here, two legitimate concurrent requests (e.g. both halves of a
   * match settlement, or a deposit landing at the same moment as a
   * withdrawal hold) would have roughly a coin-flip chance of one of them
   * surfacing as a raw 500 to the user instead of just quietly succeeding
   * on retry, which is what SERIALIZABLE is *for*. Retries are safe here
   * specifically because every write inside these transactions is already
   * idempotency-keyed — a retried transaction either re-does the same
   * no-op check-and-skip, or performs the write exactly once.
   */
  async runInSerializableTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.$transaction(fn, { isolationLevel: 'Serializable' });
      } catch (err) {
        const isSerializationFailure = this.isSerializationFailure(err);
        attempt += 1;
        if (!isSerializationFailure || attempt >= MAX_SERIALIZATION_RETRIES) {
          if (isSerializationFailure) {
            throw new ServiceUnavailableException('This wallet is under heavy contention — please retry in a moment');
          }
          throw err;
        }
        const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5); // jittered exponential backoff
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  private isSerializationFailure(err: unknown): boolean {
    // Postgres SQLSTATE 40001 = serialization_failure, 40P01 = deadlock_detected.
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      typeof err.meta?.code === 'string' &&
      ['40001', '40P01'].includes(err.meta.code as string)
    ) || (err instanceof Error && /40001|40P01|could not serialize access/i.test(err.message));
  }
}
