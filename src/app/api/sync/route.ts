import { mutate } from '../../../server/mutate.ts';
import { runDaily, todayOf } from '../../../server/service.ts';
import { currentUser, deps, fail, getStore, json, sameOrigin } from '../../../server/runtime.ts';

/** Synchronisation à la demande : calendrier + météo + alertes. */
export async function POST() {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const store = getStore();
  if (!(await store.hit(`sync:${user.id}`, 12, 3600))) return fail('Déjà synchronisé récemment, réessaie plus tard.', 429);
  const d = deps();
  const data = await mutate(store, user.id, d, (cur) => runDaily(cur, d));
  return json({ data, today: todayOf(data, d) });
}
