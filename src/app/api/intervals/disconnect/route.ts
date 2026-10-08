import { mutate } from '../../../../server/mutate.ts';
import { currentUser, deps, fail, getStore, json, publicData, sameOrigin, guard } from '../../../../server/runtime.ts';

async function postHandler() {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const data = await mutate(getStore(), user.id, deps(), (cur) => ({ ...cur, intervals: { connected: false, keyEnc: null, athleteId: '0', athlete: '', lastSyncAt: cur.intervals.lastSyncAt, lastError: null } }));
  return json({ data: publicData(data) });
}

export const POST = guard(postHandler);
