import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const b64u = (b: Buffer): string => b.toString('base64url');
const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------- mots de passe : scrypt ---------- */

const N = 16384;
const R = 8;
const P = 1;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${b64u(salt)}$${b64u(hash)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  try {
    const expected = fromB64u(hash);
    const got = scryptSync(password, fromB64u(salt), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch { return false; }
}

/* ---------- chiffrement des jetons : AES-256-GCM ---------- */

function key32(secret: string): Buffer {
  // Tolère les espaces, retours à la ligne et guillemets collés par erreur dans la variable d'environnement.
  const clean = secret.trim().replace(/^["']|["']$/g, '').trim();
  const k = Buffer.from(clean, 'base64');
  if (k.length === 32) return k;
  // Toute autre valeur d'au moins 16 caractères est transformée en clé de 32 octets (SHA-256).
  if (clean.length >= 16) return createHash('sha256').update(clean, 'utf8').digest();
  throw new Error('TOKEN_ENCRYPTION_KEY est trop courte : utilise `openssl rand -base64 32`.');
}

export function encrypt(plain: string, base64Key: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key32(base64Key), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
}

export function decrypt(token: string, base64Key: string): string {
  const [v, iv, tag, ct] = token.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Jeton chiffré invalide.');
  const d = createDecipheriv('aes-256-gcm', key32(base64Key), fromB64u(iv));
  d.setAuthTag(fromB64u(tag));
  return Buffer.concat([d.update(fromB64u(ct)), d.final()]).toString('utf8');
}

/* ---------- sessions : jeton signé HMAC-SHA256 ---------- */

export interface SessionPayload { sub: string; exp: number }

export function signSession(sub: string, secret: string, ttlSec: number, nowMs = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ sub, exp: Math.floor(nowMs / 1000) + ttlSec } satisfies SessionPayload)));
  const sig = b64u(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string, nowMs = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64u(createHmac('sha256', secret).update(body).digest());
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(fromB64u(body).toString('utf8')) as Partial<SessionPayload>;
    if (typeof p.sub !== 'string' || typeof p.exp !== 'number' || p.exp * 1000 < nowMs) return null;
    return { sub: p.sub, exp: p.exp };
  } catch { return null; }
}

/** État OAuth : jeton signé de courte durée qui lie le retour de Strava à l'utilisateur connecté. */
export const signState = (userId: string, secret: string, nowMs = Date.now()): string => signSession(`oauth:${userId}`, secret, 600, nowMs);
export function verifyState(state: string | null, secret: string, nowMs = Date.now()): string | null {
  const p = verifySession(state ?? undefined, secret, nowMs);
  return p && p.sub.startsWith('oauth:') ? p.sub.slice(6) : null;
}
