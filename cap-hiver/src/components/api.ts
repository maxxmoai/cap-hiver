import type { Action } from '../server/actions.ts';
import type { User, UserData } from '../server/types.ts';

export interface StatePayload { user: User; data: UserData; today: string; integrations: { coach: boolean; strava: boolean } }
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { ...init, headers: { 'content-type': 'application/json' }, credentials: 'same-origin' }); }
  catch { throw new ApiError('Pas de connexion au serveur.', 0); }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? 'Erreur du serveur.', res.status);
  return body;
}

export const getState = (): Promise<StatePayload> => request('/api/state');
export const sendAction = (a: Action): Promise<{ data: UserData; today: string }> => request('/api/actions', { method: 'POST', body: JSON.stringify(a) });
export const syncNow = (): Promise<{ data: UserData; today: string }> => request('/api/sync', { method: 'POST' });
export const auth = (kind: 'login' | 'signup' | 'logout', body?: Record<string, string>): Promise<unknown> => request(`/api/auth/${kind}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const askCoach = (text: string): Promise<{ reply: { message: string; changes: import('../lib/coach.ts').CoachChange[] } }> => request('/api/coach', { method: 'POST', body: JSON.stringify({ text }) });
export const searchPlaces = (q: string): Promise<{ places: Array<{ name: string; region: string; country: string; lat: number; lon: number; tz: string }> }> => request(`/api/geocode?q=${encodeURIComponent(q)}`);
export const stravaDisconnect = (): Promise<{ data: UserData }> => request('/api/strava/disconnect', { method: 'POST' });
