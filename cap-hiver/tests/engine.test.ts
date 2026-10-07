import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  absorbOverload, addDays, adaptDay, adaptSession, applyAction, assessWeather, denseDaySuggestions, describe as describeSession,
  dateLabel, diffDays, dow, examSuggestions, fuelMessage, fuelPlan, hm, isDate, loadStats, localParts, mergeSuggestions, racePlan,
  regenerate, todayIn, warnMove, weatherSuggestions, weekStart, weekWarnings, activityLoad, estimateTss, sessionLoad, HEAVY,
} from '../src/engine/index.ts';
import type { DayWeather, Session } from '../src/engine/index.ts';
import { busyDay, counter, done, input, planned, race, settings } from './helpers.ts';

const weekSessions = (ss: Session[], ws: string): Session[] => ss.filter((s) => s.date >= ws && s.date <= addDays(ws, 6) && s.status !== 'skipped');

describe('dates', () => {
  it('calcule jours, semaines et libellés sans décalage horaire', () => {
    assert.equal(dow('2026-10-05'), 0);
    assert.equal(weekStart('2026-10-11'), '2026-10-05');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(diffDays('2026-11-01', '2026-10-01'), 31);
    assert.equal(dateLabel('2026-10-07'), 'mer. 7 oct.');
    assert.equal(hm(135), '2h15');
    assert.equal(hm(45), '45′');
  });
  it('valide les dates', () => {
    assert.equal(isDate('2026-02-30'), false);
    assert.equal(isDate('2026-02-28'), true);
    assert.equal(isDate('demain'), false);
  });
  it('donne la date locale dans un fuseau', () => {
    const t = new Date('2026-10-06T23:30:00Z');
    assert.equal(todayIn('Europe/Paris', t), '2026-10-07');
    assert.deepEqual(localParts(t, 'Europe/Paris'), { date: '2026-10-07', minutes: 90 });
  });
});

describe('planification', () => {
  it('respecte 4 à 5 séances par semaine et au plus une muscu', () => {
    const { sessions } = regenerate(input({ events: [race('a', '2026-10-25'), race('b', '2026-11-22', { prio: 'A' })] }), counter());
    for (let ws = '2026-10-05'; ws < '2026-12-28'; ws = addDays(ws, 7)) {
      const w = weekSessions(sessions, ws);
      if (ws < '2026-10-12') assert.ok(w.length >= 3, `semaine ${ws}: ${w.length}`);
      assert.ok(w.length <= 5, `semaine ${ws}: ${w.length} séances`);
      assert.ok(w.filter((s) => s.kind === 'strength').length <= 1, `muscu semaine ${ws}`);
      assert.deepEqual(weekWarnings(ws, sessions, settings()), [], `alertes semaine ${ws}`);
    }
  });

  it('ne planifie jamais deux séances le même jour ni deux séances dures de suite', () => {
    const { sessions } = regenerate(input({ events: [race('a', '2026-10-25')] }), counter());
    const days = sessions.filter((s) => s.status === 'planned').map((s) => s.date);
    assert.equal(new Set(days).size, days.length);
    const heavy = sessions.filter((s) => HEAVY.has(s.kind) && !s.eventId).map((s) => s.date).sort();
    for (let i = 1; i < heavy.length; i++) assert.ok(diffDays(heavy[i]!, heavy[i - 1]!) !== 1, `${heavy[i - 1]} puis ${heavy[i]}`);
  });

  it('cale la course sur sa date et allège la semaine de course puis la récupération', () => {
    const r = race('a', '2026-10-25', { prio: 'A' });
    const { sessions } = regenerate(input({ events: [r] }), counter());
    const ev = sessions.find((s) => s.eventId === 'a');
    assert.ok(ev && ev.date === '2026-10-25' && ev.kind === 'race' && ev.dur > 0);
    const vol = (ws: string): number => weekSessions(sessions, ws).reduce((a, s) => a + s.dur, 0);
    assert.ok(vol('2026-10-26') < vol('2026-11-02') * 0.8, 'la semaine après la course A doit être bien plus légère');
    const shake = sessions.find((s) => s.kind === 'shake');
    assert.equal(shake?.date, '2026-10-24');
  });

  it('ne touche pas aux séances déplacées, validées ou ajoutées à la main', () => {
    const first = regenerate(input(), counter('a'));
    const moved = first.sessions.find((s) => s.status === 'planned' && s.kind === 'long');
    assert.ok(moved);
    moved.src = 'user';
    moved.date = '2026-10-18';
    const again = regenerate(input({ sessions: first.sessions, anchor: first.anchor }), counter('b'));
    assert.ok(again.sessions.some((s) => s.id === moved.id && s.date === '2026-10-18'));
    assert.ok(!again.sessions.some((s) => s.id !== moved.id && s.kind === 'long' && weekStart(s.date) === weekStart('2026-10-18')));
  });

  it('bascule sur le ski de fond après la date de neige', () => {
    const { sessions } = regenerate(input({ settings: settings({ skiStart: '2026-11-14' }) }), counter());
    const onSnow = sessions.filter((s) => s.date >= '2026-11-23' && ['long', 'interval', 'tempo', 'tech'].includes(s.kind));
    assert.ok(onSnow.length > 0);
    assert.ok(onSnow.every((s) => s.sport === 'ski'), onSnow.map((s) => `${s.date}:${s.sport}`).join(' '));
    const before = sessions.filter((s) => s.date < '2026-11-14' && s.sport === 'ski');
    assert.equal(before.length, 0);
  });
});

describe('calendrier étudiant', () => {
  it('réduit le volume de 20 % et retire la séance qualité en semaine de partiels', () => {
    const exam = { '2026-10-26': busyDay('2026-10-26', 240, { exam: true, examLabel: 'Partiel R1.01' }) };
    const base = regenerate(input({ busy: {} }), counter());
    const taper = regenerate(input({ busy: exam }), counter());
    const sumMin = (ss: Session[], ws: string): number => weekSessions(ss, ws).filter((s) => s.kind !== 'strength').reduce((a, s) => a + s.dur, 0);
    assert.ok(sumMin(taper.sessions, '2026-10-26') <= sumMin(base.sessions, '2026-10-26') * 0.9);
    const quality = weekSessions(taper.sessions, '2026-10-26').filter((s) => ['tempo', 'interval', 'hills'].includes(s.kind));
    assert.equal(quality.length, 0);
    assert.ok(weekSessions(base.sessions, '2026-10-26').some((s) => ['tempo', 'interval', 'hills'].includes(s.kind)));
  });

  it('ne place aucune séance sur une journée dense de cours', () => {
    const busy: Record<string, ReturnType<typeof busyDay>> = {};
    for (let i = 0; i < 28; i++) {
      const d = addDays('2026-10-05', i);
      busy[d] = busyDay(d, dow(d) === 1 || dow(d) === 3 ? 480 : 0);
    }
    const { sessions } = regenerate(input({ busy }), counter());
    const onDense = sessions.filter((s) => s.status === 'planned' && [1, 3].includes(dow(s.date)) && s.date <= '2026-11-01' && s.date >= '2026-10-07');
    assert.deepEqual(onDense.map((s) => `${s.date}:${s.kind}`), []);
  });

  it('prévient quand on déplace une séance dure sur une journée dense', () => {
    const busy = { '2026-10-13': busyDay('2026-10-13', 480) };
    const s = planned('x', '2026-10-11', { kind: 'interval', rpe: 8 });
    const w = warnMove(s, '2026-10-13', { today: '2026-10-07', sessions: [s], settings: settings(), events: [], busy });
    assert.ok(w.some((m) => m.startsWith('Journée dense')), w.join(' | '));
  });

  it('propose un décrassage de 30 minutes sur une journée de 8 h de cours', () => {
    const busy = { '2026-10-08': busyDay('2026-10-08', 480) };
    const s = planned('v', '2026-10-08', { kind: 'tempo', rpe: 7, dur: 60 });
    const out = denseDaySuggestions([s], { today: '2026-10-07', settings: settings(), busy, newId: counter('s'), nowIso: '2026-10-07T07:00:00Z' });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]!.options[0]!.action, { type: 'shake' });
    const applied = applyAction(s, out[0]!.options[0]!.action, 'Journée dense');
    assert.equal(applied.kind, 'shake');
    assert.equal(applied.dur, 30);
  });

  it('annonce une semaine de partiels une seule fois', () => {
    const busy = { '2026-10-12': busyDay('2026-10-12', 200, { exam: true, examLabel: 'DS maths' }), '2026-10-14': busyDay('2026-10-14', 200, { exam: true }) };
    const out = examSuggestions({ today: '2026-10-07', settings: settings(), busy, newId: counter('s'), nowIso: 'x' }, settings());
    assert.equal(out.length, 1);
    assert.match(out[0]!.body, /20 %/);
  });
});

describe('forme du jour : jambes et tête', () => {
  const ctx = { sessions: [] as Session[], settings: settings() };
  const tempo = planned('t', '2026-10-07', { kind: 'tempo', rpe: 7 });

  it('jambes lourdes et tête OK : haut du corps plutôt que repos total', () => {
    const a = adaptDay(tempo, { leg: 2, nerv: 4 }, ctx);
    assert.equal(a?.mode, 'upper');
  });
  it('tête fatiguée et jambes OK : version facile', () => {
    assert.equal(adaptDay(tempo, { leg: 4, nerv: 2 }, ctx)?.mode, 'easy');
    assert.equal(adaptDay(tempo, { leg: 4, nerv: 4, sleep: 1 }, ctx)?.mode, 'easy');
  });
  it('les deux fatigués : repos actif', () => {
    assert.equal(adaptDay(tempo, { leg: 1, nerv: 1 }, ctx)?.mode, 'rest');
  });
  it('en forme : aucun conseil, et jamais pour une course', () => {
    assert.equal(adaptDay(tempo, { leg: 4, nerv: 4 }, ctx), null);
    assert.equal(adaptDay({ ...tempo, eventId: 'e' }, { leg: 1, nerv: 1 }, ctx), null);
  });
  it('ne dépasse pas une muscu par semaine : gainage si la muscu est déjà prévue', () => {
    const strength = planned('s', '2026-10-09', { kind: 'strength', sport: 'strength' });
    const a = adaptDay(tempo, { leg: 2, nerv: 4 }, { sessions: [strength], settings: settings() });
    assert.equal(a?.mode, 'core');
  });
  it('remplace la séance dure et reporte la version originale', () => {
    const ss = [tempo];
    const r = adaptSession(ss, 't', 'upper', { today: '2026-10-07', sessions: ss, settings: settings(), events: [], busy: {}, newId: counter('n') });
    const now = r.sessions.find((s) => s.id === 't')!;
    assert.equal(now.kind, 'strength');
    assert.equal(now.upper, true);
    assert.ok(r.moved);
    assert.ok(r.sessions.some((s) => s.id !== 't' && s.kind === 'tempo' && s.date === r.moved));
    assert.ok(describeSession(now).steps.every((x) => !/squat|fentes|soulev/i.test(x)));
  });
});

describe('charge et télémétrie', () => {
  it('estime la charge à l\'échelle du TSS', () => {
    assert.equal(Math.round(estimateTss(60, 10, 'run')), 100);
    assert.equal(Math.round(estimateTss(60, 4, 'run')), 41);
    assert.ok(estimateTss(60, 6, 'strength') < estimateTss(60, 6, 'run'));
  });
  it('calcule le TSS réel par puissance, puis cardio, puis effort ressenti', () => {
    const power = activityLoad({ durSec: 3600, sport: 'bike', normPower: 200 }, { ftp: 250, lthr: null });
    assert.equal(power.method, 'power');
    assert.equal(Math.round(power.tss), 64);
    const hr = activityLoad({ durSec: 3600, sport: 'run', avgHr: 150 }, { ftp: null, lthr: 170 });
    assert.equal(hr.method, 'heartrate');
    assert.ok(hr.tss > 70 && hr.tss < 85, String(hr.tss));
    const rpe = activityLoad({ durSec: 3600, sport: 'run', rpeHint: 4 }, { ftp: null, lthr: null });
    assert.equal(rpe.method, 'rpe');
    assert.equal(Math.round(rpe.tss), 41);
    assert.equal(activityLoad({ durSec: 3600, sport: 'strength', avgHr: 120 }, { ftp: 250, lthr: 170 }).method, 'rpe');
  });
  it('privilégie le TSS mesuré sur l\'estimation', () => {
    const s = done('2026-10-06', 60, 4, { done: { dur: 60, dist: null, rpe: 4, feel: 3, legs: 3, note: '', source: 'strava', tss: 130 } });
    assert.equal(sessionLoad(s), 130);
  });
  it('reste équilibré en charge régulière et signale une montée brutale', () => {
    const steady: Session[] = [];
    for (let i = 30; i >= 1; i -= 2) steady.push(done(addDays('2026-10-07', -i), 60, 4));
    const a = loadStats(steady, {}, '2026-10-07');
    assert.ok(a.reliable);
    assert.ok(Math.abs(a.tsb) < 15, `tsb ${a.tsb}`);
    const spike = [...steady];
    for (let i = 6; i >= 0; i--) spike.push(done(addDays('2026-10-07', -i), 120, 7, { id: `sp${i}` }));
    const b = loadStats(spike, {}, '2026-10-07');
    assert.ok(b.tsb < -30, `tsb ${b.tsb}`);
    assert.ok(b.ratio !== null && b.ratio > 1.5);
  });
  it('moyenne les ressentis des 7 derniers jours', () => {
    const l = loadStats([], { '2026-10-07': { leg: 2, nerv: 4 }, '2026-10-06': { leg: 4, nerv: 4 } }, '2026-10-07');
    assert.equal(l.feelLeg, 3);
    assert.equal(l.feelNerv, 4);
  });
  it('allège les 3 jours suivants quand une séance passe de 60 à 130 de TSS', () => {
    const sessions = [
      planned('a', '2026-10-08', { kind: 'tempo', rpe: 7, dur: 60, src: 'auto' }),
      planned('b', '2026-10-09', { kind: 'strength', sport: 'strength', dur: 45, rpe: 6 }),
      planned('c', '2026-10-10', { kind: 'long', sport: 'trail', dur: 120, src: 'auto' }),
      planned('d', '2026-10-11', { kind: 'easy', dur: 60 }),
    ];
    const r = absorbOverload(sessions, '2026-10-07', 130, 60, { settings: settings(), events: [] });
    assert.equal(r.applied, true);
    const byId = (id: string): Session => r.sessions.find((s) => s.id === id)!;
    assert.equal(byId('a').kind, 'easy');
    assert.ok(byId('a').dur <= 50);
    assert.equal(byId('d').dur, 60, 'au-delà de 3 jours, rien ne change');
    assert.ok(r.changes.length >= 2);
  });
  it('ne réagit pas à un petit écart ni à une séance plus facile que prévu', () => {
    const s = [planned('a', '2026-10-08', { kind: 'tempo', rpe: 7 })];
    assert.equal(absorbOverload(s, '2026-10-07', 80, 60, { settings: settings(), events: [] }).applied, false);
    assert.equal(absorbOverload(s, '2026-10-07', 20, 60, { settings: settings(), events: [] }).applied, false);
  });
});

describe('carburant', () => {
  it('donne 60 g de glucides et 500 ml d\'eau par heure pour 3 h de vélo', () => {
    const f = fuelPlan('bike', 180);
    assert.equal(f.carbsPerH, 60);
    assert.equal(f.waterMlPerH, 500);
    assert.equal(f.totalCarbs, 180);
    assert.equal(f.totalWaterMl, 1500);
    assert.equal(f.bottles, 2);
  });
  it('augmente l\'eau par temps chaud et ne dit rien pour une séance courte', () => {
    assert.equal(fuelPlan('run', 120, 31).waterMlPerH, 750);
    assert.equal(fuelMessage('run', 60, '2026-10-08'), null);
    assert.equal(fuelMessage('strength', 120, '2026-10-08'), null);
    const m = fuelMessage('bike', 180, '2026-10-08');
    assert.match(m!.body, /60 g de glucides et 500 ml d’eau par heure/);
  });
  it('calcule un plan de course', () => {
    const p = racePlan(30, 180);
    assert.equal(p.carbsPerH, 65);
    assert.equal(p.gels, Math.ceil((65 * 3) / 25));
    assert.equal(p.thirds[0], 10);
  });
});

describe('météo', () => {
  const day = (over: Partial<DayWeather>): DayWeather => ({ date: '2026-10-07', precipMm: 0, snowCm: 0, gustKmh: 10, tMin: 5, tMax: 12, code: 1, ...over });
  const c = { today: '2026-10-07', settings: settings(), busy: {}, newId: counter('w'), nowIso: 'x' };

  it('qualifie pluie, vent, orage et neige', () => {
    assert.equal(assessWeather(day({})).bad, false);
    assert.equal(assessWeather(day({ precipMm: 14 })).bad, true);
    assert.equal(assessWeather(day({ gustKmh: 70 })).bad, true);
    assert.equal(assessWeather(day({ code: 95 })).bad, true);
    const snow = assessWeather(day({ snowCm: 20, precipMm: 18 }));
    assert.equal(snow.snow, true);
    assert.equal(snow.reasons.some((r) => r.includes('pluie')), false);
  });
  it('propose home-trainer ou muscu quand il pleut des cordes', () => {
    const trail = planned('t', '2026-10-07', { sport: 'trail', kind: 'easy', dur: 75 });
    const out = weatherSuggestions([trail], { '2026-10-07': day({ precipMm: 20 }) }, c);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.kind, 'weather');
    assert.deepEqual(out[0]!.options.map((o) => o.label), ['Home-trainer 75′', 'Muscu 40′']);
    const swapped = applyAction(trail, out[0]!.options[0]!.action, 'Météo');
    assert.equal(swapped.sport, 'bike');
    assert.equal(swapped.indoor, true);
  });
  it('propose le ski de fond quand il neige beaucoup', () => {
    const run = planned('r', '2026-10-08', { sport: 'run', kind: 'easy' });
    const out = weatherSuggestions([run], { '2026-10-08': day({ date: '2026-10-08', snowCm: 20 }) }, c);
    assert.equal(out[0]!.kind, 'snow');
    assert.equal(out[0]!.options[0]!.action.type === 'swap' && out[0]!.options[0]!.action.sport, 'ski');
  });
  it('ne fait rien pour la muscu, le ski sous la neige ou le beau temps', () => {
    const w = { '2026-10-07': day({ precipMm: 20, snowCm: 0 }), '2026-10-08': day({ date: '2026-10-08', snowCm: 20 }) };
    assert.equal(weatherSuggestions([planned('m', '2026-10-07', { sport: 'strength', kind: 'strength' })], w, c).length, 0);
    assert.equal(weatherSuggestions([planned('k', '2026-10-08', { sport: 'ski', kind: 'easy' })], w, c).length, 0);
    assert.equal(weatherSuggestions([planned('o', '2026-10-09')], {}, c).length, 0);
  });
  it('ne propose pas de changer une course, seulement de la préparer', () => {
    const r = planned('race', '2026-10-07', { sport: 'trail', kind: 'race', eventId: 'e' });
    const out = weatherSuggestions([r], { '2026-10-07': day({ precipMm: 20 }) }, c);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.options.length, 0);
  });
  it('fusionne sans doublon et conserve le statut', () => {
    const a = weatherSuggestions([planned('t', '2026-10-07', { sport: 'trail' })], { '2026-10-07': day({ precipMm: 20 }) }, c);
    a[0]!.status = 'dismissed';
    const again = weatherSuggestions([planned('t', '2026-10-07', { sport: 'trail' })], { '2026-10-07': day({ precipMm: 20 }) }, { ...c, newId: counter('z') });
    const merged = mergeSuggestions(a, again, '2026-10-07');
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.status, 'dismissed');
  });
});
