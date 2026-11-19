import crypto from 'node:crypto';

export function hashPassword(password: string, salt: string = crypto.randomBytes(16).toString('hex')): { salt: string; hash: string } {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string | null | undefined, expectedHash: string | null | undefined): boolean {
  if (!salt || !expectedHash) return false;
  try {
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}
