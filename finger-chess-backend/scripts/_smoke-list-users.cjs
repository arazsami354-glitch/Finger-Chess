const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user
  .findMany({ select: { id: true, email: true, role: true, kycStatus: true }, take: 20 })
  .then((rows) => {
    console.log(JSON.stringify(rows, null, 2));
    return p.$disconnect();
  })
  .catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
  });
