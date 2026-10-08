import { DEFAULT_SETTINGS, KINDS, SPORTS } from '../engine/constants.ts';
import { clamp, isDate, weekStart } from '../engine/dates.ts';
import type { DayBusy, FormEntry, IdGen, Kind, PrepItem, RaceEvent, Session, Settings, Sport, Suggestion, SuggestionAction } from '../engine/types.ts';
import type { UserData } from './types.ts';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sport = (v: unknown): Sport => (typeof v === 'string' && v in SPORTS ? (v as Sport) : 'other');
const kind = (v: unknown, fallback: Kind = 'easy'): Kind => (typeof v === 'string' && v in KINDS ? (v as Kind) : fallback);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const nums = (v: unknown, lo: number, hi: number): number[] =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= lo && n <= hi))].sort() : [];
const words = (v: unknown, n = 10, max = 30): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, max)).slice(0, n) : []);
const num = (v: unknown, fallback: number, lo: number, hi: number): number => clamp(Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback, lo, hi);
const optNum = (v: unknown, lo: number, hi: number): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : clamp(Number(v), lo, hi));

/** Réglages valides : les champs absents ou invalides gardent la valeur de `base`. */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = isObj(raw) ? raw : {};
  const tz = typeof r['timezone'] === 'string' ? r['timezone'] : base.timezone;
  let timezone = base.timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); timezone = tz; } catch { /* fuseau inconnu : on garde l'ancien */ }
  const pace = typeof r['pace'] === 'string' && /^\d{1,2}:\d{2}$/.test(r['pace']) ? r['pace'] : base.pace;
  return {
    perWeek: Math.round(num(r['perWeek'], base.perWeek, 3, 7)),
    strength: num(r['strength'], base.strength, 0, 1) >= 0.5 ? 1 : 0,
    rest: Math.round(num(r['rest'], base.rest, 0, 6)),
    busy: 'busy' in r ? nums(r['busy'], 0, 6) : base.busy,
    skiStart: isDate(r['skiStart']) ? r['skiStart'] : base.skiStart,
    roller: typeof r['roller'] === 'boolean' ? r['roller'] : base.roller,
    baseH: num(r['baseH'], base.baseH, 2, 20),
    maxH: num(r['maxH'], base.maxH, 3, 25),
    pace,
    friends: 'friends' in r ? words(r['friends']) : base.friends,
    timezone,
    denseClassMin: Math.round(num(r['denseClassMin'], base.denseClassMin, 180, 720)),
    examTaper: num(r['examTaper'], base.examTaper, 0, 0.5),
    examKeywords: 'examKeywords' in r ? words(r['examKeywords'], 20, 30) : base.examKeywords,
    ignoreKeywords: 'ignoreKeywords' in r ? words(r['ignoreKeywords'], 20, 30) : base.ignoreKeywords,
    lat: 'lat' in r ? optNum(r['lat'], -90, 90) : base.lat,
    lon: 'lon' in r ? optNum(r['lon'], -180, 180) : base.lon,
    city: 'city' in r ? text(r['city'], 80) : base.city,
    ftp: 'ftp' in r ? optNum(r['ftp'], 50, 700) : base.ftp,
    lthr: 'lthr' in r ? optNum(r['lthr'], 80, 230) : base.lthr,
  };
}

function sanitizeSession(raw: unknown, newId: IdGen): Session | null {
  if (!isObj(raw) || !isDate(raw['date'])) return null;
  const k = kind(raw['kind']);
  const s: Session = {
    id: text(raw['id'], 40) || newId(), date: raw['date'], sport: sport(raw['sport']), kind: k,
    dur: Math.round(num(raw['dur'], 45, 5, 600)), rpe: Math.round(num(raw['rpe'], 4, 1, 10)),
    src: (['auto', 'user', 'social', 'event', 'ia', 'strava', 'weather'] as const).find((x) => x === raw['src']) ?? 'user',
    status: (['planned', 'done', 'skipped'] as const).find((x) => x === raw['status']) ?? 'planned',
    with: words(raw['with']),
  };
  if (typeof raw['eventId'] === 'string') s.eventId = raw['eventId'].slice(0, 40);
  if (typeof raw['time'] === 'string' && /^\d{2}:\d{2}$/.test(raw['time'])) s.time = raw['time'];
  for (const f of ['title', 'place', 'note', 'why'] as const) if (typeof raw[f] === 'string' && raw[f]) s[f] = raw[f].slice(0, f === 'note' || f === 'why' ? 300 : 80);
  if (Array.isArray(raw['steps'])) { const st = words(raw['steps'], 8, 160); if (st.length) s.steps = st; }
  for (const f of ['light', 'upper', 'indoor'] as const) if (raw[f] === true) s[f] = true;
  if (typeof raw['week'] === 'number' && Number.isFinite(raw['week'])) s.week = Math.round(raw['week']);
  if (typeof raw['phase'] === 'string' && ['build', 'peak', 'racewk', 'recover', 'transition', 'ski'].includes(raw['phase'])) s.phase = raw['phase'] as NonNullable<Session['phase']>;
  const d = raw['done'];
  if (isObj(d)) {
    s.done = {
      dur: Math.round(num(d['dur'], s.dur, 1, 900)), dist: optNum(d['dist'], 0, 1000), rpe: Math.round(num(d['rpe'], s.rpe, 1, 10)),
      feel: Math.round(num(d['feel'], 3, 1, 5)), legs: Math.round(num(d['legs'], 3, 1, 5)), note: text(d['note'], 300),
      source: d['source'] === 'strava' ? 'strava' : d['source'] === 'intervals' ? 'intervals' : 'manual',
      ...(optNum(d['tss'], 0, 1000) !== null && { tss: optNum(d['tss'], 0, 1000)! }),
      ...(typeof d['stravaId'] === 'string' && { stravaId: d['stravaId'].slice(0, 30) }),
    };
  }
  if (s.status === 'done' && !s.done) s.status = 'planned';
  return s;
}

function sanitizeEvent(raw: unknown, newId: IdGen): RaceEvent | null {
  if (!isObj(raw) || !isDate(raw['date']) || typeof raw['name'] !== 'string' || !raw['name'].trim()) return null;
  const prep: PrepItem[] = (Array.isArray(raw['prep']) ? raw['prep'] : []).flatMap((p): PrepItem[] =>
    isObj(p) && typeof p['text'] === 'string' && Number.isFinite(Number(p['off']))
      ? [{ id: text(p['id'], 40) || newId(), off: Math.round(Number(p['off'])), text: p['text'].slice(0, 200), done: p['done'] === true }]
      : []);
  return {
    id: text(raw['id'], 40) || newId(), kind: raw['kind'] === 'outing' ? 'outing' : 'race', name: raw['name'].trim().slice(0, 80),
    date: raw['date'], sport: sport(raw['sport']), dist: num(raw['dist'], 0, 0, 1000), dplus: num(raw['dplus'], 0, 0, 20000),
    dur: Math.round(num(raw['dur'], 0, 0, 2000)), prio: raw['prio'] === 'A' || raw['prio'] === 'C' ? raw['prio'] : 'B',
    notes: text(raw['notes'], 500), with: words(raw['with']), prep,
  };
}

function sanitizeAction(raw: unknown): SuggestionAction | null {
  if (!isObj(raw)) return null;
  if (raw['type'] === 'shake') return { type: 'shake' };
  if (raw['type'] === 'swap') {
    return { type: 'swap', sport: sport(raw['sport']), kind: kind(raw['kind']), dur: Math.round(num(raw['dur'], 45, 10, 360)), title: text(raw['title'], 60), ...(raw['indoor'] === true && { indoor: true }), ...(raw['upper'] === true && { upper: true }) };
  }
  return null;
}

function sanitizeSuggestion(raw: unknown, newId: IdGen): Suggestion | null {
  if (!isObj(raw) || !isDate(raw['date']) || typeof raw['key'] !== 'string') return null;
  const kinds = ['weather', 'snow', 'fuel', 'dense', 'exam', 'overload', 'info'] as const;
  const options = (Array.isArray(raw['options']) ? raw['options'] : []).flatMap((o) => {
    if (!isObj(o)) return [];
    const a = sanitizeAction(o['action']);
    return a ? [{ label: text(o['label'], 60), action: a }] : [];
  });
  return {
    id: text(raw['id'], 40) || newId(), key: raw['key'].slice(0, 120), kind: kinds.find((x) => x === raw['kind']) ?? 'info', date: raw['date'],
    title: text(raw['title'], 120), body: text(raw['body'], 600),
    status: (['new', 'accepted', 'dismissed', 'applied'] as const).find((x) => x === raw['status']) ?? 'new',
    ...(typeof raw['sessionId'] === 'string' && { sessionId: raw['sessionId'].slice(0, 40) }),
    options, createdAt: text(raw['createdAt'], 40),
  };
}

function sanitizeBusy(raw: unknown): Record<string, DayBusy> {
  const out: Record<string, DayBusy> = {};
  if (!isObj(raw)) return out;
  for (const [d, v] of Object.entries(raw)) {
    if (!isDate(d) || !isObj(v)) continue;
    out[d] = {
      date: d, classMin: Math.round(num(v['classMin'], 0, 0, 1440)), firstStart: optNum(v['firstStart'], 0, 1440), lastEnd: optNum(v['lastEnd'], 0, 1440),
      exam: v['exam'] === true, ...(typeof v['examLabel'] === 'string' && { examLabel: v['examLabel'].slice(0, 60) }),
    };
  }
  return out;
}

function sanitizeForm(raw: unknown): Record<string, FormEntry> {
  const out: Record<string, FormEntry> = {};
  if (!isObj(raw)) return out;
  for (const [d, v] of Object.entries(raw)) {
    if (!isDate(d)) continue;
    if (typeof v === 'number') { out[d] = { leg: clamp(Math.round(v), 1, 5), nerv: clamp(Math.round(v), 1, 5) }; continue; }
    if (!isObj(v)) continue;
    const ax = (x: unknown): number | null => (x === null || x === undefined ? null : clamp(Math.round(Number(x)) || 3, 1, 5));
    out[d] = { leg: ax(v['leg']), nerv: ax(v['nerv']), sleep: ax(v['sleep']) };
  }
  return out;
}

/** Données lues en base ou reçues d'un client : tout ce qui est invalide est corrigé ou écarté. */
export function sanitizeUserData(raw: unknown, newId: IdGen, today: string): UserData {
  const r = isObj(raw) ? raw : {};
  const cal = isObj(r['calendar']) ? r['calendar'] : {};
  const wx = isObj(r['weather']) ? r['weather'] : {};
  const co = isObj(r['coach']) ? r['coach'] : {};
  const st = isObj(r['strava']) ? r['strava'] : {};
  const iv = isObj(r['intervals']) ? r['intervals'] : {};
  return {
    v: 2,
    settings: sanitizeSettings(r['settings']),
    events: (Array.isArray(r['events']) ? r['events'] : []).flatMap((e) => { const x = sanitizeEvent(e, newId); return x ? [x] : []; }),
    sessions: (Array.isArray(r['sessions']) ? r['sessions'] : []).flatMap((s) => { const x = sanitizeSession(s, newId); return x ? [x] : []; }),
    form: sanitizeForm(r['form']),
    busy: sanitizeBusy(r['busy']),
    suggestions: (Array.isArray(r['suggestions']) ? r['suggestions'] : []).flatMap((s) => { const x = sanitizeSuggestion(s, newId); return x ? [x] : []; }),
    anchor: isDate(r['anchor']) ? r['anchor'] : weekStart(today),
    calendar: {
      url: typeof cal['url'] === 'string' && cal['url'] ? cal['url'].slice(0, 600) : null,
      lastSyncAt: typeof cal['lastSyncAt'] === 'string' ? cal['lastSyncAt'] : null,
      lastError: typeof cal['lastError'] === 'string' ? cal['lastError'].slice(0, 200) : null,
      coveredTo: isDate(cal['coveredTo']) ? cal['coveredTo'] : null,
    },
    weather: { syncedAt: typeof wx['syncedAt'] === 'string' ? wx['syncedAt'] : null, error: typeof wx['error'] === 'string' ? wx['error'].slice(0, 200) : null },
    coach: {
      message: text(co['message'], 900), at: typeof co['at'] === 'string' ? co['at'] : null,
      usageDate: isDate(co['usageDate']) ? co['usageDate'] : today, usageCount: Math.round(num(co['usageCount'], 0, 0, 10_000)),
    },
    stravaSeen: words(r['stravaSeen'], 200, 40),
    strava: { connected: st['connected'] === true, lastSyncAt: typeof st['lastSyncAt'] === 'string' ? st['lastSyncAt'] : null },
    intervals: {
      connected: iv['connected'] === true && typeof iv['keyEnc'] === 'string',
      keyEnc: typeof iv['keyEnc'] === 'string' ? iv['keyEnc'].slice(0, 400) : null,
      athlete: text(iv['athlete'], 60),
      lastSyncAt: typeof iv['lastSyncAt'] === 'string' ? iv['lastSyncAt'] : null,
      lastError: typeof iv['lastError'] === 'string' ? iv['lastError'].slice(0, 200) : null,
    },
  };
}
