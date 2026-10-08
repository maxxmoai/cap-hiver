import { todayOf } from '../../../server/service.ts';
import { currentUser, deps, fail, getStore, json, publicData } from '../../../server/runtime.ts';
import { loadOrCreate } from '../../../server/mutate.ts';

export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const d = deps();
  const { data } = await loadOrCreate(getStore(), user.id, d);
  return json({ user, data: publicData(data), today: todayOf(data, d), integrations: await integrations() });
}

async function integrations() {
  const { env } = await import('../../../server/env.ts');
  const e = env();
  return { coach: !!e.coachProvider, strava: !!(e.stravaId && e.stravaSecret && e.stravaVerify && e.tokenKey), intervals: !!e.tokenKey };
}
