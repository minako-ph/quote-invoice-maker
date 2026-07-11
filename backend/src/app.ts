import { Hono } from 'hono';
import { registerRoutes } from './routes/index.js';

/**
 * Hono アプリを生成する。
 * 業務ルート・`GET /health` はすべて registerRoutes（routes/index.ts）へ集約する。
 */
export function createApp(): Hono {
  const app = new Hono();

  registerRoutes(app);

  return app;
}
