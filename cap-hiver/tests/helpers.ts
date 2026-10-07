import { DEFAULT_SETTINGS } from '../src/engine/constants.ts';
import { prepFor } from '../src/engine/prep.ts';
import type { DayBusy, IdGen, PlanInput, RaceEvent, Session, Settings } from '../src/engine/types.ts';

export function counter(prefix = 'id'): IdGen {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function settings(over: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, skiStart: '2026-12-12', friends: ['Léo'], ...over };
}

export function race(id: string, date: string, over: Partial<RaceEvent> = {}): RaceEvent {
  const e: RaceEvent = {
    id, kind: 'race', name: `Course ${id}`, date, sport: 'trail', dist: 20, dplus: 800, dur: 0,
    prio: 'B', notes: '', with: [], prep: [], ...over,
  };
  e.prep = prepFor(e, counter(`p${id}`));
  return e;
}

export function busyDay(date: string, classMin: number, over: Partial<DayBusy> = {}): DayBusy {
  return { date, classMin, firstStart: classMin ? 480 : null, lastEnd: classMin ? 480 + classMin : null, exam: false, ...over };
}

/** 2026-10-07 est un mercredi. */
export function input(over: Partial<PlanInput> = {}): PlanInput {
  return { today: '2026-10-07', settings: settings(), events: [], sessions: [], busy: {}, anchor: '2026-10-05', ...over };
}

export function done(date: string, dur: number, rpe: number, over: Partial<Session> = {}): Session {
  return {
    id: `done-${date}`, date, sport: 'run', kind: 'easy', dur, rpe, src: 'user', status: 'done', with: [],
    done: { dur, dist: null, rpe, feel: 3, legs: 3, note: '', source: 'manual' }, ...over,
  };
}

export function planned(id: string, date: string, over: Partial<Session> = {}): Session {
  return { id, date, sport: 'run', kind: 'easy', dur: 60, rpe: 3, src: 'user', status: 'planned', with: [], ...over };
}
