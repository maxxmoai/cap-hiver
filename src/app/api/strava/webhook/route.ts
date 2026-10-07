import { NextResponse } from 'next/server';
import { decrypt, encrypt } from '../../../../lib/crypto.ts';
import { fetchActivity, needsRefresh, parseWebhookEvent, refreshTokens, verifyChallenge } from '../../../../lib/strava.ts';
import { env } from '../../../../server/env.ts';
import { mutate } from '../../../../server/mutate.ts';
import { applyStravaActivity, applyStravaDelete } from '../../../../server/service.ts';
import { deps, getStore } from '../../../../server/runtime.ts';

export const maxDuration = 30;

/** Vérification d'abonnement demandée par Strava. */
export async function GET(req: Request) {
  const e = env();
  const q = new URL(req.url).searchParams;
  const r = e.stravaVerify ? verifyChallenge({ mode: q.get('hub.mode'), token: q.get('hub.verify_token'), challenge: q.get('hub.challenge') }, e.stravaVerify) : null;
  return r ? NextResponse.json(r) : NextResponse.json({ error: 'refusé' }, { status: 403 });
}

/** Réception d'une activité : on répond vite, et on ignore ce qui ne nous concerne pas. */
export async function POST(req: Request) {
  const e = env();
  const ev = parseWebhookEvent(await req.json().catch(() => null));
  if (!ev || ev.objectType !== 'activity' || !e.tokenKey || !e.stravaId || !e.stravaSecret) return NextResponse.json({ ok: true });
  const store = getStore();
  const acc = await store.findStravaByAthlete(ev.ownerId);
  if (!acc) return NextResponse.json({ ok: true });
  const d = deps();
  try {
    if (ev.aspect === 'delete') {
      await mutate(store, acc.userId, d, (cur) => applyStravaDelete(cur, String(ev.objectId), d));
      return NextResponse.json({ ok: true });
    }
    let access = decrypt(acc.accessTokenEnc, e.tokenKey);
    if (needsRefresh(acc.expiresAt, Date.now())) {
      const t = await refreshTokens({ clientId: e.stravaId, clientSecret: e.stravaSecret, refreshToken: decrypt(acc.refreshTokenEnc, e.tokenKey) }, d.fetch);
      access = t.accessToken;
      await store.saveStrava({ ...acc, accessTokenEnc: encrypt(t.accessToken, e.tokenKey), refreshTokenEnc: encrypt(t.refreshToken, e.tokenKey), expiresAt: t.expiresAt });
    }
    const act = await fetchActivity(ev.objectId, access, d.fetch);
    if (act) await mutate(store, acc.userId, d, (cur) => applyStravaActivity(cur, act, d).data);
  } catch { /* Strava réessaie ; on ne renvoie pas d'erreur pour éviter les boucles */ }
  return NextResponse.json({ ok: true });
}
