import { NextResponse } from 'next/server';
import { signState } from '../../../../lib/crypto.ts';
import { authorizeUrl } from '../../../../lib/strava.ts';
import { env } from '../../../../server/env.ts';
import { currentUser, fail } from '../../../../server/runtime.ts';

export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const e = env();
  if (!e.stravaId || !e.stravaSecret || !e.tokenKey) return fail('Strava n’est pas configuré sur ce serveur.', 503);
  return NextResponse.redirect(authorizeUrl({ clientId: e.stravaId, redirectUri: `${e.appUrl}/api/strava/callback`, state: signState(user.id, e.sessionSecret) }));
}
