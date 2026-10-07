import { SPORTS } from './constants.ts';
import { addDays, dateLabel, diffDays, weekStart } from './dates.ts';
import { fuelMessage } from './fuel.ts';
import { isDenseDay } from './planner.ts';
import type { DayBusy, IdGen, Session, Settings, Suggestion, SuggestionOption, Sport } from './types.ts';

export interface DayWeather {
  date: string;
  /** Cumul de précipitations en mm. */
  precipMm: number;
  /** Neige fraîche prévue en cm. */
  snowCm: number;
  gustKmh: number;
  tMin: number;
  tMax: number;
  /** Code météo WMO. */
  code: number;
}

export interface WeatherVerdict { bad: boolean; snow: boolean; reasons: string[] }

const STORM = new Set([95, 96, 99]);
const FREEZING = new Set([56, 57, 66, 67]);

export function assessWeather(w: DayWeather): WeatherVerdict {
  const reasons: string[] = [];
  if (w.precipMm >= 10 && w.snowCm < 5) reasons.push(`pluie forte (${Math.round(w.precipMm)} mm)`);
  if (w.gustKmh >= 60) reasons.push(`rafales à ${Math.round(w.gustKmh)} km/h`);
  if (STORM.has(w.code)) reasons.push('orages');
  if (FREEZING.has(w.code)) reasons.push('risque de verglas');
  if (w.tMax <= -15) reasons.push(`froid extrême (${Math.round(w.tMax)} °C)`);
  const snow = w.snowCm >= 10;
  return { bad: reasons.length > 0, snow, reasons };
}

interface SuggestCtx {
  today: string;
  settings: Settings;
  busy: Readonly<Record<string, DayBusy>>;
  newId: IdGen;
  nowIso: string;
}

const make = (c: SuggestCtx, p: Omit<Suggestion, 'id' | 'status' | 'createdAt'>): Suggestion => ({ ...p, id: c.newId(), status: 'new', createdAt: c.nowIso });

const isOutdoorFlexible = (s: Session): boolean => SPORTS[s.sport].outdoor && !s.indoor && s.status === 'planned';

function trainerOption(s: Session): SuggestionOption {
  const dur = Math.min(s.dur, 90);
  return {
    label: `Home-trainer ${dur}′`,
    action: { type: 'swap', sport: 'bike', kind: s.kind === 'long' ? 'easy' : s.kind, dur, title: `Home-trainer ${dur}′`, indoor: true },
  };
}

function strengthOption(s: Session, sessions: readonly Session[], settings: Settings): SuggestionOption {
  const ws = weekStart(s.date);
  const used = sessions.filter((x) => x.id !== s.id && x.status !== 'skipped' && x.kind === 'strength' && x.date >= ws && x.date <= addDays(ws, 6)).length;
  return used < settings.strength
    ? { label: 'Muscu 40′', action: { type: 'swap', sport: 'strength', kind: 'strength', dur: 40, title: 'Renfo complet 40′' } }
    : { label: 'Gainage et mobilité 25′', action: { type: 'swap', sport: 'other', kind: 'recovery', dur: 25, title: 'Gainage et mobilité' } };
}

/** Propositions pour les 3 prochains jours quand la météo gêne une séance en extérieur. */
export function weatherSuggestions(sessions: readonly Session[], weather: Readonly<Record<string, DayWeather>>, c: SuggestCtx): Suggestion[] {
  const out: Suggestion[] = [];
  for (let i = 0; i <= 3; i++) {
    const date = addDays(c.today, i);
    const w = weather[date];
    if (!w) continue;
    const v = assessWeather(w);
    if (!v.bad && !v.snow) continue;
    const when = i === 0 ? 'aujourd’hui' : dateLabel(date);
    for (const s of sessions.filter((x) => x.date === date && isOutdoorFlexible(x))) {
      const name = SPORTS[s.sport].name.toLowerCase();
      if (s.eventId) {
        out.push(make(c, {
          key: `weather:${date}:${s.id}`, kind: 'weather', date, sessionId: s.id, options: [],
          title: `Météo difficile pour ${s.title ?? name}`,
          body: `Prévu ${when} : ${v.reasons.concat(v.snow ? [`${Math.round(w.snowCm)} cm de neige`] : []).join(', ')}. Vérifie la tenue et le plan B avant le départ.`,
        }));
        continue;
      }
      if (v.snow) {
        if (s.sport === 'ski') continue;
        const opts: SuggestionOption[] = [{
          label: 'Passer au ski de fond',
          action: { type: 'swap', sport: 'ski', kind: s.kind === 'long' ? 'long' : 'easy', dur: s.dur, title: 'Ski de fond sur neige fraîche' },
        }];
        if (s.sport === 'bike') opts.push(trainerOption(s));
        out.push(make(c, {
          key: `snow:${date}:${s.id}`, kind: 'snow', date, sessionId: s.id, options: opts,
          title: `${Math.round(w.snowCm)} cm de neige ${i === 0 ? 'aujourd’hui' : dateLabel(date)}`,
          body: `Ta séance de ${name} est prévue ${when}. Avec cette neige fraîche, tu peux la remplacer par du ski de fond.`,
        }));
      } else {
        const opts: SuggestionOption[] = [];
        if (s.sport !== 'strength') opts.push(trainerOption(s));
        opts.push(strengthOption(s, sessions, c.settings));
        out.push(make(c, {
          key: `weather:${date}:${s.id}`, kind: 'weather', date, sessionId: s.id, options: opts,
          title: `Météo exécrable ${i === 0 ? 'aujourd’hui' : dateLabel(date)}`,
          body: `${v.reasons.join(', ')}. Veux-tu basculer ta séance de ${name} sur du home-trainer ou de la musculation ?`,
        }));
      }
    }
  }
  return out;
}

/** Alerte de la veille pour une séance longue : apports en glucides et en eau. */
export function fuelSuggestions(sessions: readonly Session[], weather: Readonly<Record<string, DayWeather>>, c: SuggestCtx): Suggestion[] {
  const date = addDays(c.today, 1);
  const out: Suggestion[] = [];
  for (const s of sessions.filter((x) => x.date === date && x.status === 'planned')) {
    const m = fuelMessage(s.sport as Sport, s.dur, date, weather[date]?.tMax);
    if (!m) continue;
    out.push(make(c, { key: `fuel:${date}:${s.id}`, kind: 'fuel', date, sessionId: s.id, options: [], title: m.title, body: m.body }));
  }
  return out;
}

/** Séances prévues sur une journée de cours dense : un décrassage de 30 minutes suffit. */
export function denseDaySuggestions(sessions: readonly Session[], c: SuggestCtx): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of sessions) {
    if (s.status !== 'planned' || s.eventId || s.date < c.today || diffDays(s.date, c.today) > 7) continue;
    if (s.kind === 'shake' || s.kind === 'recovery') continue;
    if (!isDenseDay(s.date, c.busy, c.settings)) continue;
    const hours = Math.round((c.busy[s.date]?.classMin ?? 0) / 60);
    out.push(make(c, {
      key: `dense:${s.date}:${s.id}`, kind: 'dense', date: s.date, sessionId: s.id,
      options: [{ label: 'Décrassage 30′', action: { type: 'shake' } }],
      title: `Journée de ${hours || 8} h de cours ${dateLabel(s.date)}`,
      body: 'Pas de séance dure ce jour-là : le décrassage de 30 minutes garde le rythme sans entamer ta fraîcheur.',
    }));
  }
  return out;
}

/** Un message d'information par semaine de partiels à venir. */
export function examSuggestions(c: SuggestCtx, settings: Settings): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= 14; i++) {
    const d = addDays(c.today, i);
    const b = c.busy[d];
    if (!b?.exam) continue;
    const ws = weekStart(d);
    if (seen.has(ws)) continue;
    seen.add(ws);
    out.push(make(c, {
      key: `exam:${ws}`, kind: 'exam', date: d, options: [],
      title: `Partiels la semaine du ${dateLabel(ws)}`,
      body: `Volume réduit de ${Math.round(settings.examTaper * 100)} % et pas de séance qualité cette semaine, pour préserver ton influx nerveux.${b.examLabel ? ` Repéré : ${b.examLabel}.` : ''}`,
    }));
  }
  return out;
}

/**
 * Ajoute les nouvelles propositions sans doublon (par clé), conserve le statut des anciennes
 * et retire celles dont la date est dépassée de plus de 7 jours.
 */
export function mergeSuggestions(existing: readonly Suggestion[], fresh: readonly Suggestion[], today: string): Suggestion[] {
  const keys = new Set(existing.map((s) => s.key));
  const merged = [...existing, ...fresh.filter((s) => !keys.has(s.key))];
  return merged.filter((s) => diffDays(today, s.date) <= 7).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
