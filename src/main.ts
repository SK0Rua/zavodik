/**
 * Single-process entrypoint: workers + dashboard/API + telegram bot.
 * `pnpm all` locally, or CMD in the Docker image.
 */
import { startWorkers } from './workers/main.js';
import { startApi } from './api/server.js';
import { startTelegramBot } from './telegram/bot.js';
import { log } from './lib/logger.js';

await startWorkers();
startApi();
startTelegramBot();
log.info('factory up', { mode: process.env.FACTORY_MODE ?? 'dry_run' });
