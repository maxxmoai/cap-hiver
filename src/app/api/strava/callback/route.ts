import { NextResponse } from 'next/server';
import { encrypt, verifyState } from '../../../../lib/crypto.ts';
import { exchangeCode } from '../../../../lib/strava.ts';
import { env } from '../../../../server/env.ts';
import { mutate } from '../../../../server/mutate.ts';
import { currentUser, deps, getStore, guard } from '../../../../server/runtime.ts';

async function getHandler(req: Request) {
  const e = env();
  const back = (q: string) => NextResponse.redirect(`${e.appUrl}/?${q}`);
  const user = await currentUser();
  const url = new URL(req.url);
  if (!user || verifyState(url.searchParams.get('state'), e.sessionSecret) !== user.id) return back('strava=refuse');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('error') || !e.stravaId || !e.stravaSecret || !e.tokenKey) return back('strava=refuse');
  const scope = url.searchParams.get('scope') ?? '';
  if (!scope.includes('activity:read')) return back('strava=scope');
  try {
    const d = deps();
    const t = await exchangeCode({ clientId: e.stravaId, clientSecret: e.stravaSecret, code }, d.fetch);
    if (t.athleteId === null) return back('strava=erreur');
    await getStore().saveStrava({ userId: user.id, athleteId: t.athleteId, accessTokenEnc: encrypt(t.accessToken, e.tokenKey), refreshTokenEnc: encrypt(t.refreshToken, e.tokenKey), expiresAt: t.expiresAt });
    await mutate(getStore(), user.id, d, (cur) => ({ ...cur, strava: { connected: true, lastSyncAt: cur.strava.lastSyncAt } }));
    return back('strava=ok');
  } catch { return back('strava=erreur'); }
}

export const GET = guard(getHandler);
