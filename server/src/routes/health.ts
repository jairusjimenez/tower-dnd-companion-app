import type { FastifyInstance } from 'fastify';
import type { ServerContext } from '../actions/types';

export function registerHealthRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/health', async (_req, reply) => {
    const state = ctx.repo.getState();
    return reply.code(200).send({ ok: true, status: state.session.status });
  });
}
