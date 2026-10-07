import { addDays, clamp, diffDays } from './dates.ts';
import type { FormEntry, Session, Sport } from './types.ts';

/** Facteur d'intensité (équivalent IF) déduit de l'effort ressenti de 1 à 10. */
export const intensityFactor = (rpe: number): number => clamp(0.4 + 0.06 * rpe, 0.46, 1);
export const rpeFromIntensity = (f: number): number => clamp(Math.round((f - 0.4) / 0.06), 1, 10);

/**
 * Charge estimée à partir de la durée et de l'effort ressenti, à l'échelle du TSS :
 * 1 h à RPE 10 vaut 100. La muscu pèse 20 % de moins à durée égale.
 */
export function estimateTss(durMin: number, rpe: number, sport: Sport): number {
  const f = intensityFactor(rpe);
  return (durMin / 60) * f * f * 100 * (sport === 'strength' ? 0.8 : 1);
}

export function sessionLoad(s: Session): number {
  if (s.status === 'done' && s.done) return s.done.tss ?? estimateTss(s.done.dur, s.done.rpe, s.sport);
  return estimateTss(s.dur, s.rpe, s.sport);
}

export interface ActivityMetrics {
  durSec: number;
  sport: Sport;
  avgHr?: number | null;
  normPower?: number | null;
  rpeHint?: number | null;
}
export interface AthleteRefs { ftp: number | null; lthr: number | null }
export type TssMethod = 'power' | 'heartrate' | 'rpe';

/** TSS d'une activité réelle : puissance si possible, sinon fréquence cardiaque, sinon effort ressenti. */
export function activityLoad(m: ActivityMetrics, ath: AthleteRefs): { tss: number; rpe: number; method: TssMethod } {
  const hours = m.durSec / 3600;
  if (m.sport === 'bike' && m.normPower && ath.ftp) {
    const f = clamp(m.normPower / ath.ftp, 0.3, 1.3);
    return { tss: hours * f * f * 100, rpe: rpeFromIntensity(Math.min(f, 1)), method: 'power' };
  }
  if (m.sport !== 'strength' && m.avgHr && ath.lthr) {
    const f = clamp(m.avgHr / ath.lthr, 0.4, 1.15);
    return { tss: hours * f * f * 100, rpe: rpeFromIntensity(Math.min(f, 1)), method: 'heartrate' };
  }
  const rpe = clamp(Math.round(m.rpeHint ?? 5), 1, 10);
  return { tss: estimateTss(m.durSec / 60, rpe, m.sport), rpe, method: 'rpe' };
}

export interface LoadStats {
  /** Forme de fond (moyenne mobile sur 42 jours). */
  ctl: number;
  /** Fatigue récente (moyenne mobile sur 7 jours). */
  atl: number;
  /** Fraîcheur = forme de fond − fatigue récente. */
  tsb: number;
  /** Fatigue récente / forme de fond, nul tant que l'historique est trop court. */
  ratio: number | null;
  /** Vrai après environ 3 semaines et 6 séances validées. */
  reliable: boolean;
  feelLeg: number | null;
  feelNerv: number | null;
  minutes7: number;
}

export function loadStats(sessions: readonly Session[], form: Readonly<Record<string, FormEntry>>, today: string): LoadStats {
  const done = sessions.filter((s) => s.status === 'done' && s.date <= today);
  const daily = new Map<string, number>();
  for (const s of done) daily.set(s.date, (daily.get(s.date) ?? 0) + sessionLoad(s));
  const first = done.reduce((m, s) => (s.date < m ? s.date : m), today);
  const span = diffDays(today, first) + 1;
  const kc = 1 - Math.exp(-1 / 42);
  const ka = 1 - Math.exp(-1 / 7);
  // Initialisation sur la moyenne des 14 premiers jours pour éviter un « chargé » artificiel au départ.
  const n0 = Math.min(span, 14);
  let seed = 0;
  for (let i = 0; i < n0; i++) seed += daily.get(addDays(first, i)) ?? 0;
  let ctl = seed / n0;
  let atl = ctl;
  for (let i = span - 1; i >= 0; i--) {
    const x = daily.get(addDays(today, -i)) ?? 0;
    ctl += (x - ctl) * kc;
    atl += (x - atl) * ka;
  }
  const entries: FormEntry[] = [];
  for (let i = 0; i < 7; i++) {
    const f = form[addDays(today, -i)];
    if (f) entries.push(f);
  }
  const avg = (k: 'leg' | 'nerv'): number | null => {
    const v = entries.map((e) => e[k]).filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return {
    ctl, atl, tsb: ctl - atl,
    ratio: ctl > 15 ? atl / ctl : null,
    reliable: span >= 21 && done.length >= 6,
    feelLeg: avg('leg'), feelNerv: avg('nerv'),
    minutes7: done.filter((s) => s.date >= addDays(today, -6)).reduce((a, s) => a + (s.done?.dur ?? s.dur), 0),
  };
}
