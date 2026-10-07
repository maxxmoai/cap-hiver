import { addDays, diffDays, localParts } from '../engine/dates.ts';
import type { DayBusy } from '../engine/types.ts';

export interface IcsEvent {
  uid: string;
  summary: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

const unescapeText = (s: string): string => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Recolle les lignes pliées (RFC 5545 : une ligne qui commence par une espace ou une tabulation continue la précédente). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

/** Instant correspondant à une date et heure locales dans un fuseau, DST compris. */
export function zonedToInstant(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const lp = localParts(new Date(guess), tz);
    const [ly, lm, ld] = lp.date.split('-').map(Number) as [number, number, number];
    const shown = Date.UTC(ly, lm - 1, ld, 0, lp.minutes);
    const delta = target - shown;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

interface DtValue { instant: Date; allDay: boolean; date: string }

function parseDt(name: string, value: string, defaultTz: string): DtValue | null {
  const params = name.split(';').slice(1);
  const tzid = params.find((p) => p.toUpperCase().startsWith('TZID='))?.slice(5).replace(/^"|"$/g, '');
  const isDateOnly = params.some((p) => p.toUpperCase() === 'VALUE=DATE') || /^\d{8}$/.test(value);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (isDateOnly || m[4] === undefined) return { instant: new Date(`${date}T00:00:00Z`), allDay: true, date };
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (m[7]) return { instant: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, Number(m[6] ?? 0))), allDay: false, date };
  let tz = tzid ?? defaultTz;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = defaultTz; }
  return { instant: zonedToInstant(date, h * 60 + mi, tz), allDay: false, date };
}

/** Lit un fichier iCalendar. Les règles de répétition (RRULE) ne sont pas développées : l'export ADE n'en utilise pas. */
export function parseIcs(text: string, defaultTz = 'Europe/Paris'): IcsEvent[] {
  const lines = unfold(text);
  const out: IcsEvent[] = [];
  let cur: Record<string, { name: string; value: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        const s = cur['DTSTART'];
        const e = cur['DTEND'];
        const start = s ? parseDt(s.name, s.value, defaultTz) : null;
        if (start) {
          let end = e ? parseDt(e.name, e.value, defaultTz) : null;
          if (!end || end.instant < start.instant) end = { ...start, instant: new Date(start.instant.getTime() + (start.allDay ? 86_400_000 : 3_600_000)) };
          out.push({
            uid: cur['UID']?.value ?? `${start.instant.toISOString()}`,
            summary: unescapeText(cur['SUMMARY']?.value ?? '').trim(),
            location: unescapeText(cur['LOCATION']?.value ?? '').trim(),
            start: start.instant, end: end.instant, allDay: start.allDay,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx);
    cur[name.split(';')[0]!.toUpperCase()] = { name, value: line.slice(idx + 1) };
  }
  return out;
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hasWord = (text: string, kw: string): boolean => new RegExp(`(^|[^a-z0-9])${norm(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?([^a-z0-9]|$)`).test(norm(text));

export interface BusyOptions {
  tz: string;
  from: string;
  to: string;
  examKeywords: readonly string[];
  ignoreKeywords: readonly string[];
}

/**
 * Charge de cours par jour. Chaque jour de la plage a une entrée, y compris les jours sans cours,
 * pour que le planificateur sache que le calendrier couvre cette période.
 */
export function busyFromEvents(events: readonly IcsEvent[], o: BusyOptions): Record<string, DayBusy> {
  const days: Record<string, DayBusy> = {};
  const spans: Record<string, Array<[number, number]>> = {};
  const total = diffDays(o.to, o.from);
  if (total < 0 || total > 400) return days;
  for (let i = 0; i <= total; i++) {
    const d = addDays(o.from, i);
    days[d] = { date: d, classMin: 0, firstStart: null, lastEnd: null, exam: false };
    spans[d] = [];
  }
  for (const ev of events) {
    if (o.ignoreKeywords.some((k) => norm(ev.summary).includes(norm(k)))) continue;
    const isExam = o.examKeywords.some((k) => hasWord(ev.summary, k));
    if (ev.allDay) {
      const first = localParts(ev.start, 'UTC').date;
      const last = addDays(localParts(ev.end, 'UTC').date, -1);
      for (let d = first; d <= (last < first ? first : last); d = addDays(d, 1)) {
        const day = days[d];
        if (day && isExam) { day.exam = true; day.examLabel = ev.summary.slice(0, 60); }
      }
      continue;
    }
    const s = localParts(ev.start, o.tz);
    const e = localParts(ev.end, o.tz);
    const day = days[s.date];
    if (!day) continue;
    const endMin = e.date === s.date ? e.minutes : 24 * 60;
    if (endMin <= s.minutes) continue;
    spans[s.date]!.push([s.minutes, endMin]);
    if (isExam) { day.exam = true; day.examLabel = ev.summary.slice(0, 60); }
  }
  for (const [d, list] of Object.entries(spans)) {
    if (!list.length) continue;
    list.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [cs, ce] = list[0]!;
    for (const [s, e] of list.slice(1)) {
      if (s <= ce) ce = Math.max(ce, e);
      else { total += ce - cs; cs = s; ce = e; }
    }
    total += ce - cs;
    const day = days[d]!;
    day.classMin = total;
    day.firstStart = list[0]![0];
    day.lastEnd = Math.max(...list.map((x) => x[1]));
  }
  return days;
}

/* ---------- récupération sécurisée ---------- */

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

/** Accepte seulement une URL https publique. Les liens webcal:// sont convertis. */
export function safeIcsUrl(input: string): URL | null {
  let raw = input.trim();
  if (/^webcals?:\/\//i.test(raw)) raw = raw.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const h = u.hostname.toLowerCase();
  if (PRIVATE_HOST.test(h) || !h.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null;
  }
  if (h.startsWith('[') || h.includes(':')) return null;
  return u;
}

export async function fetchIcs(url: string, fetchImpl: typeof fetch, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const first = safeIcsUrl(url);
  if (!first) throw new Error('Lien du calendrier invalide : il doit commencer par https:// et pointer vers un site public.');
  let current: URL = first;
  for (let hop = 0; hop < 4; hop++) {
    const res: Response = await fetchImpl(current.toString(), { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), headers: { accept: 'text/calendar, text/plain, */*' } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      const next: URL | null = loc ? safeIcsUrl(new URL(loc, current).toString()) : null;
      if (!next) throw new Error('Redirection du calendrier refusée.');
      current = next;
      continue;
    }
    if (!res.ok) throw new Error(`Le calendrier a répondu ${res.status}.`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new Error('Le calendrier est trop volumineux.');
    const text = await res.text();
    if (text.length > maxBytes) throw new Error('Le calendrier est trop volumineux.');
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Ce lien ne renvoie pas un fichier iCalendar.');
    return text;
  }
  throw new Error('Trop de redirections.');
}
