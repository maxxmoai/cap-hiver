import { geocode } from '../../../lib/openmeteo.ts';
import { currentUser, deps, fail, getStore, json, guard } from '../../../server/runtime.ts';

async function getHandler(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const q = new URL(req.url).searchParams.get('q')?.trim().slice(0, 80) ?? '';
  if (q.length < 2) return json({ places: [] });
  if (!(await getStore().hit(`geo:${user.id}`, 60, 600))) return fail('Trop de recherches.', 429);
  try { return json({ places: await geocode(q, deps().fetch) }); } catch { return fail('Recherche de lieu indisponible.', 502); }
}

export const GET = guard(getHandler);
