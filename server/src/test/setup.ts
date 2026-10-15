import { resolve } from 'node:path';

process.env.DATABASE_URL = `file:${resolve(process.cwd(), 'prisma', 'test.db').replaceAll('\\', '/')}`;
