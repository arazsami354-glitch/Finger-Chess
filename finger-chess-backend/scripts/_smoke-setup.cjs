const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const p = new PrismaClient();
const PASSWORD = 'SmokePass123!';
const ADMIN_EMAIL = 'smoke-admin@test.local';
const PLAYERS = ['smoke-p1@test.local', 'smoke-p2@test.local', 'smoke-p3@test.local', 'smoke-p4@test.local'];
const SEED_BALANCE = '200.00';

async function ensureUser(email, role) {
  const existing = await p.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`exists: ${email} (${existing.id})`);
    return existing;
  }
  const passwordHash = await argon2.hash(PASSWORD);
  const user = await p.user.create({
    data: {
      email,
      passwordHash,
      fullName: email.split('@')[0],
      role,
      status: 'active',
      emailVerifiedAt: new Date(),
      dateOfBirth: new Date('1995-01-01'),
    },
  });
  await p.wallet.create({ data: { userId: user.id, availableBalance: SEED_BALANCE, lockedBalance: 0 } });
  await p.ruleAcceptance.create({
    data: { userId: user.id, version: 'v1', acceptedAt: new Date() },
  });
  console.log(`created: ${email} (${user.id})`);
  return user;
}

async function main() {
  const admin = await ensureUser(ADMIN_EMAIL, 'super_admin');
  for (const email of PLAYERS) await ensureUser(email, 'player');

  // Reset prior smoke-run state so balances and the admin overview are deterministic.
  for (const email of PLAYERS) {
    const user = await p.user.findUnique({ where: { email }, include: { wallet: true } });
    if (user?.wallet) {
      await p.walletTransaction.deleteMany({ where: { walletId: user.wallet.id } });
      await p.wallet.update({ where: { userId: user.id }, data: { availableBalance: '0', lockedBalance: '0' } });
    }
  }

  const smokeTours = await p.$queryRawUnsafe(
    'SELECT id FROM "tournaments" WHERE created_by = $1',
    admin.id,
  );
  for (const row of smokeTours) {
    await p.$executeRawUnsafe('DELETE FROM "tournament_matches" WHERE tournament_id = $1', row.id);
    await p.$executeRawUnsafe('DELETE FROM "tournament_registrations" WHERE tournament_id = $1', row.id);
    await p.$executeRawUnsafe('DELETE FROM "tournaments" WHERE id = $1', row.id);
  }
  if (smokeTours.length) console.log(`cleaned ${smokeTours.length} prior smoke tournament(s)`);

  for (const email of PLAYERS) {
    const user = await p.user.findUnique({ where: { email }, include: { wallet: true } });
    const existing = await p.walletTransaction.findUnique({ where: { idempotencyKey: `smoke_seed_deposit:${user.id}` } });
    if (!existing) {
      await p.walletTransaction.create({
        data: {
          walletId: user.wallet.id,
          type: 'deposit',
          amount: SEED_BALANCE,
          balanceAfter: SEED_BALANCE,
          idempotencyKey: `smoke_seed_deposit:${user.id}`,
          status: 'completed',
          referenceType: 'smoke_seed',
          referenceId: user.id,
        },
      });
      await p.wallet.update({ where: { userId: user.id }, data: { availableBalance: SEED_BALANCE, lockedBalance: '0' } });
    }
  }

  console.log(`ADMIN=${admin.id}`);
  console.log('SETUP_DONE');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
