import { HEAVY, RPE0 } from './constants.ts';
import { addDays, dateLabel, diffDays, weekStart } from './dates.ts';
import { estimateTss } from './load.ts';
import { bestSlot, classMinutes, type PlanCtx } from './planner.ts';
import type { FormEntry, Kind, Session, Settings, SuggestionAction } from './types.ts';

type Ctx = Pick<PlanCtx, 'today' | 'sessions' | 'settings' | 'events' | 'busy' | 'newId'>;

/* ---------- alléger ---------- */

/** Version plus douce d'une séance. Elle devient une séance utilisateur, que la régénération ne touche plus. */
export function lighten(s: Session): Session {
  const o: Session = { ...s };
  if (o.kind === 'strength') {
    o.kind = 'recovery'; o.sport = 'other'; o.dur = 25; o.title = 'Mobilité et étirements'; o.upper = false;
  } else {
    o.kind = o.kind === 'recovery' ? 'recovery' : 'easy';
    o.dur = Math.max(20, Math.min(45, Math.round((o.dur * 0.5) / 5) * 5));
    delete o.title;
  }
  o.rpe = RPE0[o.kind];
  o.light = false;
  delete o.steps;
  o.src = o.src === 'event' ? 'event' : 'user';
  o.note = 'Allégée (fatigue)';
  return o;
}

/* ---------- conseil du jour : jambes, tête, sommeil ---------- */

export type AdaptMode = 'rest' | 'core' | 'upper' | 'easy';
export interface AdaptAdvice { mode: AdaptMode; label: string; why: string }

/**
 * Compare la séance prévue à ta forme du matin. Les séances de course ou de sortie prévue ne sont jamais
 * modifiées automatiquement : c'est à toi de décider au réveil.
 */
export function adaptDay(s: Session, f: FormEntry | null | undefined, c: Pick<PlanCtx, 'sessions' | 'settings'>): AdaptAdvice | null {
  if (!f || (f.leg == null && f.nerv == null && f.sleep == null) || s.status !== 'planned' || s.eventId) return null;
  const leg = f.leg ?? 3;
  let nerv = f.nerv ?? 3;
  if (f.sleep != null && f.sleep <= 2) nerv = Math.min(nerv, 2);
  const heavy = HEAVY.has(s.kind);

  if (leg <= 2 && nerv <= 2) return { mode: 'rest', label: 'mobilité et marche, 20′', why: 'Jambes et tête sont fatiguées : le repos est le bon choix aujourd’hui.' };
  if (leg <= 2) {
    if (s.kind === 'strength' && (s.upper || /haut/i.test(s.title ?? ''))) return null;
    if (leg === 2 && !heavy && s.kind !== 'strength' && s.dur <= 40) return null;
    const ws = weekStart(s.date);
    const others = c.sessions.filter((x) => x.id !== s.id && x.status !== 'skipped' && x.kind === 'strength' && x.date >= ws && x.date <= addDays(ws, 6)).length;
    return others >= c.settings.strength
      ? { mode: 'core', label: 'gainage et mobilité, 25′', why: 'Jambes lourdes, tête OK. Ta muscu de la semaine est déjà prévue, donc on fait du gainage léger plutôt qu’une deuxième séance.' }
      : { mode: 'upper', label: 'haut du corps et gainage, 40′', why: 'Jambes lourdes, tête OK : tu peux travailler le haut du corps sans les solliciter. C’est mieux qu’un repos complet.' };
  }
  if (nerv <= 2 && (heavy || s.dur > 60)) {
    return { mode: 'easy', label: 'version facile, sans intensité', why: 'Les jambes répondent mais la tête est fatiguée (sommeil, stress, cours). On garde du mouvement, sans intensité, et on reporte le dur.' };
  }
  return null;
}

const REPLACEMENTS: Record<Exclude<AdaptMode, 'easy'>, Partial<Session>> = {
  upper: { sport: 'strength', kind: 'strength', dur: 40, rpe: 5, title: 'Haut du corps et gainage', upper: true },
  core: { sport: 'other', kind: 'recovery', dur: 25, rpe: 2, title: 'Gainage et mobilité', upper: false },
  rest: { sport: 'other', kind: 'recovery', dur: 20, rpe: 1, title: 'Mobilité et marche', upper: false },
};

/** Applique un conseil. Une séance dure est recopiée sur le meilleur jour des 6 prochains. */
export function adaptSession(sessions: readonly Session[], id: string, mode: AdaptMode, c: Ctx): { sessions: Session[]; moved: string | null } {
  const out = sessions.map((x) => ({ ...x }));
  const s = out.find((x) => x.id === id);
  if (!s) return { sessions: out, moved: null };
  let moved: string | null = null;
  if (HEAVY.has(s.kind) && !s.eventId) {
    moved = bestSlot(s, { ...c, sessions: out });
    if (moved) out.push({ ...s, id: c.newId(), date: moved, src: 'user', status: 'planned', note: 'Reportée (fatigue)' });
  }
  if (mode === 'easy') Object.assign(s, lighten(s));
  else {
    const to = REPLACEMENTS[mode];
    Object.assign(s, to);
    s.light = false;
    delete s.steps;
    s.src = 'user';
    s.note = 'Adaptée à ta forme du jour';
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { sessions: out, moved };
}

/* ---------- séance bien plus dure que prévu ---------- */

export interface OverloadResult { sessions: Session[]; changes: string[]; applied: boolean }

/**
 * Quand une séance réelle dépasse nettement le plan (par exemple 60 prévus, 130 réalisés), on allège
 * les trois jours suivants : séances dures en endurance, autres séances raccourcies.
 */
export function absorbOverload(sessions: readonly Session[], actualDate: string, actualTss: number, plannedTss: number, c: Pick<PlanCtx, 'settings' | 'events'>): OverloadResult {
  const out = sessions.map((x) => ({ ...x }));
  const excess = actualTss - plannedTss;
  if (!(actualTss >= plannedTss * 1.5 && excess >= 30)) return { sessions: out, changes: [], applied: false };
  const changes: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = addDays(actualDate, i);
    for (const s of out.filter((x) => x.date === d && x.status === 'planned' && !x.eventId)) {
      const heavy = HEAVY.has(s.kind);
      if (!heavy && !(s.kind === 'strength' && i === 1) && !(i === 1 && s.dur > 45)) continue;
      if (i === 3 && !(heavy && excess >= 70)) continue;
      const before = `${s.title ?? s.kind} ${s.dur}′`;
      if (heavy) {
        s.kind = 'easy'; s.rpe = RPE0.easy; s.dur = Math.min(s.dur, 50); delete s.title; delete s.steps; s.light = false;
      } else if (s.kind === 'strength') {
        s.kind = 'recovery'; s.sport = 'other'; s.dur = 25; s.rpe = RPE0.recovery; s.title = 'Mobilité et étirements'; s.upper = false; delete s.steps;
      } else {
        s.dur = Math.max(20, Math.round((s.dur * 0.7) / 5) * 5); delete s.steps;
      }
      s.src = 'user';
      s.note = 'Allégée après une séance plus dure que prévu';
      changes.push(`${dateLabel(d)} : ${before} devient ${s.title ?? s.kind} ${s.dur}′`);
    }
  }
  void c;
  return { sessions: out, changes, applied: changes.length > 0 };
}

/* ---------- appliquer une proposition (météo, journée dense) ---------- */

export function applyAction(s: Session, action: SuggestionAction, note: string): Session {
  const o: Session = { ...s };
  if (action.type === 'shake') {
    Object.assign(o, { sport: 'run', kind: 'shake', dur: 30, rpe: RPE0.shake, title: 'Décrassage 30′' });
    o.upper = false; o.indoor = false;
  } else {
    Object.assign(o, { sport: action.sport, kind: action.kind, dur: action.dur, rpe: RPE0[action.kind], title: action.title });
    o.indoor = action.indoor === true;
    o.upper = action.upper === true;
  }
  o.light = false;
  delete o.steps;
  o.src = 'weather' === o.src ? 'weather' : 'user';
  o.note = note;
  return o;
}

/* ---------- avertissements ---------- */

export function warnMove(s: Session, newDate: string, c: Pick<PlanCtx, 'today' | 'sessions' | 'settings' | 'events' | 'busy'>): string[] {
  const w: string[] = [];
  const others = c.sessions.filter((x) => x.id !== s.id && x.status !== 'skipped');
  if (newDate < c.today) w.push('Date passée');
  if (others.some((x) => x.date === newDate)) w.push('Déjà une séance ce jour-là');
  const heavy = HEAVY.has(s.kind);
  const cm = classMinutes(newDate, c.busy, c.settings);
  if (cm >= c.settings.denseClassMin && s.kind !== 'shake' && s.kind !== 'recovery') w.push(`Journée dense (${Math.round(cm / 60)} h de cours) : un décrassage suffit`);
  else if (heavy && cm >= 150) w.push('Jour de cours chargé');
  if (heavy && c.busy[newDate]?.exam) w.push('Jour d’examen');
  if (heavy && others.some((x) => HEAVY.has(x.kind) && Math.abs(diffDays(x.date, newDate)) === 1)) w.push('Deux séances dures de suite');
  for (const r of c.events.filter((e) => e.kind === 'race')) {
    const g = diffDays(r.date, newDate);
    if (g === 1 && s.kind !== 'shake' && s.dur > 30) w.push('Veille de course');
    else if (g === 2 && heavy && r.prio !== 'C') w.push('Séance dure 2 jours avant une course');
    else if (g === 0 && s.eventId !== r.id) w.push('Jour de course');
  }
  const ws = weekStart(newDate);
  const wk = others.filter((x) => x.date >= ws && x.date <= addDays(ws, 6));
  if (wk.length + 1 > c.settings.perWeek) w.push(`${wk.length + 1} séances cette semaine (cible ${c.settings.perWeek})`);
  if (s.kind === 'strength' && wk.some((x) => x.kind === 'strength')) w.push('Deuxième muscu de la semaine');
  return w;
}

export function weekWarnings(ws: string, sessions: readonly Session[], settings: Settings): string[] {
  const we = addDays(ws, 6);
  const w: string[] = [];
  const ss = sessions.filter((x) => x.date >= ws && x.date <= we && x.status !== 'skipped');
  if (ss.length > settings.perWeek) w.push(`${ss.length} séances, au-dessus de ta cible de ${settings.perWeek}`);
  if (ss.filter((x) => x.kind === 'strength').length > 1) w.push('Plus d’une séance de muscu');
  const hv = ss.filter((x) => HEAVY.has(x.kind as Kind)).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (let i = 1; i < hv.length; i++) {
    if (diffDays(hv[i]!.date, hv[i - 1]!.date) === 1) { w.push('Deux séances dures de suite'); break; }
  }
  return w;
}

/** Charge prévue d'une séance, utile pour comparer au réel. */
export const plannedLoad = (s: Pick<Session, 'dur' | 'rpe' | 'sport'>): number => estimateTss(s.dur, s.rpe, s.sport);
