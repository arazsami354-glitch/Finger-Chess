import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Idempotent by design (upsert on the unique `code`) — safe to run against
 * an existing database with real user data, e.g. when adding a new
 * achievement to the catalog post-launch, without touching anything
 * already unlocked.
 */
async function main() {
  const achievements = [
    { code: 'first_win', name: 'First Blood', description: 'Win your first game.', icon: 'trophy', criteria: { type: 'games_won', threshold: 1 } },
    { code: 'ten_wins', name: 'On a Roll', description: 'Win 10 games.', icon: 'flame', criteria: { type: 'games_won', threshold: 10 } },
    { code: 'fifty_wins', name: 'Formidable', description: 'Win 50 games.', icon: 'swords', criteria: { type: 'games_won', threshold: 50 } },
    { code: 'hundred_games', name: 'Veteran', description: 'Play 100 games.', icon: 'shield', criteria: { type: 'games_played', threshold: 100 } },
    { code: 'first_game', name: 'Getting Started', description: 'Play your first game.', icon: 'flag', criteria: { type: 'games_played', threshold: 1 } },
  ];

  for (const a of achievements) {
    await prisma.achievement.upsert({ where: { code: a.code }, create: a, update: a });
  }

  const badges = [
    { code: 'founding_member', name: 'Founding Member', description: 'Joined during the platform launch window.', icon: 'star', tier: 'seasonal' },
    { code: 'verified', name: 'Verified', description: 'Completed identity verification.', icon: 'badge-check', tier: 'standard' },
    { code: 'elite_stakes', name: 'High Roller', description: 'Played in the $100 room.', icon: 'gem', tier: 'premium' },
  ];

  for (const b of badges) {
    await prisma.badge.upsert({ where: { code: b.code }, create: b, update: b });
  }

  console.log(`Seeded ${achievements.length} achievements and ${badges.length} badges.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
