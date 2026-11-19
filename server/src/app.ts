import fs from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { resolveConfig, type ServerConfig } from './config';
import { SseHub } from './realtime/sseHub';
import { registerActionRoutes } from './routes/action';
import { registerAuthRoutes } from './routes/auth';
import { registerHealthRoutes } from './routes/health';
import { registerStateRoutes } from './routes/state';
import { JsonStateRepository } from './store/jsonStore';

export async function buildApp(configOverrides: Partial<ServerConfig> = {}): Promise<{
  app: FastifyInstance;
  config: ServerConfig;
  repo: JsonStateRepository;
  sseHub: SseHub;
}> {
  const config = resolveConfig(configOverrides);
  const repo = new JsonStateRepository(config.dataDir, config.stateFile, config.backupDir, config.maxBackups);
  const sseHub = new SseHub(() => repo.getState());
  sseHub.startHeartbeat(20000);

  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
  });

  await app.register(fastifyRateLimit, {
    max: 600,
    timeWindow: '1 minute',
  });

  const ctx = { config, repo, sseHub };
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerStateRoutes(app, ctx);
  registerActionRoutes(app, ctx);

  if (fs.existsSync(config.clientDistDir) && fs.existsSync(path.join(config.clientDistDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.clientDistDir,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url === '/health') {
        return reply.code(404).send({ ok: false, error: 'Route not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      return reply.code(404).send({ ok: false, error: `Not found: ${req.url}` });
    });
  }

  app.addHook('onClose', async () => {
    sseHub.stopHeartbeat();
  });

  return { app, config, repo, sseHub };
}
