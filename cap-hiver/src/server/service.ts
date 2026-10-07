import {
  absorbOverload, adaptSession, applyAction, denseDaySuggestions, examSuggestions, fuelSuggestions, lighten, mergeSuggestions,
  plannedLoad, prepFor, regenerate, weatherSuggestions, type DayWeather, type IdGen, type RaceEvent, type Session, type Suggestion,
} from '../engine/index.ts';
import { RPE0 } from '../engine/constants.ts';
import { addDays, diffDays, todayIn, weekStart } from '../engine/dates.ts';
import { applyCoachChange, parseCoachReply } from '../lib/coach.ts';
import { busyFromEvents, fetchIcs, parseIcs, safeIcsUrl } from '../lib/ics.ts';
import { fetchForecast } from '../lib/openmeteo.ts';
import { ingestActivity, removeActivity, type StravaActivity } from '../lib/strava.ts';
import { mergeSettings, type Action } from './actions.ts';
import { sanitizeUserData } from './sanitize.ts';
import type { UserData } from './types.ts';

export interface Deps { newId: IdGen; now: () => Date; fetch: typeof fetch }

export const todayOf = (d: UserData, deps: Deps): string => todayIn(d.settings.timezone, deps.now());

export function emptyUserData(deps: Deps): UserData {
  const base = sanitizeUserData({}, deps.newId, '2000-01-01');
  const today = todayIn(base.settings.timezone, deps.now());
  const seeded: UserData = { ...base, anchor: weekStart(today), coach: { ...base.coach, usageDate: today } };
  return replan(seeded, deps);
}

/** Recalcule le plan à venir sans toucher à ce que l'utilisateur a validé ou déplacé. */
export function replan(d: UserData, deps: Deps): UserData {
  const r = regenerate({ today: todayOf(d, deps), settings: d.settings, events: d.events, sessions: d.sessions, busy: d.busy, anchor: d.anchor }, deps.newId);
  return { ...d, sessions: r.sessions, anchor: r.anchor };
}

const byDate = (a: Session, b: Session): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Applique une action de l'utilisateur. Fonction pure : renvoie de nouvelles données. */
export function applyUserAction(data: UserData, a: Action, deps: Deps): UserData {
  const today = todayOf(data, deps);
  const ctx = { today, sessions: data.sessions, settings: data.settings, events: data.events, busy: data.busy, newId: deps.newId };
  const find = (id: string): Session | undefined => data.sessions.find((s) => s.id === id);
  switch (a.type) {
    case 'setForm': {
      const cur = data.form[today] ?? {};
      return { ...data, form: { ...data.form, [today]: { ...cur, [a.axis]: a.value } } };
    }
    case 'logSession': {
      const s = find(a.id);
      if (!s) return data;
      const sessions = data.sessions.map((x) => (x.id === a.id ? { ...x, status: 'done' as const, done: { dur: a.dur, dist: a.dist, rpe: a.rpe, feel: a.feel, legs: a.legs, note: a.note, source: 'manual' as const } } : x));
      const form = s.date === today && !data.form[today] ? { ...data.form, [today]: { leg: a.legs, nerv: a.feel } } : data.form;
      return { ...data, sessions, form };
    }
    case 'moveSession': {
      const s = find(a.id);
      if (!s || s.eventId || a.date < addDays(today, -7) || a.date > addDays(today, 365)) return data;
      return replan({ ...data, sessions: data.sessions.map((x) => (x.id === a.id ? { ...x, date: a.date, src: x.src === 'social' ? ('social' as const) : ('user' as const) } : x)) }, deps);
    }
    case 'skipSession':
      return { ...data, sessions: data.sessions.map((x) => (x.id === a.id ? { ...x, status: 'skipped' as const } : x)) };
    case 'reopenSession':
      return { ...data, sessions: data.sessions.map((x) => { if (x.id !== a.id) return x; const { done: _d, ...rest } = x; void _d; return { ...rest, status: 'planned' as const }; }) };
    case 'deleteSession': {
      const s = find(a.id);
      if (!s) return data;
      const sessions = s.src === 'auto' || s.eventId ? data.sessions.map((x) => (x.id === a.id ? { ...x, status: 'skipped' as const } : x)) : data.sessions.filter((x) => x.id !== a.id);
      return replan({ ...data, sessions }, deps);
    }
    case 'lightenSession': {
      const s = find(a.id);
      if (!s || s.eventId || s.status !== 'planned') return data;
      return { ...data, sessions: data.sessions.map((x) => (x.id === a.id ? lighten(x) : x)) };
    }
    case 'adaptSession': {
      const s = find(a.id);
      if (!s || s.eventId || s.status !== 'planned') return data;
      return { ...data, sessions: adaptSession(data.sessions, a.id, a.mode, ctx).sessions };
    }
    case 'saveSession': {
      const base: Partial<Session> = {
        date: a.date, sport: a.sport, kind: a.kind, dur: a.dur, rpe: RPE0[a.kind], with: a.with,
        ...(a.time && { time: a.time }), ...(a.place && { place: a.place }), ...(a.title && { title: a.title }), ...(a.note && { note: a.note }),
      };
      if (a.id) {
        const sessions = data.sessions.map((x) => {
          if (x.id !== a.id || x.eventId) return x;
          const { steps: _s, title: _t, place: _p, note: _n, time: _tm, ...rest } = x;
          void _s; void _t; void _p; void _n; void _tm;
          return { ...rest, ...base, src: a.with.length ? ('social' as const) : x.src === 'auto' ? ('user' as const) : x.src };
        });
        return replan({ ...data, sessions }, deps);
      }
      const added: Session = { id: deps.newId(), status: 'planned', src: a.with.length ? 'social' : 'user', date: a.date, sport: a.sport, kind: a.kind, dur: a.dur, rpe: RPE0[a.kind], with: a.with, ...base };
      const friends = [...new Set([...data.settings.friends, ...a.with])].slice(0, 10);
      return replan({ ...data, settings: { ...data.settings, friends }, sessions: [...data.sessions, added].sort(byDate) }, deps);
    }
    case 'saveEvent': {
      const fields = { kind: a.kind, name: a.name, date: a.date, sport: a.sport, dist: a.dist, dplus: a.dplus, dur: a.dur, prio: a.prio, notes: a.notes, with: a.with };
      let events: RaceEvent[];
      if (a.id && data.events.some((e) => e.id === a.id)) events = data.events.map((e) => (e.id === a.id ? { ...e, ...fields } : e));
      else {
        const e: RaceEvent = { id: deps.newId(), ...fields, prep: [] };
        if (e.kind === 'race') e.prep = prepFor(e, deps.newId);
        events = [...data.events, e];
      }
      return replan({ ...data, events }, deps);
    }
    case 'deleteEvent':
      return replan({ ...data, events: data.events.filter((e) => e.id !== a.id) }, deps);
    case 'togglePrep':
      return { ...data, events: data.events.map((e) => (e.id === a.eventId ? { ...e, prep: e.prep.map((p) => (p.id === a.prepId ? { ...p, done: a.done } : p)) } : e)) };
    case 'saveSettings':
      return replan({ ...data, settings: mergeSettings(data.settings, a.settings) }, deps);
    case 'saveCalendarUrl': {
      if (a.url && !safeIcsUrl(a.url)) return { ...data, calendar: { ...data.calendar, lastError: 'Lien invalide : il doit commencer par https:// (ou webcal://) et pointer vers un site public.' } };
      return { ...data, busy: a.url ? data.busy : {}, calendar: { url: a.url, lastSyncAt: a.url ? data.calendar.lastSyncAt : null, lastError: null, coveredTo: a.url ? data.calendar.coveredTo : null } };
    }
    case 'regenerate':
      return replan(data, deps);
    case 'resolveSuggestion': {
      const sg = data.suggestions.find((x) => x.id === a.id);
      if (!sg) return data;
      const mark = (status: Suggestion['status']): Suggestion[] => data.suggestions.map((x) => (x.id === a.id ? { ...x, status } : x));
      const opt = a.optionIndex === null ? undefined : sg.options[a.optionIndex];
      if (!opt) return { ...data, suggestions: mark('dismissed') };
      const target = sg.sessionId ? find(sg.sessionId) : undefined;
      if (!target || target.status !== 'planned') return { ...data, suggestions: mark('dismissed') };
      const note = sg.kind === 'snow' || sg.kind === 'weather' ? 'Remplacée à cause de la météo' : 'Adaptée à ta journée de cours';
      const sessions = data.sessions.map((x) => {
        if (x.id !== target.id) return x;
        const o = applyAction(x, opt.action, note);
        return { ...o, src: sg.kind === 'snow' || sg.kind === 'weather' ? ('weather' as const) : ('user' as const) };
      });
      return { ...data, sessions, suggestions: mark('applied') };
    }
    case 'applyCoach': {
      const valid = parseCoachReply({ message: '', changes: a.changes }, data.sessions, today).changes;
      if (!valid.length) return data;
      let sessions = data.sessions;
      for (const c of valid) sessions = applyCoachChange(sessions, c, deps.newId);
      return replan({ ...data, sessions }, deps);
    }
  }
}

/* ---------- emploi du temps ---------- */

/** ADE exporte une fenêtre fixe (firstDate, lastDate) : on la remplace par la période voulue. */
export function withDateRange(url: string, from: string, to: string): string {
  const u = safeIcsUrl(url);
  if (!u) return url;
  if (u.searchParams.has('firstDate') && u.searchParams.has('lastDate')) {
    u.searchParams.set('firstDate', from);
    u.searchParams.set('lastDate', to);
  }
  return u.toString();
}

export async function syncCalendar(data: UserData, deps: Deps): Promise<UserData> {
  const url = data.calendar.url;
  const nowIso = deps.now().toISOString();
  if (!url) return data;
  const today = todayOf(data, deps);
  const from = addDays(today, -7);
  const to = addDays(today, 150);
  try {
    const text = await fetchIcs(withDateRange(url, from, to), deps.fetch);
    const events = parseIcs(text, data.settings.timezone).filter((e) => !e.allDay || true);
    if (!events.length) return { ...data, calendar: { ...data.calendar, lastSyncAt: nowIso, lastError: 'Aucun cours trouvé dans ce calendrier.' } };
    // On ne couvre que la période réellement renvoyée : au-delà du dernier cours, on ignore la charge.
    const last = events.reduce((m, e) => (e.end > m ? e.end : m), events[0]!.end);
    const lastDay = last.toISOString().slice(0, 10);
    const coveredTo = addDays(weekStart(lastDay), 6) < to ? addDays(weekStart(lastDay), 6) : to;
    const busy = busyFromEvents(events, { tz: data.settings.timezone, from, to: coveredTo, examKeywords: data.settings.examKeywords, ignoreKeywords: data.settings.ignoreKeywords });
    return replan({ ...data, busy, calendar: { url, lastSyncAt: nowIso, lastError: null, coveredTo } }, deps);
  } catch (e) {
    return { ...data, calendar: { ...data.calendar, lastSyncAt: nowIso, lastError: e instanceof Error ? e.message.slice(0, 200) : 'Synchronisation impossible.' } };
  }
}

/* ---------- météo, carburant, journée dense ---------- */

export async function refreshAlerts(data: UserData, deps: Deps): Promise<UserData> {
  const today = todayOf(data, deps);
  const nowIso = deps.now().toISOString();
  const c = { today, settings: data.settings, busy: data.busy, newId: deps.newId, nowIso };
  let weather: Record<string, DayWeather> = {};
  let wx = { syncedAt: data.weather.syncedAt, error: data.weather.error };
  if (data.settings.lat !== null && data.settings.lon !== null) {
    try {
      weather = await fetchForecast(data.settings.lat, data.settings.lon, data.settings.timezone, deps.fetch);
      wx = { syncedAt: nowIso, error: null };
    } catch (e) { wx = { syncedAt: data.weather.syncedAt, error: e instanceof Error ? e.message.slice(0, 200) : 'Météo indisponible.' }; }
  }
  const fresh = [
    ...weatherSuggestions(data.sessions, weather, c),
    ...fuelSuggestions(data.sessions, weather, c),
    ...denseDaySuggestions(data.sessions, c),
    ...examSuggestions(c, data.settings),
  ];
  return { ...data, weather: wx, suggestions: mergeSuggestions(data.suggestions, fresh, today) };
}

/** Tâche quotidienne : calendrier, puis alertes. Une erreur sur un volet n'empêche pas les autres. */
export async function runDaily(data: UserData, deps: Deps): Promise<UserData> {
  let d = data;
  if (d.calendar.url) d = await syncCalendar(d, deps);
  return refreshAlerts(d, deps);
}

/* ---------- Strava ---------- */

export interface StravaOutcome { data: UserData; summary: string }

export function applyStravaActivity(data: UserData, act: StravaActivity, deps: Deps): StravaOutcome {
  const today = todayOf(data, deps);
  const r = ingestActivity(data.sessions, act, { ftp: data.settings.ftp, lthr: data.settings.lthr }, deps.newId);
  let sessions = r.sessions;
  const suggestions = [...data.suggestions];
  let summary = `${r.created ? 'Nouvelle séance' : 'Séance validée'} : ${Math.round(r.actualTss)} de charge.`;
  if (r.plannedTss !== null && act.start_date_local.slice(0, 10) >= addDays(today, -1)) {
    const o = absorbOverload(sessions, r.session.date, r.actualTss, r.plannedTss, { settings: data.settings, events: data.events });
    if (o.applied) {
      sessions = o.sessions;
      summary += ' Les 3 prochains jours sont allégés.';
      suggestions.push({
        id: deps.newId(), key: `overload:${act.id}`, kind: 'overload', date: r.session.date, status: 'applied', options: [], createdAt: deps.now().toISOString(),
        title: `Séance plus dure que prévu : ${Math.round(r.actualTss)} au lieu de ${Math.round(r.plannedTss)}`,
        body: `J’ai allégé les prochains jours pour absorber la surcharge. ${o.changes.join(' ; ')}.`,
      });
    }
  }
  const seen = [String(act.id), ...data.stravaSeen.filter((x) => x !== String(act.id))].slice(0, 200);
  return {
    data: replan({ ...data, sessions, suggestions: mergeSuggestions(suggestions, [], today), stravaSeen: seen, strava: { connected: true, lastSyncAt: deps.now().toISOString() } }, deps),
    summary,
  };
}

export function applyStravaDelete(data: UserData, activityId: string, deps: Deps): UserData {
  return replan({ ...data, sessions: removeActivity(data.sessions, activityId), stravaSeen: data.stravaSeen.filter((x) => x !== activityId) }, deps);
}

export { diffDays, plannedLoad };
