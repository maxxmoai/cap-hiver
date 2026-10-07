import { HEAVY, RPE0 } from './constants.ts';
import { addDays, clamp, diffDays, dow, isDate, weekStart } from './dates.ts';
import { prepFor } from './prep.ts';
import type { DayBusy, IdGen, Kind, PhaseId, PlanInput, Prio, RaceEvent, Session, Settings, Sport } from './types.ts';

export interface PlanCtx {
  today: string;
  settings: Settings;
  events: readonly RaceEvent[];
  sessions: Session[];
  busy: Readonly<Record<string, DayBusy>>;
  newId: IdGen;
}

const prioN = (p: Prio): number => (p === 'A' ? 3 : p === 'B' ? 2 : 1);

/* ---------- charge de cours ---------- */

const rangeCache = new WeakMap<object, { min: string; max: string } | null>();
function calendarRange(busy: Readonly<Record<string, DayBusy>>): { min: string; max: string } | null {
  const hit = rangeCache.get(busy);
  if (hit !== undefined) return hit;
  const keys = Object.keys(busy).sort();
  const r = keys.length ? { min: keys[0]!, max: keys[keys.length - 1]! } : null;
  rangeCache.set(busy, r);
  return r;
}

/**
 * Minutes de cours d'une journée. Hors de la plage synchronisée, on retombe sur les jours
 * « chargés » déclarés dans les réglages, estimés à 4 h.
 */
export function classMinutes(date: string, busy: Readonly<Record<string, DayBusy>>, settings: Settings): number {
  const r = calendarRange(busy);
  if (r && date >= r.min && date <= r.max) return busy[date]?.classMin ?? 0;
  return settings.busy.includes(dow(date)) ? 240 : 0;
}

export const isDenseDay = (date: string, busy: Readonly<Record<string, DayBusy>>, settings: Settings): boolean =>
  classMinutes(date, busy, settings) >= settings.denseClassMin;

/* ---------- phases et volume ---------- */

export interface PhaseInfo {
  ph: PhaseId;
  mult: number;
  note: string;
  exam: boolean;
  next: RaceEvent | undefined;
  prev: RaceEvent | undefined;
  inWeek: RaceEvent[];
}

export function phaseInfo(ws: string, c: Pick<PlanCtx, 'settings' | 'events' | 'busy'>): PhaseInfo {
  const we = addDays(ws, 6);
  const set = c.settings;
  const races = c.events.filter((e) => e.kind === 'race').sort((a, b) => (a.date < b.date ? -1 : 1));
  const inWeek = races.filter((r) => r.date >= ws && r.date <= we);
  const next = races.find((r) => r.date >= ws);
  const prev = [...races].reverse().find((r) => r.date < ws);
  let ph: PhaseId = 'build';
  let mult = 1;
  let note = '';
  if (inWeek.length) {
    const r = inWeek.reduce((a, b) => (prioN(b.prio) > prioN(a.prio) ? b : a));
    ph = 'racewk';
    mult = [0, 0.85, 0.75, 0.6][prioN(r.prio)]!;
    note = r.name;
  } else if (prev && diffDays(ws, prev.date) <= 6) {
    ph = 'recover';
    mult = prioN(prev.prio) === 3 ? 0.5 : prioN(prev.prio) === 2 ? 0.7 : 0.85;
    note = prev.name;
  } else if (next && prioN(next.prio) === 3 && diffDays(next.date, ws) <= 13) {
    ph = 'peak';
    mult = 0.88;
    note = next.name;
  } else if (ws >= addDays(set.skiStart, -28) && we < set.skiStart) ph = 'transition';
  else if (we >= set.skiStart) ph = 'ski';

  let exam = false;
  for (let i = 0; i < 7 && !exam; i++) if (c.busy[addDays(ws, i)]?.exam) exam = true;
  if (exam) mult = Math.min(mult, 1 - set.examTaper);
  return { ph, mult, note, exam, next, prev, inWeek };
}

function weekMinutes(wk: number, info: PhaseInfo, set: Settings): { m: number; deload: boolean } {
  let m = Math.min(set.maxH, set.baseH * Math.pow(1.06, wk)) * 60 * info.mult;
  const deload = (info.ph === 'build' || info.ph === 'transition' || info.ph === 'ski') && wk % 4 === 3;
  if (deload) m *= 0.72;
  return { m, deload };
}
export const isDeloadWeek = (ws: string, anchor: string, info: PhaseInfo): boolean =>
  (info.ph === 'build' || info.ph === 'transition' || info.ph === 'ski') && Math.max(0, Math.round(diffDays(ws, anchor) / 7)) % 4 === 3;

/* ---------- coût d'un jour pour une séance ---------- */

type Pref = readonly [number, number, number, number, number, number, number];
const PREF: Record<'long' | 'quality' | 'easy' | 'strength', Pref> = {
  long: [9, 9, 7, 9, 6, 1, 0],
  quality: [5, 3, 0, 3, 1, 2, 4],
  easy: [3, 0, 2, 0, 2, 1, 2],
  strength: [2, 0, 2, 0, 3, 4, 5],
};
const SOFT: ReadonlySet<Kind> = new Set<Kind>(['shake', 'recovery']);

/** Plus le coût est bas, meilleur est le jour. Au-delà de 200, le jour n'est pas utilisable. */
export function dayCost(kind: Kind, dur: number, date: string, c: Pick<PlanCtx, 'sessions' | 'settings' | 'events' | 'busy'>, ignoreId?: string): number {
  const set = c.settings;
  const d = dow(date);
  const live = c.sessions.filter((x) => x.status !== 'skipped' && x.id !== ignoreId);
  const near = (n: number): Session[] => live.filter((x) => x.date === addDays(date, n));
  const heavyAt = (n: number): boolean => near(n).some((x) => HEAVY.has(x.kind));
  const grp = kind === 'long' ? 'long' : kind === 'tempo' || kind === 'interval' || kind === 'hills' || kind === 'tech' ? 'quality' : kind === 'strength' ? 'strength' : 'easy';
  let cost = PREF[grp][d]!;
  if (live.some((x) => x.date === date)) cost += 200;
  if (d === set.rest) cost += 45;
  const heavy = HEAVY.has(kind);

  const cm = classMinutes(date, c.busy, set);
  if (cm >= set.denseClassMin) {
    if (!SOFT.has(kind)) cost += 500;
  } else if (cm >= 300) cost += heavy ? 90 : Math.round(dur / 6);
  else if (cm >= 150) cost += heavy ? 50 : Math.round(dur / 10);
  else if (cm > 0) cost += heavy ? 10 : 0;

  if (c.busy[date]?.exam) cost += heavy ? 80 : 20;
  if (heavy && c.busy[addDays(date, 1)]?.exam) cost += 60;

  if (heavy && (heavyAt(-1) || heavyAt(1))) cost += 25;
  if (kind === 'strength') {
    if (heavyAt(-1)) cost += 6;
    if (heavyAt(1)) cost += 8;
  }
  for (const r of c.events.filter((e) => e.kind === 'race')) {
    const g = diffDays(r.date, date);
    const w = r.prio === 'A' ? 1 : r.prio === 'B' ? 0.7 : 0.4;
    if (g === 1 && kind !== 'shake') cost += Math.round(80 * w + (dur > 30 ? 20 : 0));
    if (g === 2 && heavy) cost += Math.round(40 * w);
    if (g >= 0 && g <= 4 && kind === 'long') cost += Math.round(60 * w);
    if (g === -1 && heavy) cost += Math.round(60 * w);
    if (g === 0 && kind !== 'race') cost += 300;
  }
  if (near(-1).length && near(1).length) cost += 3;
  return cost;
}

/** Meilleur jour des 6 prochains pour déplacer une séance, ou null. */
export function bestSlot(s: Session, c: Pick<PlanCtx, 'today' | 'sessions' | 'settings' | 'events' | 'busy'>): string | null {
  let best: string | null = null;
  let bc = 100;
  for (let i = 1; i <= 6; i++) {
    const d = addDays(c.today, i);
    const cost = dayCost(s.kind, s.dur, d, c, s.id);
    if (cost < bc) { bc = cost; best = d; }
  }
  return best;
}

/* ---------- construction d'une semaine ---------- */

type Slot = 'long' | 'quality' | 'easy' | 'easy2' | 'recovery' | 'light';
const SLOTS: Record<PhaseId, Slot[]> = {
  build: ['long', 'quality', 'easy', 'easy2', 'recovery'],
  peak: ['quality', 'long', 'easy', 'easy2'],
  racewk: ['light', 'easy', 'easy2'],
  recover: ['recovery', 'easy', 'easy2'],
  transition: ['long', 'quality', 'easy', 'easy2'],
  ski: ['long', 'quality', 'easy', 'easy2'],
};
const WGT: Record<Slot, number> = { long: 0.36, quality: 0.22, easy: 0.18, easy2: 0.16, recovery: 0.12, light: 0.1 };
const BOUNDS: Record<Slot, readonly [number, number]> = { long: [60, 210], quality: [40, 85], easy: [30, 75], easy2: [30, 70], recovery: [25, 45], light: [35, 35] };

function kindFor(slot: Slot, ph: PhaseId, wk: number): Kind {
  if (slot === 'long') return 'long';
  if (slot === 'light') return 'interval';
  if (slot === 'recovery') return 'recovery';
  if (slot === 'quality') {
    if (ph === 'build') return (['hills', 'tempo', 'interval'] as const)[wk % 3]!;
    if (ph === 'peak') return (['tempo', 'hills'] as const)[wk % 2]!;
    if (ph === 'transition') return (['hills', 'interval'] as const)[wk % 2]!;
    return (['interval', 'tempo', 'tech'] as const)[wk % 3]!;
  }
  return 'easy';
}

function sportFor(slot: Slot, kind: Kind, ph: PhaseId, date: string, set: Settings, wk: number): Sport {
  const onSnow = date >= set.skiStart;
  if (ph === 'ski' || (onSnow && ph !== 'racewk' && ph !== 'recover')) {
    if (slot === 'easy2') return wk % 2 ? 'bike' : 'run';
    if (slot === 'recovery') return 'run';
    return onSnow ? 'ski' : set.roller ? 'roller' : 'run';
  }
  if (ph === 'transition') {
    if (slot === 'long') return set.roller && wk % 2 === 0 ? 'roller' : 'bike';
    if (slot === 'quality') return kind === 'hills' ? 'trail' : set.roller ? 'roller' : 'run';
    if (slot === 'easy2') return 'bike';
    return 'run';
  }
  if (slot === 'long') return 'trail';
  if (slot === 'quality') return kind === 'hills' ? 'trail' : 'run';
  if (slot === 'easy2') return wk % 2 ? 'bike' : 'run';
  return 'run';
}

function planWeek(c: PlanCtx, ws: string, wk: number): void {
  const S = c.sessions;
  const set = c.settings;
  const info = phaseInfo(ws, c);
  const we = addDays(ws, 6);
  const t = c.today;
  const inW = (): Session[] => S.filter((x) => x.date >= ws && x.date <= we && x.status !== 'skipped');
  const { m: M, deload } = weekMinutes(wk, info, set);
  let N = set.perWeek;
  if (info.ph === 'recover') N = Math.max(3, set.perWeek - 2);
  else if (info.ph === 'racewk' || deload) N = Math.max(4, set.perWeek - 1);
  const fixed = inW();
  let remaining = N - fixed.length;
  const free = (d: string): boolean => d >= t && !S.some((x) => x.date === d && x.status !== 'skipped');
  const days = (): string[] => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i));
  const mk = (date: string, sport: Sport, kind: Kind, dur: number, extra: Partial<Session> = {}): void => {
    S.push({ id: c.newId(), date, sport, kind, dur, rpe: RPE0[kind], src: 'auto', status: 'planned', with: [], week: wk, phase: info.ph, ...extra });
  };
  let used = fixed.reduce((a, x) => a + (x.dur || 0), 0);

  // Décrassage la veille des courses A et B.
  for (const r of c.events.filter((e) => e.kind === 'race' && e.prio !== 'C')) {
    const dt = addDays(r.date, -1);
    if (dt >= ws && dt <= we && free(dt)) { mk(dt, 'run', 'shake', 20); remaining--; used += 20; }
  }

  // Muscu : une seule, jamais en semaine de course.
  const hasStrength = inW().some((x) => x.kind === 'strength');
  if (set.strength > 0 && !hasStrength && remaining > 0 && info.ph !== 'racewk') {
    let best: string | null = null;
    let bc = 1e9;
    for (const d of days().filter(free)) {
      const cost = dayCost('strength', 45, d, c);
      if (cost < bc) { bc = cost; best = d; }
    }
    if (best && bc < 100) { mk(best, 'strength', 'strength', 45); remaining--; used += 45; }
  }
  if (remaining <= 0) return;

  let slots: Slot[] = SLOTS[info.ph].slice();
  const cur = inW();
  if (cur.some((x) => x.kind === 'long' || x.kind === 'race')) slots = slots.filter((s) => s !== 'long');
  if (cur.some((x) => x.kind === 'tempo' || x.kind === 'interval' || x.kind === 'hills')) slots = slots.filter((s) => s !== 'quality');
  // Semaine de partiels : on garde le volume utile mais on retire la séance qualité pour ménager le système nerveux.
  if (info.exam && info.ph !== 'racewk') slots = slots.map((s) => (s === 'quality' ? 'easy' : s));
  while (slots.length < remaining) slots.push('easy');
  slots = slots.slice(0, remaining);

  const pool = Math.max(M * 0.35, M - used);
  const wsum = slots.reduce((a, s) => a + WGT[s], 0) || 1;
  const order: Slot[] = ['long', 'quality', 'light', 'easy', 'easy2', 'recovery'];
  slots.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const slot of slots) {
    const kind = kindFor(slot, info.ph, wk);
    const [lo, hi] = BOUNDS[slot];
    const dur = clamp(Math.round(((pool * WGT[slot]) / wsum) / 5) * 5, lo, hi);
    let best: string | null = null;
    let bc = 1e9;
    for (const d of days().filter(free)) {
      let cost = dayCost(kind, dur, d, c);
      if (slot === 'light' && info.inWeek[0]) cost += Math.abs(diffDays(info.inWeek[0].date, d) - 3) * 3;
      if (cost < bc) { bc = cost; best = d; }
    }
    if (!best || bc >= 200) continue;
    mk(best, sportFor(slot, kind, info.ph, best, set, wk), kind, dur, slot === 'light' ? { light: true } : {});
  }
}

/* ---------- événements et régénération ---------- */

export function estimateMin(ev: Pick<RaceEvent, 'dur' | 'dist' | 'dplus' | 'sport'>, pace: string): number {
  if (ev.dur) return ev.dur;
  const d = ev.dist || 0;
  const u = ev.dplus || 0;
  if (ev.sport === 'bike') return Math.round((d * 2.4) / 5) * 5 || 120;
  if (ev.sport === 'ski' || ev.sport === 'roller') return Math.round((d * 5) / 5) * 5 || 60;
  const [m, s] = pace.split(':').map(Number);
  const perKm = ((m || 6) * 60 + (s || 0)) / 60;
  const eff = d + u / 100;
  return Math.max(20, Math.round((eff * perKm * (1 + Math.max(0, eff - 20) * 0.004)) / 5) * 5);
}

/** Une séance suit chaque course ou sortie prévue. Elle est mise à jour tant qu'elle n'est pas validée. */
export function syncEvents(events: readonly RaceEvent[], sessions: Session[], settings: Settings, newId: IdGen): Session[] {
  const ids = new Set(events.map((e) => e.id));
  const out = sessions.filter((s) => !s.eventId || ids.has(s.eventId) || s.status === 'done');
  for (const e of events) {
    const kind: Kind = e.kind === 'race' ? 'race' : 'long';
    let s = out.find((x) => x.eventId === e.id);
    if (!s) {
      s = { id: newId(), eventId: e.id, date: e.date, sport: e.sport, kind, dur: 0, rpe: RPE0[kind], src: 'event', status: 'planned', with: e.with };
      out.push(s);
    }
    if (s.status === 'planned') {
      s.date = e.date; s.sport = e.sport; s.kind = kind; s.dur = estimateMin(e, settings.pace); s.title = e.name; s.with = e.with;
    }
  }
  return out;
}

export interface RegenResult { sessions: Session[]; anchor: string }

/**
 * Recalcule les séances automatiques à venir. Les séances déplacées, ajoutées, validées ou
 * passées ne sont jamais écrasées.
 */
export function regenerate(input: PlanInput, newId: IdGen): RegenResult {
  const t = input.today;
  const anchor = isDate(input.anchor) && diffDays(t, input.anchor) <= 140 ? input.anchor : weekStart(t);
  let sessions = input.sessions
    .filter((s) => !(s.src === 'auto' && s.status === 'planned' && s.date >= t))
    .map((s) => ({ ...s }));
  sessions = syncEvents(input.events, sessions, input.settings, newId);
  const c: PlanCtx = { today: t, settings: input.settings, events: input.events, sessions, busy: input.busy, newId };
  const last = input.events.reduce((m, e) => (e.date > m ? e.date : m), '0');
  const end = addDays(input.settings.skiStart, 28);
  let horizon = last > '0' && addDays(last, 7) > end ? addDays(last, 7) : end;
  if (horizon > addDays(t, 189)) horizon = addDays(t, 189);
  for (let ws = weekStart(t); ws <= horizon; ws = addDays(ws, 7)) {
    planWeek(c, ws, Math.max(0, Math.round(diffDays(ws, anchor) / 7)));
  }
  c.sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { sessions: c.sessions, anchor };
}

export { prepFor };
