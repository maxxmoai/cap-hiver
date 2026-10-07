import { KINDS, SPORTS } from '../engine/constants.ts';
import { clamp, isDate } from '../engine/dates.ts';
import type { AdaptMode } from '../engine/adapt.ts';
import type { EventKind, Kind, Prio, Settings, Sport } from '../engine/types.ts';
import type { CoachChange } from '../lib/coach.ts';
import { sanitizeSettings } from './sanitize.ts';

export type Action =
  | { type: 'setForm'; axis: 'leg' | 'nerv' | 'sleep'; value: number }
  | { type: 'logSession'; id: string; dur: number; dist: number | null; rpe: number; feel: number; legs: number; note: string }
  | { type: 'moveSession'; id: string; date: string }
  | { type: 'skipSession' | 'reopenSession' | 'deleteSession' | 'lightenSession'; id: string }
  | { type: 'adaptSession'; id: string; mode: AdaptMode }
  | { type: 'saveSession'; id?: string; date: string; time?: string; sport: Sport; kind: Kind; dur: number; place?: string; title?: string; note?: string; with: string[] }
  | { type: 'saveEvent'; id?: string; kind: EventKind; name: string; date: string; sport: Sport; dist: number; dplus: number; dur: number; prio: Prio; notes: string; with: string[] }
  | { type: 'deleteEvent'; id: string }
  | { type: 'togglePrep'; eventId: string; prepId: string; done: boolean }
  | { type: 'saveSettings'; settings: Partial<Settings> }
  | { type: 'saveCalendarUrl'; url: string | null }
  | { type: 'regenerate' }
  | { type: 'resolveSuggestion'; id: string; optionIndex: number | null }
  | { type: 'applyCoach'; changes: CoachChange[] };

export type ParseResult = { ok: true; action: Action } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, lo: number, hi: number, fallback: number): number => (Number.isFinite(Number(v)) && v !== '' && v !== null ? clamp(Math.round(Number(v)), lo, hi) : fallback);
const flo = (v: unknown, lo: number, hi: number, fallback: number): number => (Number.isFinite(Number(v)) && v !== '' && v !== null ? clamp(Number(v), lo, hi) : fallback);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 30)).slice(0, 10) : []);

/** Valide une action reçue du navigateur. Rien n'est supposé : tout est borné ou refusé. */
export function parseAction(raw: unknown): ParseResult {
  if (!isObj(raw) || typeof raw['type'] !== 'string') return { ok: false, error: 'Action manquante.' };
  const bad = (error: string): ParseResult => ({ ok: false, error });
  const id = str(raw['id'], 40);
  switch (raw['type']) {
    case 'setForm': {
      const axis = raw['axis'];
      if (axis !== 'leg' && axis !== 'nerv' && axis !== 'sleep') return bad('Axe de forme inconnu.');
      return { ok: true, action: { type: 'setForm', axis, value: int(raw['value'], 1, 5, 3) } };
    }
    case 'logSession':
      if (!id) return bad('Séance inconnue.');
      return { ok: true, action: { type: 'logSession', id, dur: int(raw['dur'], 1, 900, 45), dist: raw['dist'] === null || raw['dist'] === '' || raw['dist'] === undefined ? null : flo(raw['dist'], 0, 1000, 0), rpe: int(raw['rpe'], 1, 10, 4), feel: int(raw['feel'], 1, 5, 3), legs: int(raw['legs'], 1, 5, 3), note: str(raw['note'], 300) } };
    case 'moveSession':
      if (!id || !isDate(raw['date'])) return bad('Séance ou date invalide.');
      return { ok: true, action: { type: 'moveSession', id, date: raw['date'] } };
    case 'skipSession': case 'reopenSession': case 'deleteSession': case 'lightenSession':
      if (!id) return bad('Séance inconnue.');
      return { ok: true, action: { type: raw['type'], id } };
    case 'adaptSession': {
      const mode = raw['mode'];
      if (!id || (mode !== 'rest' && mode !== 'core' && mode !== 'upper' && mode !== 'easy')) return bad('Adaptation invalide.');
      return { ok: true, action: { type: 'adaptSession', id, mode } };
    }
    case 'saveSession': {
      if (!isDate(raw['date']) || typeof raw['sport'] !== 'string' || !(raw['sport'] in SPORTS) || typeof raw['kind'] !== 'string' || !(raw['kind'] in KINDS) || raw['kind'] === 'race') return bad('Séance invalide.');
      const time = typeof raw['time'] === 'string' && /^\d{2}:\d{2}$/.test(raw['time']) ? raw['time'] : undefined;
      return { ok: true, action: { type: 'saveSession', ...(id && { id }), date: raw['date'], ...(time && { time }), sport: raw['sport'] as Sport, kind: raw['kind'] as Kind, dur: int(raw['dur'], 10, 600, 45), ...(str(raw['place'], 80) && { place: str(raw['place'], 80) }), ...(str(raw['title'], 60) && { title: str(raw['title'], 60) }), ...(str(raw['note'], 300) && { note: str(raw['note'], 300) }), with: names(raw['with']) } };
    }
    case 'saveEvent': {
      if (!isDate(raw['date']) || !str(raw['name'], 80) || typeof raw['sport'] !== 'string' || !(raw['sport'] in SPORTS)) return bad('Échéance invalide.');
      return { ok: true, action: { type: 'saveEvent', ...(id && { id }), kind: raw['kind'] === 'outing' ? 'outing' : 'race', name: str(raw['name'], 80), date: raw['date'], sport: raw['sport'] as Sport, dist: flo(raw['dist'], 0, 1000, 0), dplus: flo(raw['dplus'], 0, 20000, 0), dur: int(raw['dur'], 0, 2000, 0), prio: raw['prio'] === 'A' || raw['prio'] === 'C' ? raw['prio'] : 'B', notes: str(raw['notes'], 500), with: names(raw['with']) } };
    }
    case 'deleteEvent':
      return id ? { ok: true, action: { type: 'deleteEvent', id } } : bad('Échéance inconnue.');
    case 'togglePrep': {
      const prepId = str(raw['prepId'], 40);
      const eventId = str(raw['eventId'], 40);
      return eventId && prepId ? { ok: true, action: { type: 'togglePrep', eventId, prepId, done: raw['done'] === true } } : bad('Étape inconnue.');
    }
    case 'saveSettings':
      if (!isObj(raw['settings'])) return bad('Réglages manquants.');
      return { ok: true, action: { type: 'saveSettings', settings: raw['settings'] as Partial<Settings> } };
    case 'saveCalendarUrl':
      return { ok: true, action: { type: 'saveCalendarUrl', url: str(raw['url'], 600) || null } };
    case 'regenerate':
      return { ok: true, action: { type: 'regenerate' } };
    case 'resolveSuggestion':
      return id ? { ok: true, action: { type: 'resolveSuggestion', id, optionIndex: raw['optionIndex'] === null || raw['optionIndex'] === undefined ? null : int(raw['optionIndex'], 0, 5, 0) } } : bad('Proposition inconnue.');
    case 'applyCoach': {
      if (!Array.isArray(raw['changes'])) return bad('Changements manquants.');
      return { ok: true, action: { type: 'applyCoach', changes: raw['changes'] as CoachChange[] } };
    }
    default:
      return bad('Action inconnue.');
  }
}

/** Réglages partiels valides, sans écraser ce qui n'est pas envoyé. */
export const mergeSettings = (base: Settings, patch: Partial<Settings>): Settings => sanitizeSettings({ ...base, ...patch }, base);
