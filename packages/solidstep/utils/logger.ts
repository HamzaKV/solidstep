import { getLogger } from './pino.js';

/**
 * Shared Pino logger instance.
 *
 * Configured from the `logger` option passed to `defineConfig` in
 * `app.config.ts`. Import this singleton anywhere structured logging is needed.
 */
export const logger = getLogger();
