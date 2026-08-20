/**
 * The UI reads Postgres directly (SPEC §2.2): it is an operator console for the
 * same database the workers write to, not a second API tier.
 *
 * The drizzle schema is THE factory's schema — `ui/factory/schema.ts` is a
 * symlink to `src/db/schema.ts` locally, and the real file copied in by the
 * Dockerfile. One definition, never a drifting duplicate.
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@factory/schema';

const globalForDb = globalThis as unknown as { factoryPool?: pg.Pool };

// Next dev hot-reloads modules; without the global the pool would leak connections.
const pool = globalForDb.factoryPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://factory:factory@localhost:5432/factory',
  max: 5,
});
if (process.env.NODE_ENV !== 'production') globalForDb.factoryPool = pool;

export const db = drizzle(pool, { schema });
export { schema, pool };
