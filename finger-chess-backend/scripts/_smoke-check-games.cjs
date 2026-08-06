const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const ids = [
    'e0b1cb27-5d90-44aa-9fd5-97b38ba5e177',
    '16731a7f-e2ed-4ac5-8ae9-7cd35366484d',
    '025dd2c9-28de-4daf-8aee-48a4b549ca74',
    '022d01d2-3826-47b1-98b1-e100a6e0f98d',
  ];
  const games = await p.game.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, result: true, winnerId: true, playerWhiteId: true, playerBlackId: true },
  });
  console.log(JSON.stringify(games, null, 1));
  const t = await p.$queryRawUnsafe(
    'SELECT t.id, t.name, t.status, t.format FROM "tournaments" t WHERE t.created_by = $1 ORDER BY t.created_at DESC LIMIT 4',
    '3c23e396-3c5e-44a2-b3ab-b232f5363202',
  );
  console.log(JSON.stringify(t, null, 1));
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
