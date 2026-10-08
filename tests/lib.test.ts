import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { askCoach, buildCoachContext, COACH_TOOL, parseCoachReply, applyCoachChange } from '../src/lib/coach.ts';
import { pickProvider } from '../src/server/env.ts';
import { decrypt, encrypt, hashPassword, signSession, signState, verifyPassword, verifySession, verifyState } from '../src/lib/crypto.ts';
import { busyFromEvents, fetchIcs, parseIcs, safeIcsUrl, zonedToInstant } from '../src/lib/ics.ts';
import { forecastUrl, parseForecast, parseGeocode } from '../src/lib/openmeteo.ts';
import { authorizeUrl, ingestActivity, mapSport, needsRefresh, parseActivity, parseTokens, parseWebhookEvent, removeActivity, verifyChallenge } from '../src/lib/strava.ts';
import { counter, planned, settings } from './helpers.ts';

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ADE//FR',
  // Jeudi 8 octobre 2026 : 8 h de cours (heure d'été, UTC+2)
  'BEGIN:VEVENT', 'UID:a1', 'DTSTART:20261008T060000Z', 'DTEND:20261008T080000Z', 'SUMMARY:R1.05 PPP', 'LOCATION:Amphi A', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a2', 'DTSTART:20261008T081500Z', 'DTEND:20261008T101500Z', 'SUMMARY:R1.01 Maths', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a3', 'DTSTART:20261008T113000Z', 'DTEND:20261008T133000Z', 'SUMMARY:TP Electricité', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a4', 'DTSTART:20261008T134500Z', 'DTEND:20261008T154500Z', 'SUMMARY:TD Anglais', 'END:VEVENT',
  // Lundi 12 : partiel, avec ligne pliée et caractères échappés
  'BEGIN:VEVENT', 'UID:b1', 'DTSTART;TZID=Europe/Paris:20261012T080000', 'DTEND;TZID=Europe/Paris:20261012T100000',
  'SUMMARY:DS Mathématiques\\, ', ' groupe 1', 'END:VEVENT',
  // Mardi 13 : soutien (pas un examen) et événement journée entière
  'BEGIN:VEVENT', 'UID:c1', 'DTSTART:20261013T100000Z', 'DTEND:20261013T110000Z', 'SUMMARY:Soutien Etudiant', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c2', 'DTSTART;VALUE=DATE:20261014', 'DTEND;VALUE=DATE:20261015', 'SUMMARY:Semaine des partiels', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('lecture ICS', () => {
  it('lit les événements, les lignes pliées et les fuseaux', () => {
    const ev = parseIcs(ICS);
    assert.equal(ev.length, 7);
    const ds = ev.find((e) => e.uid === 'b1')!;
    assert.equal(ds.summary, 'DS Mathématiques, groupe 1');
    assert.equal(ds.start.toISOString(), '2026-10-12T06:00:00.000Z');
    assert.equal(ev.find((e) => e.uid === 'c2')!.allDay, true);
  });
  it('convertit heure locale et heure UTC en gérant le changement d\'heure', () => {
    assert.equal(zonedToInstant('2026-10-24', 8 * 60, 'Europe/Paris').toISOString(), '2026-10-24T06:00:00.000Z');
    assert.equal(zonedToInstant('2026-10-26', 8 * 60, 'Europe/Paris').toISOString(), '2026-10-26T07:00:00.000Z');
  });
  it('calcule les 8 h de cours d\'une journée et repère les partiels', () => {
    const busy = busyFromEvents(parseIcs(ICS), { tz: 'Europe/Paris', from: '2026-10-05', to: '2026-10-18', examKeywords: ['partiel', 'ds'], ignoreKeywords: [] });
    assert.equal(busy['2026-10-08']!.classMin, 480);
    assert.equal(busy['2026-10-08']!.firstStart, 8 * 60);
    assert.equal(busy['2026-10-08']!.lastEnd, 17 * 60 + 45);
    assert.equal(busy['2026-10-12']!.exam, true);
    assert.equal(busy['2026-10-13']!.exam, false, 'soutien n\'est pas un examen');
    assert.equal(busy['2026-10-14']!.exam, true, 'événement « partiels » sur la journée entière');
    assert.equal(busy['2026-10-09']!.classMin, 0);
    assert.equal(Object.keys(busy).length, 14);
  });
  it('ne confond pas « ds » avec un mot qui le contient et respecte les mots à ignorer', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261008T060000Z', 'DTEND:20261008T080000Z', 'SUMMARY:Ateliers dsl', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261009T060000Z', 'DTEND:20261009T080000Z', 'SUMMARY:Examen blanc', 'END:VEVENT', 'END:VCALENDAR'].join('\n');
    const busy = busyFromEvents(parseIcs(ics), { tz: 'Europe/Paris', from: '2026-10-08', to: '2026-10-09', examKeywords: ['ds', 'examen'], ignoreKeywords: ['blanc'] });
    assert.equal(busy['2026-10-08']!.exam, false);
    assert.equal(busy['2026-10-09']!.exam, false);
    assert.equal(busy['2026-10-09']!.classMin, 0);
  });
  it('fusionne les cours qui se chevauchent', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261008T060000Z', 'DTEND:20261008T080000Z', 'SUMMARY:A', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261008T070000Z', 'DTEND:20261008T090000Z', 'SUMMARY:B', 'END:VEVENT', 'END:VCALENDAR'].join('\n');
    const busy = busyFromEvents(parseIcs(ics), { tz: 'Europe/Paris', from: '2026-10-08', to: '2026-10-08', examKeywords: [], ignoreKeywords: [] });
    assert.equal(busy['2026-10-08']!.classMin, 180);
  });
});

describe('récupération sécurisée du calendrier', () => {
  it('accepte https et webcal, refuse le reste', () => {
    assert.equal(safeIcsUrl('webcal://ade.example.fr/cal.ics')?.protocol, 'https:');
    for (const bad of ['http://ade.example.fr/x.ics', 'https://localhost/x', 'https://10.0.0.5/x', 'https://192.168.1.2/x', 'https://169.254.169.254/latest', 'https://user:pw@ade.example.fr/x', 'https://ade.example.fr:8443/x', 'https://intranet/x', 'https://[::1]/x', 'ftp://x.fr/a', 'pas une url']) {
      assert.equal(safeIcsUrl(bad), null, bad);
    }
  });
  it('lit un calendrier valide et refuse un contenu inattendu ou une redirection vers un réseau privé', async () => {
    const ok = (async () => new Response(ICS, { status: 200 })) as typeof fetch;
    assert.match(await fetchIcs('https://ade.example.fr/cal', ok), /BEGIN:VCALENDAR/);
    const html = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
    await assert.rejects(fetchIcs('https://ade.example.fr/cal', html), /iCalendar/);
    const redirect = (async () => new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/internal' } })) as typeof fetch;
    await assert.rejects(fetchIcs('https://ade.example.fr/cal', redirect), /Redirection/);
    const err = (async () => new Response('', { status: 500 })) as typeof fetch;
    await assert.rejects(fetchIcs('https://ade.example.fr/cal', err), /500/);
    await assert.rejects(fetchIcs('http://ade.example.fr/cal', ok), /invalide/);
  });
});

describe('météo Open-Meteo', () => {
  it('construit l\'URL et lit la réponse journalière', () => {
    const u = new URL(forecastUrl(45.19, 5.72, 'Europe/Paris', 7));
    assert.equal(u.hostname, 'api.open-meteo.com');
    assert.match(u.searchParams.get('daily')!, /snowfall_sum/);
    const w = parseForecast({ daily: { time: ['2026-10-07', '2026-10-08'], precipitation_sum: [0.2, 14], snowfall_sum: [0, 0], wind_gusts_10m_max: [20, 65], temperature_2m_min: [5, 6], temperature_2m_max: [14, 11], weather_code: [1, 63] } });
    assert.equal(w['2026-10-08']!.precipMm, 14);
    assert.equal(w['2026-10-08']!.gustKmh, 65);
    assert.deepEqual(parseForecast(null), {});
    assert.deepEqual(parseForecast({ daily: { time: ['pas-une-date'] } }), {});
  });
  it('lit les résultats de géocodage', () => {
    const p = parseGeocode({ results: [{ name: 'Grenoble', admin1: 'Auvergne-Rhône-Alpes', country: 'France', latitude: 45.18, longitude: 5.72, timezone: 'Europe/Paris' }, { name: 'incomplet' }] });
    assert.equal(p.length, 1);
    assert.equal(p[0]!.name, 'Grenoble');
  });
});

describe('Strava', () => {
  const act = (over: Record<string, unknown> = {}): unknown => ({ id: 111, name: 'Sortie', sport_type: 'TrailRun', start_date_local: '2026-10-08T18:00:00Z', moving_time: 4200, distance: 9800, average_heartrate: 165, ...over });
  const ath = { ftp: null, lthr: 170 };

  it('valide les activités et convertit les sports', () => {
    assert.ok(parseActivity(act()));
    assert.equal(parseActivity({ id: 1 }), null);
    assert.equal(parseActivity(act({ moving_time: 10 })), null);
    assert.equal(mapSport('TrailRun'), 'trail');
    assert.equal(mapSport('GravelRide'), 'bike');
    assert.equal(mapSport('RollerSki'), 'roller');
    assert.equal(mapSport('Yoga'), 'other');
  });
  it('valide la séance prévue le même jour et calcule la charge réelle', () => {
    const plan = [planned('p1', '2026-10-08', { sport: 'trail', dur: 60, rpe: 6 }), planned('p2', '2026-10-09', { dur: 45 })];
    const r = ingestActivity(plan, parseActivity(act())!, ath, counter('n'));
    assert.equal(r.created, false);
    assert.equal(r.session.id, 'p1');
    assert.equal(r.session.status, 'done');
    assert.equal(r.method, 'heartrate');
    assert.ok(r.plannedTss !== null && r.plannedTss > 50 && r.plannedTss < 65, String(r.plannedTss));
    assert.ok(r.actualTss > 100 && r.actualTss < 120, String(r.actualTss));
    assert.equal(r.session.done?.stravaId, '111');
  });
  it('est idempotent : rejouer le webhook ne crée pas de doublon', () => {
    const plan = [planned('p1', '2026-10-08', { sport: 'trail', dur: 60, rpe: 6 })];
    const a = ingestActivity(plan, parseActivity(act())!, ath, counter('n'));
    const b = ingestActivity(a.sessions, parseActivity(act())!, ath, counter('m'));
    assert.equal(b.sessions.length, 1);
    assert.equal(b.plannedTss, null);
  });
  it('crée une séance quand rien n\'était prévu, et la retire à la suppression', () => {
    const r = ingestActivity([], parseActivity(act({ sport_type: 'Ride', moving_time: 7200, average_heartrate: undefined }))!, ath, counter('n'));
    assert.equal(r.created, true);
    assert.equal(r.session.kind, 'long');
    assert.equal(r.method, 'rpe');
    assert.equal(removeActivity(r.sessions, '111').length, 0);
  });
  it('remet une séance prévue à faire quand l\'activité est supprimée', () => {
    const a = ingestActivity([planned('p1', '2026-10-08', { sport: 'trail' })], parseActivity(act())!, ath, counter('n'));
    const back = removeActivity(a.sessions, '111');
    assert.equal(back[0]!.status, 'planned');
    assert.equal(back[0]!.done, undefined);
  });
  it('n\'associe pas une activité d\'endurance à une séance de muscu', () => {
    const r = ingestActivity([planned('s', '2026-10-08', { sport: 'strength', kind: 'strength', dur: 60 })], parseActivity(act())!, ath, counter('n'));
    assert.equal(r.created, true);
  });
  it('gère OAuth et webhook', () => {
    const u = new URL(authorizeUrl({ clientId: '1', redirectUri: 'https://x.app/api/strava/callback', state: 'abc' }));
    assert.equal(u.searchParams.get('scope'), 'read,activity:read_all');
    assert.deepEqual(verifyChallenge({ mode: 'subscribe', token: 't', challenge: 'c' }, 't'), { 'hub.challenge': 'c' });
    assert.equal(verifyChallenge({ mode: 'subscribe', token: 'x', challenge: 'c' }, 't'), null);
    assert.equal(verifyChallenge({ mode: 'subscribe', token: '', challenge: 'c' }, ''), null);
    assert.equal(parseWebhookEvent({ object_type: 'activity', aspect_type: 'create', object_id: 5, owner_id: 9 })?.objectId, 5);
    assert.equal(parseWebhookEvent({ object_type: 'bidon' }), null);
    assert.equal(parseTokens({ access_token: 'a', refresh_token: 'r', expires_at: 10, athlete: { id: 7 } })?.athleteId, 7);
    assert.equal(parseTokens({}), null);
    assert.equal(needsRefresh(1000, 1_000_000 - 60_000), true);
    assert.equal(needsRefresh(2000, 1_000_000), false);
  });
});

describe('sécurité', () => {
  it('hache et vérifie les mots de passe', () => {
    const h = hashPassword('correct horse battery');
    assert.ok(verifyPassword('correct horse battery', h));
    assert.ok(!verifyPassword('autre', h));
    assert.ok(!verifyPassword('x', 'format-inconnu'));
    assert.notEqual(h, hashPassword('correct horse battery'));
  });
  it('chiffre les jetons et détecte toute altération', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const c = encrypt('secret-token', key);
    assert.equal(decrypt(c, key), 'secret-token');
    const parts = c.split('.');
    parts[3] = parts[3]!.slice(0, -2) + 'AA';
    assert.throws(() => decrypt(parts.join('.'), key));
    assert.throws(() => encrypt('x', Buffer.alloc(8).toString('base64')), /trop courte/);
  });
  it('signe les sessions et refuse les jetons expirés ou falsifiés', () => {
    const t = signSession('user1', 'secret', 60, 1_000_000);
    assert.equal(verifySession(t, 'secret', 1_030_000)?.sub, 'user1');
    assert.equal(verifySession(t, 'secret', 1_000_000 + 61_000), null);
    assert.equal(verifySession(t, 'autre', 1_030_000), null);
    assert.equal(verifySession(t.replace(/.$/, 'x'), 'secret', 1_030_000), null);
    assert.equal(verifySession(undefined, 'secret'), null);
    const st = signState('u9', 'secret', 5_000_000);
    assert.equal(verifyState(st, 'secret', 5_100_000), 'u9');
    assert.equal(verifyState(signSession('u9', 'secret', 600, 5_000_000), 'secret', 5_100_000), null, 'un jeton de session ne vaut pas état OAuth');
  });
});

describe('coach', () => {
  const sessions = [planned('a', '2026-10-08'), planned('ev', '2026-10-09', { src: 'event', eventId: 'e' })];
  it('écarte tout ce qui est hors cadre', () => {
    const r = parseCoachReply({
      message: 'Bonne semaine',
      changes: [
        { action: 'update', id: 'a', dur: 9999, title: 'Plus doux' },
        { action: 'update', id: 'ev', dur: 30 },
        { action: 'update', id: 'inconnu' },
        { action: 'remove', id: 'a', date: '1999-01-01' },
        { action: 'add', date: '2026-10-10', sport: 'ski', kind: 'easy', dur: 50 },
        { action: 'add', date: '2026-10-10', sport: 'ski', kind: 'race' },
        { action: 'add', sport: 'ski' },
        { action: 'detruire' },
        'texte',
      ],
    }, sessions, '2026-10-07');
    assert.equal(r.message, 'Bonne semaine');
    assert.equal(r.changes.length, 2);
    assert.equal(r.changes[0]!.dur, 360);
    assert.equal(r.changes[1]!.action, 'add');
  });
  it('applique une modification et un ajout', () => {
    const upd = applyCoachChange(sessions, { action: 'update', id: 'a', kind: 'recovery', dur: 30, reason: 'Fatigue' }, counter('n'));
    assert.equal(upd.find((s) => s.id === 'a')?.src, 'ia');
    assert.equal(upd.find((s) => s.id === 'a')?.rpe, 2);
    const add = applyCoachChange(sessions, { action: 'add', date: '2026-10-10', sport: 'ski', kind: 'easy' }, counter('n'));
    assert.equal(add.length, 3);
    assert.equal(applyCoachChange(sessions, { action: 'remove', id: 'ev' }, counter('n')).length, 2, 'une séance liée à une course ne se supprime pas');
  });
  it('envoie un contexte sans donnée personnelle et lit la réponse structurée', async () => {
    const ctx = buildCoachContext({ today: '2026-10-07', settings: settings({ city: 'Lyon' }), events: [], sessions, form: { '2026-10-07': { leg: 2, nerv: 4 } }, busy: {} });
    const text = JSON.stringify(ctx);
    assert.ok(!text.includes('Lyon'));
    assert.ok(text.includes('jambes_1_a_5'));
    let sent: { tool_choice?: { name?: string }; tools?: Array<{ name: string }>; messages?: Array<{ content: string }> } = {};
    const f = (async (_u: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: COACH_TOOL.name, input: { message: 'ok', changes: [] } }] }), { status: 200 });
    }) as typeof fetch;
    const out = await askCoach(ctx, 'Analyse ma semaine', { fetch: f, apiKey: 'k', model: 'm' });
    assert.deepEqual(out, { message: 'ok', changes: [] });
    assert.equal(sent.tool_choice?.name, COACH_TOOL.name);
    assert.ok(sent.messages?.[0]?.content.includes('Analyse ma semaine'));
    const bad = (async () => new Response('{}', { status: 529 })) as typeof fetch;
    await assert.rejects(askCoach(ctx, '', { fetch: bad, apiKey: 'k', model: 'm' }), /529/);
  });

  it('Gemini : réessaie puis passe au modèle suivant quand le premier est saturé', async () => {
    const ctx = buildCoachContext({ today: '2026-10-07', settings: settings(), events: [], sessions: [], form: {}, busy: {} });
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(/models\/([^:]+):/.exec(u)![1]!);
      if (seen.length < 3) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: COACH_TOOL.name, args: { message: 'ok', changes: [] } } }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await askCoach(ctx, '', { fetch: f, apiKey: 'k', model: 'gemini-flash-latest', provider: 'gemini' });
    assert.deepEqual(out, { message: 'ok', changes: [] });
    assert.deepEqual(seen, ['gemini-flash-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest']);
    const bad = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })) as unknown as typeof fetch;
    await assert.rejects(askCoach(ctx, '', { fetch: bad, apiKey: 'k', model: 'm', provider: 'gemini' }), /400.*API key not valid/);
  });

  it('une clé de chiffrement mal collée reste utilisable', () => {
    const good = 'qC7MygqHGLwjgSVO47gDyA6Yo9K7FAZYNDBcBPDAExc=';
    assert.equal(decrypt(encrypt('secret', `  "${good}"\n`), good), 'secret');
    assert.equal(decrypt(encrypt('x', 'une phrase de passe assez longue'), 'une phrase de passe assez longue'), 'x');
    assert.throws(() => encrypt('x', 'court'), /trop courte/);
  });

  it('parle à Gemini avec la clé en en-tête et un appel de fonction imposé', async () => {
    const ctx = buildCoachContext({ today: '2026-10-07', settings: settings(), events: [], sessions: [], form: {}, busy: {} });
    let url = ''; let headers: Record<string, string> = {}; let sent: Record<string, any> = {};
    const f = (async (u: string, init?: RequestInit) => {
      url = u; headers = init?.headers as Record<string, string>; sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: COACH_TOOL.name, args: { message: 'ok', changes: [] } } }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await askCoach(ctx, 'Analyse', { fetch: f, apiKey: 'SECRET', model: 'models/gemini-flash-latest', provider: 'gemini' });
    assert.deepEqual(out, { message: 'ok', changes: [] });
    assert.match(url, /v1beta\/models\/gemini-flash-latest:generateContent$/);
    assert.ok(!url.includes('SECRET'));
    assert.equal(headers['x-goog-api-key'], 'SECRET');
    assert.equal(sent['toolConfig'].functionCallingConfig.mode, 'ANY');
    const none = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'bla' }] } }] }), { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(askCoach(ctx, '', { fetch: none, apiKey: 'k', model: 'm', provider: 'gemini' }), /surchargé ou injoignable/);
    assert.equal(pickProvider(null, true, true), 'gemini');
    assert.equal(pickProvider('anthropic', true, true), 'anthropic');
    assert.equal(pickProvider('gemini', false, true), 'anthropic');
    assert.equal(pickProvider(null, false, false), null);
  });
});
