import type { Kind, PhaseId, Settings, Sport } from './types.ts';

export const SPORTS: Record<Sport, { name: string; short: string; outdoor: boolean }> = {
  run: { name: 'Course à pied', short: 'Course', outdoor: true },
  trail: { name: 'Trail', short: 'Trail', outdoor: true },
  bike: { name: 'Vélo', short: 'Vélo', outdoor: true },
  strength: { name: 'Musculation', short: 'Muscu', outdoor: false },
  ski: { name: 'Ski de fond', short: 'Ski de fond', outdoor: true },
  roller: { name: 'Ski-roues', short: 'Ski-roues', outdoor: true },
  other: { name: 'Autre', short: 'Autre', outdoor: false },
};
export const SPORT_IDS = Object.keys(SPORTS) as Sport[];

export const KINDS: Record<Kind, string> = {
  easy: 'Endurance', long: 'Sortie longue', tempo: 'Tempo', interval: 'Fractionné', hills: 'Côtes / D+',
  recovery: 'Récupération', strength: 'Renfo', tech: 'Technique', shake: 'Décrassage', race: 'Course',
};
export const KIND_IDS = Object.keys(KINDS) as Kind[];

/** Séances qui sollicitent fortement l'organisme. */
export const HEAVY: ReadonlySet<Kind> = new Set<Kind>(['long', 'tempo', 'interval', 'hills', 'race']);

/** Effort ressenti (RPE) habituel de chaque type de séance. */
export const RPE0: Record<Kind, number> = {
  easy: 3, long: 4, tempo: 7, interval: 8, hills: 7, recovery: 2, strength: 6, tech: 3, shake: 3, race: 9,
};

export const PHASES: Record<PhaseId, string> = {
  build: 'Base', peak: 'Affûtage', racewk: 'Semaine course', recover: 'Récup',
  transition: 'Transition ski', ski: 'Ski de fond',
};

export const DEFAULT_EXAM_KEYWORDS: readonly string[] = ['partiel', 'examen', 'ds', 'controle', 'evaluation', 'epreuve'];

export const DEFAULT_SETTINGS: Settings = {
  perWeek: 5,
  strength: 1,
  rest: 0,
  busy: [1, 3],
  skiStart: '2026-12-12',
  roller: true,
  baseH: 5,
  maxH: 8,
  pace: '6:00',
  friends: [],
  timezone: 'Europe/Paris',
  denseClassMin: 420,
  examTaper: 0.2,
  examKeywords: [...DEFAULT_EXAM_KEYWORDS],
  ignoreKeywords: [],
  lat: null,
  lon: null,
  city: '',
  ftp: null,
  lthr: null,
};
