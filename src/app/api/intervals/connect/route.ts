import { encrypt } from '../../../../lib/crypto.ts';
import { checkKey, validAthlete, validKey } from '../../../../lib/intervals.ts';
import { env } from '../../../../server/env.ts';
import { mutate } from '../../../../server/mutate.ts';
import { syncIntervals, replan } from '../../../../server/service.ts';
import { currentUser, deps, fail, getStore, json, publicData, sameOrigin, guard } from '../../../../server/runtime.ts';

/** Enregistre la clé d'API intervals.icu après l'avoir testée, puis importe les 14 derniers jours. */
async function postHandler(req: Request) {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const user = await currentUser();
  if (!user) return fail('Non connecté.', 401);
  const e = env();
  if (!e.tokenKey) return fail('Chiffrement non configuré sur ce serveur (TOKEN_ENCRYPTION_KEY).', 503);
  if (!(await getStore().hit(`icu:${user.id}`, 10, 3600))) return fail('Trop d’essais, réessaie plus tard.', 429);
  const b = (await req.json().catch(() => null)) as { apiKey?: unknown; athleteId?: unknown } | null;
  const key = typeof b?.apiKey === 'string' ? b.apiKey.trim() : '';
  const athleteId = typeof b?.athleteId === 'string' && b.athleteId.trim() ? b.athleteId.trim() : '0';
  if (!validAthlete(athleteId)) return fail('Identifiant d’athlète invalide : il ressemble à i743904.');
  if (!validKey(key)) return fail('Cette clé n’a pas la bonne forme. Copie-la depuis intervals.icu, Réglages → Développeur.');
  const d = deps();
  let athlete: string;
  try { athlete = await checkKey(key, athleteId, d.fetch); } catch (err) { return fail(err instanceof Error ? err.message : 'Connexion impossible.', 400); }
  const data = await mutate(getStore(), user.id, d, async (cur) => {
    const linked = { ...cur, intervals: { connected: true, keyEnc: encrypt(key, e.tokenKey!), athleteId, athlete, lastSyncAt: cur.intervals.lastSyncAt, lastError: null } };
    return replan(await syncIntervals(linked, key, d), d);
  });
  return json({ data: publicData(data) });
}

export const POST = guard(postHandler);
