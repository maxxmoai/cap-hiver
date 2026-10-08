import { safeEqual } from '../../../../lib/crypto.ts';
import { env } from '../../../../server/env.ts';
import { mutate } from '../../../../server/mutate.ts';
import { runDaily } from '../../../../server/service.ts';
import { deps, fail, getStore, intervalsKeyOf, json, guard } from '../../../../server/runtime.ts';

export const maxDuration = 60;

/** Appelée chaque matin par Vercel Cron : calendrier, météo, alertes de chaque utilisateur. */
async function getHandler(req: Request) {
  const secret = env().cronSecret;
  if (!secret || !safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return fail('Non autorisé.', 401);
  const store = getStore();
  const d = deps();
  let ok = 0;
  let failed = 0;
  for (const id of await store.listUserIds()) {
    try { await mutate(store, id, d, (cur) => runDaily(cur, d, { intervalsKey: intervalsKeyOf(cur) })); ok++; } catch { failed++; }
  }
  return json({ ok, failed });
}

export const GET = guard(getHandler);
