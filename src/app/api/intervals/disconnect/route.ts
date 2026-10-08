import { mutate } from '../../../../server/mutate.ts';
import { currentUser, deps, fail, getStore, json, publicData, sameOrigin } from '../../../../server/runtime.ts';

export async function POST() {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const data = await mutate(getStore(), user.id, deps(), (cur) => ({ ...cur, intervals: { connected: false, keyEnc: null, athlete: '', lastSyncAt: cur.intervals.lastSyncAt, lastError: null } }));
  return json({ data: publicData(data) });
}
