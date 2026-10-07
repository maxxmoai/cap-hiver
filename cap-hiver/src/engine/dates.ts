const MS_DAY = 86_400_000;

/** Dates calendaires « AAAA-MM-JJ », calculées en UTC pour ignorer les changements d'heure. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}
export const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number): string => fmtDate(new Date(parseDate(s).getTime() + n * MS_DAY));
export const diffDays = (a: string, b: string): number => Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / MS_DAY);
/** 0 = lundi … 6 = dimanche. */
export const dow = (s: string): number => (parseDate(s).getUTCDay() + 6) % 7;
export const weekStart = (s: string): string => addDays(s, -dow(s));

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmtDate(parseDate(s)) === s;
}

/** Date du jour dans un fuseau donné (le serveur tourne en UTC). */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Date locale et minutes depuis minuit d'un instant dans un fuseau. */
export function localParts(instant: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
export const DAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export const MONTH_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;

export function dateLabel(s: string): string {
  const d = parseDate(s);
  return `${DAY_SHORT[dow(s)]!.toLowerCase()}. ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** 135 -> « 2h15 », 45 -> « 45′ ». */
export function hm(minutes: number): string {
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, '0')}`
    : `${Math.round(minutes)}′`;
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
