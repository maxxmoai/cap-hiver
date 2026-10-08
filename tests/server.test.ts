import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseAction } from '../src/server/actions.ts';
import { MemoryStore } from '../src/server/memory-store.ts';
import { mutate } from '../src/server/mutate.ts';
import { sanitizeUserData } from '../src/server/sanitize.ts';
import { syncIntervals, applyStravaActivity, applyUserAction, emptyUserData, refreshAlerts, syncCalendar, withDateRange, type Deps } from '../src/server/service.ts';
import type { UserData } from '../src/server/types.ts';
import { parseActivity } from '../src/lib/strava.ts';
import { parseIntervalsActivity, validAthlete, validKey } from '../src/lib/intervals.ts';
import { counter } from './helpers.ts';

const NOW = new Date('2026-10-07T09:00:00Z');
const mkDeps = (fetchImpl?: typeof fetch): Deps => ({ newId: counter('t'), now: () => NOW, fetch: fetchImpl ?? ((async () => { throw new Error('réseau interdit'); }) as unknown as typeof fetch) });
const sessionsOf = (d: UserData) => d.sessions.filter((s) => s.status === 'planned');

describe('parseAction', () => {
  it('refuse les actions inconnues ou mal formées', () => {
    assert.equal(parseAction(null).ok, false);
    assert.equal(parseAction({ type: 'drop' }).ok, false);
    assert.equal(parseAction({ type: 'moveSession', id: 'a', date: '2026-02-31' }).ok, false);
    assert.equal(parseAction({ type: 'saveSession', date: '2026-10-10', sport: 'run', kind: 'race', dur: 30 }).ok, false);
    assert.equal(parseAction({ type: 'setForm', axis: 'mood', value: 3 }).ok, false);
  });
  it('borne les valeurs', () => {
    const r = parseAction({ type: 'setForm', axis: 'leg', value: 99 });
    assert.ok(r.ok && r.action.type === 'setForm' && r.action.value === 5);
  });
});

describe('sanitizeUserData', () => {
  it('survit à des données absurdes', () => {
    const d = sanitizeUserData({ sessions: 'x', events: [null, 3], settings: { perWeek: 99, lat: 'abc' }, form: { '2026-10-07': 4 } }, counter('s'), '2026-10-07');
    assert.ok(Array.isArray(d.sessions));
    assert.ok(d.settings.perWeek <= 7);
    assert.equal(d.settings.lat, null);
  });
});

describe('applyUserAction', () => {
  it('crée un plan de départ avec des séances à venir', () => {
    const d = emptyUserData(mkDeps());
    assert.ok(sessionsOf(d).length >= 3);
  });

  it('une séance déplacée reste là où on l’a mise après régénération', () => {
    const deps = mkDeps();
    let d = emptyUserData(deps);
    const s = sessionsOf(d).find((x) => x.date > '2026-10-09')!;
    d = applyUserAction(d, { type: 'moveSession', id: s.id, date: '2026-10-20' }, deps);
    d = applyUserAction(d, { type: 'regenerate' }, deps);
    assert.equal(d.sessions.find((x) => x.id === s.id)?.date, '2026-10-20');
  });

  it('une sortie avec un ami l’ajoute à la liste des amis', () => {
    const deps = mkDeps();
    const d = applyUserAction(emptyUserData(deps), { type: 'saveSession', date: '2026-10-11', sport: 'run', kind: 'easy', dur: 60, with: ['Zoé'] }, deps);
    assert.ok(d.settings.friends.includes('Zoé'));
    assert.ok(d.sessions.some((s) => s.src === 'social' && s.date === '2026-10-11'));
  });

  it('une course crée sa checklist et sa séance', () => {
    const deps = mkDeps();
    const d = applyUserAction(emptyUserData(deps), { type: 'saveEvent', kind: 'race', name: 'Trail du lac', date: '2026-11-08', sport: 'trail', dist: 25, dplus: 1200, dur: 0, prio: 'A', notes: '', with: [] }, deps);
    const ev = d.events[0]!;
    assert.ok(ev.prep.length > 5);
    assert.ok(d.sessions.some((s) => s.eventId === ev.id && s.date === '2026-11-08'));
    const t = applyUserAction(d, { type: 'togglePrep', eventId: ev.id, prepId: ev.prep[0]!.id, done: true }, deps);
    assert.equal(t.events[0]!.prep[0]!.done, true);
  });

  it('applyCoach ignore les changements sur une séance inexistante', () => {
    const deps = mkDeps();
    const d = emptyUserData(deps);
    const out = applyUserAction(d, { type: 'applyCoach', changes: [{ action: 'remove', id: 'nope', reason: 'x' }] }, deps);
    assert.deepEqual(out.sessions, d.sessions);
  });
});

describe('calendrier', () => {
  it('réécrit la fenêtre ADE', () => {
    const u = withDateRange('https://ade.exemple.fr/jsp/anonymous_cal.jsp?resources=1&firstDate=2026-10-05&lastDate=2026-10-10', '2026-09-30', '2027-03-01');
    assert.match(u, /firstDate=2026-09-30/);
    assert.match(u, /lastDate=2027-03-01/);
  });

  it('une journée de 8 h de cours bloque les séances dures', async () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'DTSTART:20261008T060000Z', 'DTEND:20261008T100000Z', 'SUMMARY:Cours', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:2', 'DTSTART:20261008T110000Z', 'DTEND:20261008T150000Z', 'SUMMARY:TP', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    let asked = '';
    const f = (async (u: string) => { asked = String(u); return new Response(ics, { status: 200 }); }) as unknown as typeof fetch;
    const deps = mkDeps(f);
    let d = emptyUserData(deps);
    d = applyUserAction(d, { type: 'saveCalendarUrl', url: 'https://ade.exemple.fr/cal.jsp?firstDate=2026-10-05&lastDate=2026-10-10' }, deps);
    d = await syncCalendar(d, deps);
    assert.equal(d.calendar.lastError, null);
    assert.match(asked, /firstDate=2026-09-30/);
    assert.equal(d.busy['2026-10-08']?.classMin, 480);
    assert.ok(!sessionsOf(d).some((s) => s.date === '2026-10-08' && ['vma', 'threshold', 'long'].includes(s.kind)));
  });

  it('une erreur réseau est notée sans casser les données', async () => {
    const deps = mkDeps();
    let d = emptyUserData(deps);
    d = applyUserAction(d, { type: 'saveCalendarUrl', url: 'https://ade.exemple.fr/cal.ics' }, deps);
    const out = await syncCalendar(d, deps);
    assert.ok(out.calendar.lastError);
    assert.equal(out.sessions.length, d.sessions.length);
  });
});

describe('alertes', () => {
  it('sans position, aucune requête météo', async () => {
    const out = await refreshAlerts(emptyUserData(mkDeps()), mkDeps());
    assert.equal(out.weather.error, null);
  });
});

describe('Strava', () => {
  it('60 → 130 de charge allège les 3 jours suivants, une seule fois', () => {
    const deps = mkDeps();
    let d = emptyUserData(deps);
    d = applyUserAction(d, { type: 'saveSession', date: '2026-10-08', sport: 'run', kind: 'easy', dur: 60, with: ['Léo'] }, deps);
    const act = parseActivity({ id: 9, name: 'Sortie', sport_type: 'Run', start_date_local: '2026-10-08T18:00:00Z', moving_time: 9000, distance: 22000, average_heartrate: 170 })!;
    const next = (x: UserData) => sessionsOf(x).find((q) => q.date === '2026-10-09')!;
    const before = next(d);
    const a = applyStravaActivity(d, act, deps);
    assert.match(a.summary, /allégés/);
    assert.ok(next(a.data).dur < before.dur, 'le lendemain est plus court');
    assert.ok(['easy', 'recovery', 'shake'].includes(next(a.data).kind), 'plus de séance dure le lendemain');
    assert.ok(a.data.suggestions.some((g) => g.kind === 'overload'));
    const b = applyStravaActivity(a.data, act, deps);
    assert.equal(b.data.sessions.filter((s) => s.done?.source === 'strava').length, 1);
  });
});

describe('mutate', () => {
  it('rejoue la modification en cas de conflit de version', async () => {
    const store = new MemoryStore();
    const deps = mkDeps();
    let calls = 0;
    const out = await mutate(store, 'u1', deps, async (d) => {
      calls++;
      if (calls === 1) await mutate(store, 'u1', deps, (x) => ({ ...x, form: { ...x.form, '2026-10-07': { leg: 2 } } }));
      return { ...d, stravaSeen: ['1'] };
    });
    assert.equal(calls, 2);
    assert.deepEqual(out.stravaSeen, ['1']);
    assert.equal(out.form['2026-10-07']?.leg, 2);
  });
});

describe('intervals.icu', () => {
  const raw = (over: Record<string, unknown> = {}) => ({ id: 'i555', type: 'Run', name: 'Footing', start_date_local: '2026-10-08T18:00:00', moving_time: 9000, distance: 22000, average_heartrate: 160, icu_training_load: 130, ...over });
  it('convertit une activité et préfixe l’identifiant', () => {
    const a = parseIntervalsActivity(raw())!;
    assert.equal(a.id, 'icu:i555');
    assert.equal(a.external_tss, 130);
    assert.equal(parseIntervalsActivity(raw({ moving_time: 10 })), null);
    assert.equal(parseIntervalsActivity({ id: 'i1', _note: 'limité' }), null);
    assert.ok(validKey('abcDEF1234567890') && !validKey('a b'));
  });
  it('importe, utilise la charge fournie et ne duplique pas', async () => {
    const calls: Array<{ url: string; auth: string }> = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push({ url: String(u), auth: (init?.headers as Record<string, string>)['authorization'] ?? '' });
      return new Response(JSON.stringify([raw(), { id: 'i9', _note: 'x' }]), { status: 200 });
    }) as unknown as typeof fetch;
    const deps = mkDeps(f);
    let d = emptyUserData(deps);
    d = applyUserAction(d, { type: 'saveSession', date: '2026-10-08', sport: 'run', kind: 'easy', dur: 60, with: [] }, deps);
    d = await syncIntervals(d, 'abcDEF1234567890', deps);
    assert.match(calls[0]!.url, /intervals\.icu\/api\/v1\/athlete\/0\/activities\?oldest=2026-09-23&newest=2026-10-07/);
    assert.match(calls[0]!.auth, /^Basic /);
    assert.equal(d.intervals.lastError, null);
    const done = d.sessions.filter((s) => s.done?.source === 'intervals');
    assert.equal(done.length, 1);
    assert.equal(done[0]!.done?.tss, 130);
    d = await syncIntervals(d, 'abcDEF1234567890', deps);
    assert.equal(d.sessions.filter((s) => s.done?.source === 'intervals').length, 1);
  });
  it('utilise l’identifiant d’athlète fourni', async () => {
    let url = '';
    const f = (async (u: string) => { url = String(u); return new Response('[]', { status: 200 }); }) as unknown as typeof fetch;
    const deps = mkDeps(f);
    let d = emptyUserData(deps);
    d = { ...d, intervals: { ...d.intervals, athleteId: 'i743904' } };
    await syncIntervals(d, 'abcDEF1234567890', deps);
    assert.match(url, /athlete\/i743904\/activities/);
    assert.ok(validAthlete('i743904') && validAthlete('0') && !validAthlete('../x'));
  });
  it('une clé refusée est notée sans toucher au plan', async () => {
    const deps = mkDeps((async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    const d = emptyUserData(deps);
    const out = await syncIntervals(d, 'abcDEF1234567890', deps);
    assert.match(out.intervals.lastError ?? '', /refusée/);
    assert.equal(out.sessions.length, d.sessions.length);
  });
});
