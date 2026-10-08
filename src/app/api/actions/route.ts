import { parseAction } from '../../../server/actions.ts';
import { mutate } from '../../../server/mutate.ts';
import { applyUserAction, refreshAlerts, syncCalendar, todayOf } from '../../../server/service.ts';
import { currentUser, deps, fail, getStore, json, publicData, sameOrigin } from '../../../server/runtime.ts';

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const parsed = parseAction(await req.json().catch(() => null));
  if (!parsed.ok) return fail(parsed.error);
  const d = deps();
  const store = getStore();
  const a = parsed.action;
  const data = await mutate(store, user.id, d, async (cur) => {
    let next = applyUserAction(cur, a, d);
    // Un nouveau lien de calendrier ou un nouveau lieu déclenchent tout de suite la synchro correspondante.
    if (a.type === 'saveCalendarUrl' && next.calendar.url) next = await syncCalendar(next, d);
    if (a.type === 'saveCalendarUrl' || a.type === 'saveSettings') next = await refreshAlerts(next, d);
    return next;
  });
  return json({ data: publicData(data), today: todayOf(data, d) });
}
