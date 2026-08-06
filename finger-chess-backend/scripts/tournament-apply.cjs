const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('C:/Users/arakh/Downloads/Compressed/Finger-Chess-Full-Project/Finger-Chess/finger-chess-backend/node_modules/.prisma/client/index.js');

function splitSqlStatements(sql) {
  const withoutComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'tournament', 'tournament.sql'), 'utf8');
  const prisma = new PrismaClient();
  for (const statement of splitSqlStatements(sql)) {
    await prisma.$executeRawUnsafe(statement);
  }
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tournament%' ORDER BY tablename`;
  console.log('Tournament tables ready:', tables.map((t) => t.tablename).join(', '));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
