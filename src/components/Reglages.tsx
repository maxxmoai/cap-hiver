'use client';
import { useState, type FormEvent } from 'react';
import { DAY_LONG } from '../engine/dates.ts';
import type { Settings } from '../engine/types.ts';
import { intervalsConnect, intervalsDisconnect, searchPlaces, stravaDisconnect } from './api.ts';
import { useApp } from './store.tsx';
import { Field } from './ui.tsx';

const list = (v: FormDataEntryValue | null): string[] => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (v: FormDataEntryValue | null): number | null => { const n = Number(String(v ?? '').replace(',', '.')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };

export function Reglages() {
  const { data, act, sync, user, integrations, logout, setData, toast } = useApp();
  const s = data.settings;
  const [city, setCity] = useState(s.city);
  const [places, setPlaces] = useState<Awaited<ReturnType<typeof searchPlaces>>['places']>([]);
  const [url, setUrl] = useState(data.calendar.url ?? '');
  const [icuKey, setIcuKey] = useState('');
  const [icuId, setIcuId] = useState(data.intervals.athleteId !== '0' ? data.intervals.athleteId : '');

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch: Partial<Settings> = {
      perWeek: num(f.get('perWeek')) ?? s.perWeek, strength: num(f.get('strength')) ?? s.strength, rest: num(f.get('rest')) ?? s.rest,
      busy: f.getAll('busy').map(Number), skiStart: String(f.get('skiStart') ?? s.skiStart), roller: f.get('roller') === 'on',
      baseH: num(f.get('baseH')) ?? s.baseH, maxH: num(f.get('maxH')) ?? s.maxH, pace: String(f.get('pace') ?? s.pace),
      friends: list(f.get('friends')), denseClassMin: Math.round((num(f.get('dense')) ?? 7) * 60), examTaper: (num(f.get('taper')) ?? 20) / 100,
      examKeywords: list(f.get('examKw')), ignoreKeywords: list(f.get('ignoreKw')), ftp: num(f.get('ftp')), lthr: num(f.get('lthr')),
    };
    void act({ type: 'saveSettings', settings: patch }, 'Réglages enregistrés.');
  };

  const find = async () => {
    try { setPlaces((await searchPlaces(city)).places); } catch (e) { toast(e instanceof Error ? e.message : 'Recherche impossible.'); }
  };

  return (
    <>
      <div><div className="eyebrow">{user.email}</div><h1>Réglages</h1></div>

      <h2 className="sec">Emploi du temps</h2>
      <section className="card">
        <p className="small mute">Colle le lien d’export iCalendar de ton emploi du temps (ADE, Google Agenda, Outlook). Les jours de 7 h de cours ou plus n’ont que du décrassage, et les semaines de partiels sont allégées.</p>
        <Field label="Lien .ics (https://…)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/anonymous_cal.jsp?…&calType=ical" inputMode="url" autoCapitalize="off" spellCheck={false} /></Field>
        <div className="acts">
          <button className="btn pri" onClick={() => void act({ type: 'saveCalendarUrl', url: url.trim() || null }, url.trim() ? 'Calendrier synchronisé.' : 'Calendrier retiré.')}>{url.trim() ? 'Enregistrer et synchroniser' : 'Retirer'}</button>
          {data.calendar.url && <button className="btn" onClick={() => void sync()}>Resynchroniser</button>}
        </div>
        {data.calendar.lastError && <p className="err" role="alert">{data.calendar.lastError}</p>}
        {data.calendar.lastSyncAt && !data.calendar.lastError && <p className="small mute">Dernière synchro : {new Date(data.calendar.lastSyncAt).toLocaleString('fr-FR')} · jusqu’au {data.calendar.coveredTo}</p>}
      </section>

      <h2 className="sec">Météo</h2>
      <section className="card">
        <p className="small mute">Pluie forte, orage, verglas ou neige annoncés : tu reçois une proposition pour remplacer la séance (home-trainer, renfo, ski, décrassage).</p>
        <form className="inl" onSubmit={(e) => { e.preventDefault(); void find(); }}>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville" aria-label="Ville" /><button className="btn">Chercher</button>
        </form>
        {s.lat !== null && <p className="small mute">Position actuelle : {s.city || 'enregistrée'}</p>}
        {places.map((p) => (
          <button key={`${p.lat},${p.lon}`} className="btn" onClick={() => { void act({ type: 'saveSettings', settings: { city: p.name, lat: p.lat, lon: p.lon, timezone: p.tz } }, 'Lieu enregistré.'); setPlaces([]); setCity(p.name); }}>
            {p.name}{p.region ? `, ${p.region}` : ''} ({p.country})
          </button>
        ))}
      </section>

      <h2 className="sec">Entraînement</h2>
      <form className="card" onSubmit={save} key={JSON.stringify(s)}>
        <div className="two">
          <Field label="Séances / semaine"><select name="perWeek" defaultValue={s.perWeek}>{[3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Field label="Muscu max / semaine"><select name="strength" defaultValue={s.strength}><option value={0}>0</option><option value={1}>1</option></select></Field>
        </div>
        <Field label="Jour de repos"><select name="rest" defaultValue={s.rest}>{DAY_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
        <fieldset className="f" style={{ border: 0, padding: 0, margin: 0 }}><legend className="eyebrow">Jours de cours chargés (sans calendrier)</legend>
          <div className="chips">{DAY_LONG.map((d, i) => <label key={d} className="chip"><input type="checkbox" name="busy" value={i} defaultChecked={s.busy.includes(i)} />{d.slice(0, 3)}</label>)}</div></fieldset>
        <div className="two">
          <Field label="Journée dense (h de cours)"><input name="dense" type="number" step="0.5" min="3" max="12" defaultValue={s.denseClassMin / 60} /></Field>
          <Field label="Baisse en partiels (%)"><input name="taper" type="number" min="0" max="50" defaultValue={Math.round(s.examTaper * 100)} /></Field>
        </div>
        <Field label="Mots-clés d’examen (virgules)"><input name="examKw" defaultValue={s.examKeywords.join(', ')} /></Field>
        <Field label="Cours à ignorer (virgules)"><input name="ignoreKw" defaultValue={s.ignoreKeywords.join(', ')} placeholder="ex. : sport, UE libre" /></Field>
        <div className="two">
          <Field label="Volume de base (h/sem)"><input name="baseH" type="number" step="0.5" min="2" max="20" defaultValue={s.baseH} /></Field>
          <Field label="Volume max (h/sem)"><input name="maxH" type="number" step="0.5" min="3" max="25" defaultValue={s.maxH} /></Field>
        </div>
        <div className="two">
          <Field label="Allure d’endurance (min/km)"><input name="pace" defaultValue={s.pace} placeholder="5:45" /></Field>
          <Field label="Premiers skis"><input name="skiStart" type="date" defaultValue={s.skiStart} /></Field>
        </div>
        <label className="chk"><input type="checkbox" name="roller" defaultChecked={s.roller} /><span>Ski-roues avant la neige</span></label>
        <Field label="Partenaires d’entraînement (virgules)"><input name="friends" defaultValue={s.friends.join(', ')} /></Field>
        <div className="two">
          <Field label="FTP vélo (W)"><input name="ftp" type="number" min="80" max="600" defaultValue={s.ftp ?? ''} /></Field>
          <Field label="FC seuil (bpm)"><input name="lthr" type="number" min="120" max="220" defaultValue={s.lthr ?? ''} /></Field>
        </div>
        <p className="small mute">FTP et FC seuil rendent la charge importée plus précise ; sans eux, elle est estimée à partir de la durée et de l’effort.</p>
        <button className="btn pri block">Enregistrer</button>
      </form>

      <h2 className="sec">intervals.icu</h2>
      <section className="card">
        {!integrations.intervals ? <p className="small mute">Non configuré sur ce serveur (TOKEN_ENCRYPTION_KEY manquante).</p> : data.intervals.connected ? (
          <>
            <p>Connecté{data.intervals.athlete ? ` : ${data.intervals.athlete}` : ''}. Tes sorties (Garmin, Strava ou fichiers déposés sur intervals.icu) sont importées chaque jour et à l’ouverture de l’appli, puis comparées au plan.</p>
            {data.intervals.lastError && <p className="err" role="alert">{data.intervals.lastError}</p>}
            {data.intervals.lastSyncAt && <p className="small mute">Dernière synchro : {new Date(data.intervals.lastSyncAt).toLocaleString('fr-FR')}</p>}
            <div className="acts">
              <button className="btn" onClick={() => void sync()}>Synchroniser maintenant</button>
              <button className="btn danger" onClick={() => void intervalsDisconnect().then((r) => { setData(r.data); toast('intervals.icu déconnecté.'); }).catch(() => toast('Échec.'))}>Déconnecter</button>
            </div>
          </>
        ) : (
          <>
            <p className="small mute">Sur intervals.icu : Réglages → Développeur → « Clé API ». Colle-la ici ; elle est chiffrée sur le serveur et ne revient jamais au navigateur. Si ta montre est reliée à intervals.icu, chaque sortie arrive avec sa charge d’entraînement, et les trois jours suivants sont allégés si elle était bien plus dure que prévu.</p>
            <Field label="Identifiant d’athlète (ex. i743904)"><input value={icuId} onChange={(e) => setIcuId(e.target.value)} placeholder="i743904" autoCapitalize="off" spellCheck={false} /></Field>
            <Field label="Clé API intervals.icu"><input type="password" value={icuKey} onChange={(e) => setIcuKey(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
            <button className="btn pri" disabled={!icuKey.trim()} onClick={() => void intervalsConnect(icuKey.trim(), icuId.trim()).then((r) => { setData(r.data); setIcuKey(''); toast('intervals.icu connecté.'); }).catch((e: unknown) => toast(e instanceof Error ? e.message : 'Échec.'))}>Connecter</button>
          </>
        )}
      </section>

      <h2 className="sec">Strava</h2>
      <section className="card">
        {!integrations.strava ? <p className="small mute">Strava n’est pas configuré sur ce serveur.</p> : data.strava.connected ? (
          <>
            <p>Connecté. Tes sorties (Garmin synchronisé vers Strava comprises) arrivent toutes seules et valident le plan.</p>
            <button className="btn danger" onClick={() => void stravaDisconnect().then((r) => { setData(r.data); toast('Strava déconnecté.'); }).catch(() => toast('Échec.'))}>Déconnecter</button>
          </>
        ) : (
          <>
            <p className="small mute">Chaque sortie est importée, comparée à la séance prévue, et les trois jours suivants sont recalculés si elle était bien plus dure.</p>
            <a className="btn pri" href="/api/strava/connect">Connecter Strava</a>
          </>
        )}
      </section>

      <div className="acts"><button className="btn" onClick={() => void act({ type: 'regenerate' }, 'Plan recalculé.')}>Recalculer le plan</button><button className="btn danger" onClick={() => void logout()}>Se déconnecter</button></div>
    </>
  );
}
