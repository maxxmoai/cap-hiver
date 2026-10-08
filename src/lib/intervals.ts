import type { StravaActivity } from './strava.ts';

const BASE = 'https://intervals.icu/api/v1';

const authHeader = (apiKey: string): string => `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

/** Clé d'API personnelle : Réglages → Développeur sur intervals.icu. On refuse tout ce qui n'y ressemble pas. */
export const validKey = (k: string): boolean => /^[A-Za-z0-9]{10,64}$/.test(k.trim());

/**
 * Convertit une activité intervals.icu vers la forme commune.
 * L'identifiant est préfixé pour ne jamais entrer en collision avec un identifiant Strava.
 */
export function parseIntervalsActivity(json: unknown): StravaActivity | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const rawId = typeof o['id'] === 'string' || typeof o['id'] === 'number' ? String(o['id']) : '';
  if (!rawId || typeof o['type'] !== 'string' || typeof o['start_date_local'] !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(o['start_date_local'])) return null;
  const n = (k: string): number | undefined => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : undefined);
  const mt = n('moving_time') ?? n('elapsed_time');
  if (mt === undefined || mt < 60) return null;
  const load = n('icu_training_load');
  return {
    id: `icu:${rawId}`.slice(0, 30),
    name: typeof o['name'] === 'string' ? o['name'].slice(0, 80) : '',
    sport_type: o['type'],
    start_date_local: o['start_date_local'],
    moving_time: mt,
    ...(n('distance') !== undefined && { distance: n('distance')! }),
    ...(n('average_heartrate') !== undefined && { average_heartrate: n('average_heartrate')! }),
    ...(n('icu_weighted_avg_watts') !== undefined && { weighted_average_watts: n('icu_weighted_avg_watts')! }),
    ...(n('icu_average_watts') !== undefined && { average_watts: n('icu_average_watts')! }),
    ...(n('total_elevation_gain') !== undefined && { total_elevation_gain: n('total_elevation_gain')! }),
    ...(load !== undefined && load >= 0 && { external_tss: Math.min(load, 1000) }),
  };
}

async function get(path: string, apiKey: string, f: typeof fetch): Promise<unknown> {
  const res = await f(`${BASE}${path}`, { headers: { authorization: authHeader(apiKey), accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new Error('Clé intervals.icu refusée.');
  if (!res.ok) throw new Error(`intervals.icu a répondu ${res.status}.`);
  return res.json();
}

/** Vérifie la clé et renvoie le nom de l'athlète. */
export async function checkKey(apiKey: string, f: typeof fetch): Promise<string> {
  const j = (await get('/athlete/0', apiKey, f)) as Record<string, unknown> | null;
  const name = j && typeof j['name'] === 'string' ? j['name'] : '';
  return name.slice(0, 60);
}

export async function fetchRecent(apiKey: string, oldest: string, newest: string, f: typeof fetch): Promise<StravaActivity[]> {
  const j = await get(`/athlete/0/activities?oldest=${oldest}&newest=${newest}`, apiKey, f);
  if (!Array.isArray(j)) throw new Error('Réponse intervals.icu inattendue.');
  return j.flatMap((x) => { const a = parseIntervalsActivity(x); return a ? [a] : []; });
}
