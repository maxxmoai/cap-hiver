import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { signSession, verifySession } from '../lib/crypto.ts';
import { env } from './env.ts';
import { MemoryStore } from './memory-store.ts';
import { PgStore } from './pg-store.ts';
import type { Deps } from './service.ts';
import type { Store, User } from './types.ts';

const g = globalThis as unknown as { __store?: Store };

export function getStore(): Store {
  if (!g.__store) {
    const e = env();
    g.__store = e.databaseUrl ? new PgStore(e.databaseUrl) : new MemoryStore();
  }
  return g.__store;
}

export const deps = (): Deps => ({ newId: () => randomUUID().slice(0, 12), now: () => new Date(), fetch });

export const COOKIE = 'ch_session';
const TTL = 30 * 24 * 3600;

export async function startSession(userId: string): Promise<void> {
  const e = env();
  (await cookies()).set(COOKIE, signSession(userId, e.sessionSecret, TTL), { httpOnly: true, sameSite: 'lax', secure: e.production, path: '/', maxAge: TTL });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const p = verifySession(token, env().sessionSecret);
  return p ? getStore().getUser(p.sub) : null;
}

/** Refuse les requêtes d'écriture venues d'un autre site. */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!origin) return h.get('sec-fetch-site') !== 'cross-site';
  try { return new URL(origin).host === host; } catch { return false; }
}

export const json = (body: unknown, status = 200): NextResponse => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export const fail = (message: string, status = 400): NextResponse => json({ error: message }, status);

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim().slice(0, 64);
}
