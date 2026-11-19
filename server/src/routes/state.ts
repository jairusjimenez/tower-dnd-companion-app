import type { FastifyInstance } from 'fastify';
import type { ServerContext } from '../actions/types';
import { resolveRequestSession } from '../auth/session';
import { filterStateForRole } from '../store/filterState';

export function registerStateRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { config, repo, sseHub } = ctx;

  app.get('/api/state', async (req, reply) => {
    const session = resolveRequestSession(req, config);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'Authentication required.' });
    }
    const state = repo.getState();
    return reply.code(200).send(filterStateForRole(state, session.role, session.characterId));
  });

  app.get('/api/events', async (req, reply) => {
    const session = resolveRequestSession(req, config);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'Authentication required.' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const detach = sseHub.addClient({
      raw: reply.raw,
      role: session.role,
      characterId: session.characterId,
    });
    req.raw.on('close', detach);
  });
}
