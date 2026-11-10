import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-only-admin-password.';
process.env.AI_API_KEY = '';
process.env.DATABASE_URL = `file:${resolve(process.cwd(), 'prisma', 'test.db').replaceAll('\\', '/')}`;
