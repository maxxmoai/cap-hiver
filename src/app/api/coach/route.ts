import { buildCoachContext, askCoach, parseCoachReply } from '../../../lib/coach.ts';
import { env } from '../../../server/env.ts';
import { mutate } from '../../../server/mutate.ts';
import { todayOf } from '../../../server/service.ts';
import { currentUser, deps, fail, getStore, json, sameOrigin, guard } from '../../../server/runtime.ts';
import { loadOrCreate } from '../../../server/mutate.ts';

const DAILY_LIMIT = 20;

async function postHandler(req: Request) {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const e = env();
  const apiKey = e.coachProvider === 'gemini' ? e.geminiKey : e.anthropicKey;
  if (!e.coachProvider || !apiKey) return fail('Le coach n’est pas configuré sur ce serveur (GEMINI_API_KEY ou ANTHROPIC_API_KEY).', 503);
  const b = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof b?.text === 'string' ? b.text.slice(0, 1000) : '';
  const d = deps();
  const store = getStore();
  const { data } = await loadOrCreate(store, user.id, d);
  const today = todayOf(data, d);
  const used = data.coach.usageDate === today ? data.coach.usageCount : 0;
  if (used >= DAILY_LIMIT) return fail('Limite quotidienne du coach atteinte, reviens demain.', 429);
  let reply;
  try {
    const ctx = buildCoachContext({ today, settings: data.settings, events: data.events, sessions: data.sessions, form: data.form, busy: data.busy });
    reply = parseCoachReply(await askCoach(ctx, text, { fetch: d.fetch, apiKey, provider: e.coachProvider, model: e.coachProvider === 'gemini' ? e.geminiModel : e.anthropicModel }), data.sessions, today);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Le coach est indisponible.', 502);
  }
  await mutate(store, user.id, d, (cur) => ({ ...cur, coach: { message: reply.message, at: d.now().toISOString(), usageDate: today, usageCount: (cur.coach.usageDate === today ? cur.coach.usageCount : 0) + 1 } }));
  return json({ reply });
}

export const POST = guard(postHandler);
