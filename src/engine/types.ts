export type Sport = 'run' | 'trail' | 'bike' | 'strength' | 'ski' | 'roller' | 'other';
export type Kind =
  | 'easy' | 'long' | 'tempo' | 'interval' | 'hills'
  | 'recovery' | 'strength' | 'tech' | 'shake' | 'race';
export type Prio = 'A' | 'B' | 'C';
export type EventKind = 'race' | 'outing';
export type SessionSrc = 'auto' | 'user' | 'social' | 'event' | 'ia' | 'strava' | 'weather';
export type SessionStatus = 'planned' | 'done' | 'skipped';
export type PhaseId = 'build' | 'peak' | 'racewk' | 'recover' | 'transition' | 'ski';

export interface Settings {
  perWeek: number;
  /** Nombre maximum de séances de muscu par semaine (0 ou 1). */
  strength: number;
  /** Jour de repos préféré, 0 = lundi. */
  rest: number;
  /** Jours de cours chargés quand aucun calendrier n'est synchronisé, 0 = lundi. */
  busy: number[];
  skiStart: string;
  roller: boolean;
  baseH: number;
  maxH: number;
  /** Allure d'endurance, "m:ss" par km. */
  pace: string;
  friends: string[];
  timezone: string;
  /** Minutes de cours à partir desquelles une journée est « dense ». */
  denseClassMin: number;
  /** Baisse de volume en semaine de partiels, 0.2 = −20 %. */
  examTaper: number;
  examKeywords: string[];
  ignoreKeywords: string[];
  lat: number | null;
  lon: number | null;
  city: string;
  ftp: number | null;
  lthr: number | null;
}

export interface PrepItem { id: string; off: number; text: string; done: boolean }

export interface RaceEvent {
  id: string;
  kind: EventKind;
  name: string;
  date: string;
  sport: Sport;
  dist: number;
  dplus: number;
  dur: number;
  prio: Prio;
  notes: string;
  with: string[];
  prep: PrepItem[];
  example?: boolean;
}

export interface Done {
  dur: number;
  dist: number | null;
  rpe: number;
  feel: number;
  legs: number;
  note: string;
  tss?: number;
  source: 'manual' | 'strava';
  stravaId?: string;
}

export interface Session {
  id: string;
  eventId?: string;
  date: string;
  time?: string;
  sport: Sport;
  kind: Kind;
  dur: number;
  rpe: number;
  src: SessionSrc;
  status: SessionStatus;
  title?: string;
  place?: string;
  note?: string;
  with: string[];
  steps?: string[];
  why?: string;
  light?: boolean;
  upper?: boolean;
  indoor?: boolean;
  phase?: PhaseId;
  week?: number;
  done?: Done;
  example?: boolean;
}

/** Charge de cours d'une journée, issue du calendrier synchronisé. */
export interface DayBusy {
  date: string;
  classMin: number;
  firstStart: number | null;
  lastEnd: number | null;
  exam: boolean;
  examLabel?: string;
}

/** Bilan du matin, chaque axe de 1 (au plus bas) à 5 (au mieux). */
export interface FormEntry {
  leg?: number | null;
  nerv?: number | null;
  sleep?: number | null;
}

export type SuggestionKind = 'weather' | 'snow' | 'fuel' | 'dense' | 'exam' | 'overload' | 'info';
export type SuggestionStatus = 'new' | 'accepted' | 'dismissed' | 'applied';

export type SuggestionAction =
  | { type: 'swap'; sport: Sport; kind: Kind; dur: number; title: string; indoor?: boolean; upper?: boolean }
  | { type: 'shake' };

export interface SuggestionOption { label: string; action: SuggestionAction }

export interface Suggestion {
  id: string;
  /** Clé de déduplication, par exemple « weather:2026-10-13:abc ». */
  key: string;
  kind: SuggestionKind;
  date: string;
  title: string;
  body: string;
  status: SuggestionStatus;
  sessionId?: string;
  options: SuggestionOption[];
  createdAt: string;
}

export interface PlanInput {
  today: string;
  settings: Settings;
  events: RaceEvent[];
  sessions: Session[];
  busy: Record<string, DayBusy>;
  anchor: string;
}

export type IdGen = () => string;
