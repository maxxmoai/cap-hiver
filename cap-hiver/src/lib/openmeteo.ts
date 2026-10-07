import type { DayWeather } from '../engine/suggestions.ts';
import { isDate } from '../engine/dates.ts';

/** Open-Meteo : gratuit, sans clé, avec la neige fraîche en cm. */
export function forecastUrl(lat: number, lon: number, tz: string, days = 7): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: tz, forecast_days: String(days),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

const arr = (o: Record<string, unknown>, k: string): unknown[] => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function parseForecast(json: unknown): Record<string, DayWeather> {
  const out: Record<string, DayWeather> = {};
  if (!json || typeof json !== 'object') return out;
  const daily = (json as Record<string, unknown>)['daily'];
  if (!daily || typeof daily !== 'object') return out;
  const d = daily as Record<string, unknown>;
  const time = arr(d, 'time');
  time.forEach((t, i) => {
    if (!isDate(t)) return;
    out[t] = {
      date: t,
      precipMm: num(arr(d, 'precipitation_sum')[i]),
      snowCm: num(arr(d, 'snowfall_sum')[i]),
      gustKmh: num(arr(d, 'wind_gusts_10m_max')[i]),
      tMin: num(arr(d, 'temperature_2m_min')[i]),
      tMax: num(arr(d, 'temperature_2m_max')[i]),
      code: num(arr(d, 'weather_code')[i]),
    };
  });
  return out;
}

export async function fetchForecast(lat: number, lon: number, tz: string, fetchImpl: typeof fetch): Promise<Record<string, DayWeather>> {
  const res = await fetchImpl(forecastUrl(lat, lon, tz), { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}.`);
  return parseForecast(await res.json());
}

export interface Place { name: string; region: string; country: string; lat: number; lon: number; tz: string }

export const geocodeUrl = (name: string): string =>
  `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: '5', language: 'fr', format: 'json' })}`;

export function parseGeocode(json: unknown): Place[] {
  const results = json && typeof json === 'object' ? (json as Record<string, unknown>)['results'] : null;
  if (!Array.isArray(results)) return [];
  const out: Place[] = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o['name'] !== 'string' || typeof o['latitude'] !== 'number' || typeof o['longitude'] !== 'number') continue;
    out.push({
      name: o['name'], region: typeof o['admin1'] === 'string' ? o['admin1'] : '', country: typeof o['country'] === 'string' ? o['country'] : '',
      lat: o['latitude'], lon: o['longitude'], tz: typeof o['timezone'] === 'string' ? o['timezone'] : 'Europe/Paris',
    });
  }
  return out;
}

export async function geocode(name: string, fetchImpl: typeof fetch): Promise<Place[]> {
  if (name.trim().length < 2) return [];
  const res = await fetchImpl(geocodeUrl(name.trim()), { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`La recherche de lieu a échoué (${res.status}).`);
  return parseGeocode(await res.json());
}
