import { RPE0 } from '../engine/constants.ts';
import { clamp } from '../engine/dates.ts';
import { activityLoad, estimateTss, type AthleteRefs } from '../engine/load.ts';
import type { IdGen, Kind, Session, Sport } from '../engine/types.ts';

/** Sous-ensemble d'une activité Strava (API v3). */
export interface StravaActivity {
  /** Nombre pour Strava, « icu:… » pour intervals.icu. */
  id: number | string;
  name: string;
  sport_type: string;
  start_date_local: string;
  moving_time: number;
  elapsed_time?: number;
  distance?: number;
  average_heartrate?: number;
  weighted_average_watts?: number;
  average_watts?: number;
  total_elevation_gain?: number;
  /** Charge déjà calculée par la source (intervals.icu) : elle prime sur notre estimation. */
  external_tss?: number;
}

export function mapSport(t: string): Sport {
  switch (t) {
    case 'Run': case 'VirtualRun': return 'run';
    case 'TrailRun': return 'trail';
    case 'Ride': case 'VirtualRide': case 'GravelRide': case 'MountainBikeRide': case 'EBikeRide': case 'EMountainBikeRide': return 'bike';
    case 'NordicSki': case 'BackcountrySki': return 'ski';
    case 'RollerSki': return 'roller';
    case 'WeightTraining': case 'Crossfit': case 'Workout': return 'strength';
    default: return 'other';
  }
}

/** Valide la forme d'une activité reçue de l'API. */
export function parseActivity(json: unknown): StravaActivity | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (typeof o['id'] !== 'number' || typeof o['sport_type'] !== 'string' || typeof o['start_date_local'] !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(o['start_date_local'])) return null;
  const mt = typeof o['moving_time'] === 'number' ? o['moving_time'] : Number(o['elapsed_time']);
  if (!Number.isFinite(mt) || mt < 60) return null;
  const n = (k: string): number | undefined => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : undefined);
  return {
    id: o['id'], name: typeof o['name'] === 'string' ? o['name'].slice(0, 80) : '', sport_type: o['sport_type'],
    start_date_local: o['start_date_local'], moving_time: mt,
    ...(n('distance') !== undefined && { distance: n('distance')! }),
    ...(n('average_heartrate') !== undefined && { average_heartrate: n('average_heartrate')! }),
    ...(n('weighted_average_watts') !== undefined && { weighted_average_watts: n('weighted_average_watts')! }),
    ...(n('average_watts') !== undefined && { average_watts: n('average_watts')! }),
    ...(n('total_elevation_gain') !== undefined && { total_elevation_gain: n('total_elevation_gain')! }),
  };
}

export interface IngestResult {
  sessions: Session[];
  session: Session;
  /** Charge prévue de la séance remplacée, null si l'activité n'était pas au plan. */
  plannedTss: number | null;
  actualTss: number;
  created: boolean;
  method: 'power' | 'heartrate' | 'rpe';
}

const ENDURANCE = new Set<Sport>(['run', 'trail', 'bike', 'ski', 'roller']);

/**
 * Associe une activité à la séance prévue le même jour (même sport de préférence, durée la plus proche),
 * ou crée une séance validée. Rejouer la même activité met à jour sans doublon.
 */
export function ingestActivity(sessions: readonly Session[], a: StravaActivity, ath: AthleteRefs, newId: IdGen): IngestResult {
  const out = sessions.map((s) => ({ ...s }));
  const sport = mapSport(a.sport_type);
  const date = a.start_date_local.slice(0, 10);
  const dur = Math.max(5, Math.round(a.moving_time / 60));
  const stravaId = String(a.id);
  const np = a.weighted_average_watts ?? a.average_watts ?? null;

  const existing = out.find((s) => s.done?.stravaId === stravaId);
  const target =
    existing ??
    out
      .filter((s) => s.date === date && s.status === 'planned')
      .map((s) => ({ s, score: (s.sport === sport ? 0 : ENDURANCE.has(s.sport) && ENDURANCE.has(sport) ? 1000 : 5000) + Math.abs(s.dur - dur) }))
      .filter((x) => x.score < 5000)
      .sort((x, y) => x.score - y.score)[0]?.s;

  const rpeHint = target?.rpe ?? RPE0[dur >= 120 ? 'long' : 'easy'];
  const load0 = activityLoad({ durSec: a.moving_time, sport, avgHr: a.average_heartrate ?? null, normPower: np, rpeHint }, ath);
  const load = a.external_tss !== undefined ? { ...load0, tss: a.external_tss, method: 'power' as const } : load0;
  const plannedTss = existing ? null : target ? estimateTss(target.dur, target.rpe, target.sport) : null;
  const done = {
    dur, dist: a.distance ? Math.round(a.distance / 100) / 10 : null, rpe: load.rpe,
    feel: target?.done?.feel ?? 3, legs: target?.done?.legs ?? 3, note: target?.done?.note ?? '',
    tss: Math.round(load.tss), source: typeof a.id === 'string' && a.id.startsWith('icu:') ? ('intervals' as const) : ('strava' as const), stravaId,
  };

  if (target) {
    target.status = 'done';
    target.sport = sport;
    target.done = done;
    return { sessions: out, session: target, plannedTss, actualTss: load.tss, created: false, method: load.method };
  }
  const kind: Kind = dur >= 120 ? 'long' : 'easy';
  const s: Session = { id: newId(), date, sport, kind, dur, rpe: load.rpe, src: 'strava', status: 'done', title: a.name || undefined, with: [], done };
  if (!s.title) delete s.title;
  out.push(s);
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return { sessions: out, session: s, plannedTss: null, actualTss: load.tss, created: true, method: load.method };
}

/** Activité supprimée côté Strava : la séance prévue redevient à faire, une séance créée disparaît. */
export function removeActivity(sessions: readonly Session[], activityId: string): Session[] {
  const out: Session[] = [];
  for (const s of sessions) {
    if (s.done?.stravaId !== activityId) { out.push({ ...s }); continue; }
    if (s.src === 'strava') continue;
    const { done: _gone, ...rest } = s;
    void _gone;
    out.push({ ...rest, status: 'planned' });
  }
  return out;
}

/* ---------- OAuth et webhook ---------- */

export const STRAVA_SCOPE = 'read,activity:read_all';

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: p.clientId, redirect_uri: p.redirectUri, response_type: 'code', approval_prompt: 'auto', scope: STRAVA_SCOPE, state: p.state });
  return `https://www.strava.com/oauth/authorize?${q}`;
}

export interface StravaTokens { accessToken: string; refreshToken: string; expiresAt: number; athleteId: number | null }

export function parseTokens(json: unknown): StravaTokens | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (typeof o['access_token'] !== 'string' || typeof o['refresh_token'] !== 'string' || typeof o['expires_at'] !== 'number') return null;
  const ath = o['athlete'] && typeof o['athlete'] === 'object' ? (o['athlete'] as Record<string, unknown>)['id'] : null;
  return { accessToken: o['access_token'], refreshToken: o['refresh_token'], expiresAt: o['expires_at'], athleteId: typeof ath === 'number' ? ath : null };
}

async function tokenCall(body: Record<string, string>, fetchImpl: typeof fetch): Promise<StravaTokens> {
  const res = await fetchImpl('https://www.strava.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Strava a refusé la connexion (${res.status}).`);
  const t = parseTokens(await res.json());
  if (!t) throw new Error('Réponse Strava inattendue.');
  return t;
}
export const exchangeCode = (c: { clientId: string; clientSecret: string; code: string }, f: typeof fetch): Promise<StravaTokens> =>
  tokenCall({ client_id: c.clientId, client_secret: c.clientSecret, code: c.code, grant_type: 'authorization_code' }, f);
export const refreshTokens = (c: { clientId: string; clientSecret: string; refreshToken: string }, f: typeof fetch): Promise<StravaTokens> =>
  tokenCall({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }, f);

/** Vrai si le jeton expire dans moins de 5 minutes. */
export const needsRefresh = (expiresAt: number, nowMs: number): boolean => expiresAt * 1000 - nowMs < 300_000;

export async function fetchActivity(id: number, accessToken: string, f: typeof fetch): Promise<StravaActivity | null> {
  const res = await f(`https://www.strava.com/api/v3/activities/${id}`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Strava a répondu ${res.status}.`);
  return parseActivity(await res.json());
}

/** Réponse à la vérification d'abonnement : renvoie le défi si le jeton de vérification correspond. */
export function verifyChallenge(q: { mode: string | null; token: string | null; challenge: string | null }, expected: string): { 'hub.challenge': string } | null {
  if (q.mode !== 'subscribe' || !q.challenge || !expected || q.token !== expected) return null;
  return { 'hub.challenge': q.challenge };
}

export interface WebhookEvent { objectType: 'activity' | 'athlete'; objectId: number; aspect: 'create' | 'update' | 'delete'; ownerId: number; updates: Record<string, unknown> }

export function parseWebhookEvent(json: unknown): WebhookEvent | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const ot = o['object_type'];
  const asp = o['aspect_type'];
  if ((ot !== 'activity' && ot !== 'athlete') || (asp !== 'create' && asp !== 'update' && asp !== 'delete')) return null;
  if (typeof o['object_id'] !== 'number' || typeof o['owner_id'] !== 'number') return null;
  const updates = o['updates'] && typeof o['updates'] === 'object' ? (o['updates'] as Record<string, unknown>) : {};
  return { objectType: ot, objectId: o['object_id'], aspect: asp, ownerId: o['owner_id'], updates };
}

export const clampTss = (x: number): number => clamp(Math.round(x), 0, 1000);
