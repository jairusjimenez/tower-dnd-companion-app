import type { FastifyInstance } from 'fastify';
import { dispatchAction } from '../actions';
import type { ServerContext } from '../actions/types';
import { resolveRequestSession } from '../auth/session';

export function registerActionRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { config, repo, sseHub } = ctx;

  app.post('/api/action', async (req, reply) => {
    const session = resolveRequestSession(req, config);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'Authentication required.' });
    }

    // Never trust client-supplied role or characterId — always bind from verified cookie
    const result = await dispatchAction(
      {
        config,
        repo,
        sseHub,
        role: session.role,
        characterId: session.characterId,
        state: repo.getState(),
      },
      req.body,
    );

    if (result.error) {
      return reply.code(result.status || 400).send({ ok: false, error: result.error });
    }
    return reply.code(200).send(result);
  });
}
