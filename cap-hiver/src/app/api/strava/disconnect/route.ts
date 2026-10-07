import { mutate } from '../../../../server/mutate.ts';
import { currentUser, deps, fail, getStore, json, sameOrigin } from '../../../../server/runtime.ts';

export async function POST() {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  await getStore().deleteStrava(user.id);
  const data = await mutate(getStore(), user.id, deps(), (cur) => ({ ...cur, strava: { connected: false, lastSyncAt: cur.strava.lastSyncAt } }));
  return json({ data });
}
