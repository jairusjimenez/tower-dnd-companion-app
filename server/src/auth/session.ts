import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionIdentity } from '../../../shared';
import type { ServerConfig } from '../config';

interface SignedSessionPayload extends SessionIdentity {
  iat: number;
  exp: number;
}

export function signSessionToken(identity: SessionIdentity, secret: string, maxAgeSec: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SignedSessionPayload = {
    role: identity.role,
    email: identity.email,
    username: identity.username,
    characterId: identity.characterId ?? null,
    name: identity.name,
    iat: nowSec,
    exp: nowSec + maxAgeSec,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${sig}`;
}

export function verifySessionToken(token: string | undefined, secret: string): SessionIdentity | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SignedSessionPayload;
    if (!decoded || (decoded.role !== 'dm' && decoded.role !== 'player')) return null;
    if (decoded.exp && Math.floor(Date.now() / 1000) > decoded.exp) return null;
    return {
      role: decoded.role,
      email: String(decoded.email || ''),
      username: String(decoded.username || ''),
      characterId: decoded.characterId ? String(decoded.characterId) : null,
      name: decoded.name ? String(decoded.name) : undefined,
    };
  } catch {
    return null;
  }
}

function isHttpsRequest(req: FastifyRequest): boolean {
  const fwd = req.headers['x-forwarded-proto'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim() === 'https';
  return req.protocol === 'https';
}

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, identity: SessionIdentity, config: ServerConfig): void {
  const token = signSessionToken(identity, config.sessionSecret, config.sessionMaxAgeSec);
  reply.setCookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction && isHttpsRequest(req),
    path: '/',
    maxAge: config.sessionMaxAgeSec,
  });
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction && isHttpsRequest(req),
    path: '/',
  });
}

export function resolveRequestSession(req: FastifyRequest, config: ServerConfig): SessionIdentity | null {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies;
  const raw = cookies?.[config.sessionCookieName];
  return verifySessionToken(raw, config.sessionSecret);
}
