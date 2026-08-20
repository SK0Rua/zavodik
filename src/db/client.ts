import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import { bootstrapSettings } from '../lib/bootstrapSettings.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
export const db = drizzle(pool, { schema });
export { schema };

// Every factory process imports this module, so this is the one place that
// guarantees the UI-edited settings snapshot is warm and kept fresh (15s TTL).
// See src/lib/bootstrapSettings.ts for why it is a side-effecting call.
bootstrapSettings();
