import type { StravaActivity } from './strava.ts';

const BASE = 'https://intervals.icu/api/v1';

const authHeader = (apiKey: string): string => `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;

/** Identifiant d'athlète affiché dans l'URL d'intervals.icu (ex. i743904). « 0 » désigne le propriétaire de la clé. */
export const validAthlete = (a: string): boolean => /^(0|i?\d{3,12})$/.test(a.trim());

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
  if (res.status === 401) throw new Error('Clé intervals.icu refusée (401). Vérifie la clé API.');
  if (res.status === 403) throw new Error('intervals.icu refuse l’accès (403) : vérifie l’identifiant d’athlète et la clé.');
  if (res.status === 404) throw new Error('Athlète introuvable sur intervals.icu (404) : vérifie l’identifiant (ex. i743904).');
  if (!res.ok) throw new Error(`intervals.icu a répondu ${res.status}.`);
  return res.json();
}

/** Vérifie la clé et renvoie le nom de l'athlète. */
export async function checkKey(apiKey: string, athleteId: string, f: typeof fetch): Promise<string> {
  const j = (await get(`/athlete/${encodeURIComponent(athleteId)}`, apiKey, f)) as Record<string, unknown> | null;
  const name = j && typeof j['name'] === 'string' ? j['name'] : '';
  return name.slice(0, 60);
}

export async function fetchRecent(apiKey: string, athleteId: string, oldest: string, newest: string, f: typeof fetch): Promise<StravaActivity[]> {
  const j = await get(`/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${oldest}&newest=${newest}`, apiKey, f);
  if (!Array.isArray(j)) throw new Error('Réponse intervals.icu inattendue.');
  return j.flatMap((x) => { const a = parseIntervalsActivity(x); return a ? [a] : []; });
}
