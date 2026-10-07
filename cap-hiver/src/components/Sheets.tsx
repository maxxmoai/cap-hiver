'use client';
import { useState, type FormEvent } from 'react';
import { warnMove, type AdaptMode } from '../engine/adapt.ts';
import { KINDS, KIND_IDS, SPORTS, SPORT_IDS } from '../engine/constants.ts';
import { dateLabel, diffDays, hm } from '../engine/dates.ts';
import { describe, titleOf } from '../engine/describe.ts';
import { fuelMessage, fuelPlan } from '../engine/fuel.ts';
import { plannedLoad } from '../engine/adapt.ts';
import type { EventKind, Kind, Prio, Sport } from '../engine/types.ts';
import { useApp, type Sheet as SheetT } from './store.tsx';
import { Field, Scale, Sheet } from './ui.tsx';

export function Sheets({ sheet }: { sheet: SheetT }) {
  const { open } = useApp();
  const close = () => open(null);
  switch (sheet.kind) {
    case 'session': return <SessionView id={sheet.id} close={close} />;
    case 'log': return <LogForm id={sheet.id} close={close} />;
    case 'editSession': return <SessionForm id={sheet.id} date={sheet.date} close={close} />;
    case 'event': return <EventForm id={sheet.id} close={close} />;
    case 'eventView': return <EventView id={sheet.id} close={close} />;
  }
}

function SessionView({ id, close }: { id: string; close: () => void }) {
  const { data, today, act, open } = useApp();
  const s = data.sessions.find((x) => x.id === id);
  const [date, setDate] = useState(s?.date ?? today);
  if (!s) return <Sheet title="Séance" onClose={close}><p className="empty">Cette séance n’existe plus.</p></Sheet>;
  const d = describe(s);
  const planned = s.status === 'planned';
  const fixed = !!s.eventId;
  const warns = date !== s.date ? warnMove(s, date, { today, sessions: data.sessions, settings: data.settings, events: data.events, busy: data.busy }) : [];
  const fuel = s.dur >= 90 ? fuelMessage(s.sport, s.dur, s.date) : null;
  const modes: Array<[AdaptMode, string]> = [['easy', 'Version facile'], ['upper', 'Haut du corps'], ['core', 'Gainage'], ['rest', 'Repos']];
  const go = async (a: Parameters<typeof act>[0], msg: string) => { if (await act(a, msg)) close(); };
  return (
    <Sheet title={titleOf(s)} onClose={close}>
      <div className="s-tags">
        <span className="tag">{SPORTS[s.sport].name}</span><span className="tag k">{KINDS[s.kind]}</span>
        <span className="tag">{dateLabel(s.date)}{s.time ? ` · ${s.time}` : ''}</span><span className="tag mono">{hm(s.dur)} · RPE {s.rpe} · charge ~{Math.round(plannedLoad(s))}</span>
        {s.with.length > 0 && <span className="tag soc">avec {s.with.join(', ')}</span>}
      </div>
      {s.place && <p className="soc-line">Lieu : {s.place}</p>}
      {s.note && <p className="soc-line">{s.note}</p>}
      {s.done && <div className="alert good">Faite : {hm(s.done.dur)}{s.done.dist ? ` · ${s.done.dist} km` : ''} · RPE {s.done.rpe}{s.done.tss ? ` · charge ${Math.round(s.done.tss)}` : ''}{s.done.note ? ` — ${s.done.note}` : ''}</div>}
      <ol className="steps">{d.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
      {d.tips.length > 0 && <div className="tips">{d.tips.map((t, i) => <p key={i}>{t}</p>)}</div>}
      {fuel && <div className="alert"><b>Nutrition</b><p className="small">{fuel.body}</p></div>}
      {!fuel && s.dur >= 60 && SPORTS[s.sport].outdoor && <p className="small mute">Eau : environ {fuelPlan(s.sport, s.dur).totalWaterMl} ml pour la séance.</p>}
      {planned && (
        <>
          <div className="acts"><button className="btn pri" onClick={() => open({ kind: 'log', id: s.id })}>Marquer faite</button></div>
          {!fixed && (
            <>
              <Field label="Décaler au">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              {warns.map((w) => <div key={w} className="alert warn small">{w}</div>)}
              {date !== s.date && <button className="btn" onClick={() => void go({ type: 'moveSession', id: s.id, date }, `Décalée au ${dateLabel(date)}.`)}>Décaler{warns.length ? ' quand même' : ''}</button>}
              <div className="eyebrow">Adapter</div>
              <div className="acts">
                {modes.map(([m, label]) => <button key={m} className="btn sm" onClick={() => void go({ type: 'adaptSession', id: s.id, mode: m }, 'Séance adaptée.')}>{label}</button>)}
                <button className="btn sm" onClick={() => void go({ type: 'lightenSession', id: s.id }, 'Séance allégée.')}>Alléger</button>
              </div>
              <div className="acts"><button className="btn sm" onClick={() => open({ kind: 'editSession', id: s.id })}>Modifier</button></div>
            </>
          )}
          <div className="acts"><button className="btn sm danger" onClick={() => void go({ type: 'skipSession', id: s.id }, 'Séance annulée.')}>Annuler la séance</button>{!fixed && s.src !== 'auto' && <button className="btn sm danger" onClick={() => void go({ type: 'deleteSession', id: s.id }, 'Supprimée.')}>Supprimer</button>}</div>
        </>
      )}
      {!planned && <div className="acts"><button className="btn" onClick={() => void go({ type: 'reopenSession', id: s.id }, 'Remise au programme.')}>Remettre au programme</button></div>}
    </Sheet>
  );
}

function LogForm({ id, close }: { id: string; close: () => void }) {
  const { data, act } = useApp();
  const s = data.sessions.find((x) => x.id === id);
  const [rpe, setRpe] = useState(s?.rpe ?? 5);
  const [legs, setLegs] = useState(3);
  const [feel, setFeel] = useState(3);
  if (!s) return null;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const dist = String(f.get('dist') ?? '');
    if (await act({ type: 'logSession', id, dur: Number(f.get('dur')) || s.dur, dist: dist === '' ? null : Number(dist), rpe, feel, legs, note: String(f.get('note') ?? '') }, 'Séance enregistrée.')) close();
  };
  return (
    <Sheet title="Séance faite" onClose={close}>
      <p className="mute">{titleOf(s)} · {dateLabel(s.date)}</p>
      <form onSubmit={submit}>
        <div className="two"><Field label="Durée (min)"><input name="dur" type="number" min="1" max="900" defaultValue={s.dur} /></Field><Field label="Distance (km)"><input name="dist" type="number" step="0.1" min="0" /></Field></div>
        <Field label={`Effort ressenti : ${rpe} / 10`}><input type="range" min="1" max="10" value={rpe} onChange={(e) => setRpe(Number(e.target.value))} /></Field>
        <div className="f"><span>Jambes après</span><Scale name="Jambes après" value={legs} low="lourdes" high="fraîches" onChange={setLegs} /></div>
        <div className="f"><span>Énergie après</span><Scale name="Énergie après" value={feel} low="vidé" high="en forme" onChange={setFeel} /></div>
        <Field label="Note"><textarea name="note" rows={2} maxLength={300} /></Field>
        <button className="btn pri block">Enregistrer</button>
      </form>
    </Sheet>
  );
}

function SessionForm({ id, date, close }: { id?: string; date?: string; close: () => void }) {
  const { data, today, act } = useApp();
  const cur = id ? data.sessions.find((x) => x.id === id) : undefined;
  const [with_, setWith] = useState<string[]>(cur?.with ?? []);
  const [extra, setExtra] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const names = [...with_, ...extra.split(',').map((x) => x.trim()).filter(Boolean)];
    const ok = await act({
      type: 'saveSession', ...(id && { id }), date: String(f.get('date')), sport: String(f.get('sport')) as Sport, kind: String(f.get('kind')) as Kind,
      dur: Number(f.get('dur')) || 45, ...(f.get('time') && { time: String(f.get('time')) }), ...(f.get('place') && { place: String(f.get('place')) }),
      ...(f.get('title') && { title: String(f.get('title')) }), ...(f.get('note') && { note: String(f.get('note')) }), with: names,
    }, 'Séance enregistrée.');
    if (ok) close();
  };
  return (
    <Sheet title={id ? 'Modifier la séance' : 'Nouvelle séance'} onClose={close}>
      <form onSubmit={submit}>
        <div className="two"><Field label="Date"><input name="date" type="date" required defaultValue={cur?.date ?? date ?? today} /></Field><Field label="Heure"><input name="time" type="time" defaultValue={cur?.time ?? ''} /></Field></div>
        <div className="two">
          <Field label="Sport"><select name="sport" defaultValue={cur?.sport ?? 'run'}>{SPORT_IDS.map((k) => <option key={k} value={k}>{SPORTS[k].name}</option>)}</select></Field>
          <Field label="Type"><select name="kind" defaultValue={cur?.kind ?? 'easy'}>{KIND_IDS.filter((k) => k !== 'race').map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}</select></Field>
        </div>
        <div className="two"><Field label="Durée (min)"><input name="dur" type="number" min="10" max="600" defaultValue={cur?.dur ?? 60} /></Field><Field label="Lieu"><input name="place" maxLength={80} defaultValue={cur?.place ?? ''} /></Field></div>
        <Field label="Titre (facultatif)"><input name="title" maxLength={60} defaultValue={cur?.title ?? ''} /></Field>
        <div className="f"><span>Avec</span>
          <div className="chips">{data.settings.friends.map((n) => (
            <label key={n} className="chip"><input type="checkbox" checked={with_.includes(n)} onChange={(e) => setWith(e.target.checked ? [...with_, n] : with_.filter((x) => x !== n))} />{n}</label>
          ))}</div>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Autre prénom (virgules)" aria-label="Autres partenaires" />
        </div>
        <Field label="Note"><textarea name="note" rows={2} maxLength={300} defaultValue={cur?.note ?? ''} /></Field>
        <button className="btn pri block">Enregistrer</button>
      </form>
    </Sheet>
  );
}

function EventForm({ id, close }: { id?: string; close: () => void }) {
  const { data, today, act } = useApp();
  const cur = id ? data.events.find((x) => x.id === id) : undefined;
  const [kind, setKind] = useState<EventKind>(cur?.kind ?? 'race');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await act({
      type: 'saveEvent', ...(id && { id }), kind, name: String(f.get('name')), date: String(f.get('date')), sport: String(f.get('sport')) as Sport,
      dist: Number(f.get('dist')) || 0, dplus: Number(f.get('dplus')) || 0, dur: Number(f.get('dur')) || 0, prio: String(f.get('prio') ?? 'B') as Prio,
      notes: String(f.get('notes') ?? ''), with: String(f.get('with') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    }, 'Échéance enregistrée.');
    if (ok) close();
  };
  return (
    <Sheet title={id ? 'Modifier l’échéance' : 'Nouvelle échéance'} onClose={close}>
      <div className="seg"><button type="button" className={kind === 'race' ? 'on' : ''} onClick={() => setKind('race')}>Course</button><button type="button" className={kind === 'outing' ? 'on' : ''} onClick={() => setKind('outing')}>Sortie prévue</button></div>
      <form onSubmit={submit}>
        <Field label="Nom"><input name="name" required maxLength={80} defaultValue={cur?.name ?? ''} /></Field>
        <div className="two"><Field label="Date"><input name="date" type="date" required min={id ? undefined : today} defaultValue={cur?.date ?? ''} /></Field>
          <Field label="Sport"><select name="sport" defaultValue={cur?.sport ?? (kind === 'race' ? 'trail' : 'bike')}>{SPORT_IDS.filter((k) => k !== 'strength').map((k) => <option key={k} value={k}>{SPORTS[k].name}</option>)}</select></Field></div>
        <div className="two three"><Field label="Distance (km)"><input name="dist" type="number" step="0.1" min="0" defaultValue={cur?.dist ?? ''} /></Field><Field label="D+ (m)"><input name="dplus" type="number" min="0" defaultValue={cur?.dplus ?? ''} /></Field><Field label="Durée (min)"><input name="dur" type="number" min="0" defaultValue={cur?.dur || ''} /></Field></div>
        {kind === 'race' && <Field label="Priorité"><select name="prio" defaultValue={cur?.prio ?? 'B'}><option value="A">A — objectif de la saison</option><option value="B">B — important</option><option value="C">C — entraînement</option></select></Field>}
        <Field label="Avec (virgules)"><input name="with" defaultValue={cur?.with.join(', ') ?? ''} /></Field>
        <Field label="Notes"><textarea name="notes" rows={2} maxLength={500} defaultValue={cur?.notes ?? ''} /></Field>
        <button className="btn pri block">Enregistrer</button>
        {id && <button type="button" className="btn danger block" onClick={() => void act({ type: 'deleteEvent', id }, 'Supprimée.').then((ok) => { if (ok) close(); })}>Supprimer</button>}
      </form>
    </Sheet>
  );
}

function EventView({ id, close }: { id: string; close: () => void }) {
  const { data, today, act, open } = useApp();
  const e = data.events.find((x) => x.id === id);
  if (!e) return null;
  const left = diffDays(e.date, today);
  const prep = [...e.prep].sort((a, b) => a.off - b.off);
  return (
    <Sheet title={e.name} onClose={close}>
      <div className="s-tags"><span className="tag">{dateLabel(e.date)}</span><span className="tag k">{SPORTS[e.sport].name}</span>{e.dist > 0 && <span className="tag mono">{e.dist} km</span>}{e.dplus > 0 && <span className="tag mono">{e.dplus} m D+</span>}{e.kind === 'race' && <span className="tag">Priorité {e.prio}</span>}</div>
      <p className="mute">{left > 0 ? `Dans ${left} jours.` : left === 0 ? 'C’est aujourd’hui.' : 'Terminée.'}</p>
      {e.notes && <p>{e.notes}</p>}
      {e.with.length > 0 && <p className="soc-line">Avec {e.with.join(', ')}</p>}
      {prep.length > 0 && <div className="card list"><h3>Préparation</h3>
        {prep.map((p) => {
          const due = new Date(Date.parse(`${e.date}T00:00:00Z`) + p.off * 86_400_000).toISOString().slice(0, 10);
          return (
            <label key={p.id} className={`chk${!p.done && due < today ? ' late' : ''}`}>
              <input type="checkbox" checked={p.done} onChange={(ev) => void act({ type: 'togglePrep', eventId: e.id, prepId: p.id, done: ev.target.checked })} />
              <span>{p.text}<em>{p.off === 0 ? 'Jour J' : p.off < 0 ? `J−${-p.off}` : `J+${p.off}`} · {dateLabel(due)}</em></span>
            </label>
          );
        })}</div>}
      <div className="acts"><button className="btn" onClick={() => open({ kind: 'event', id: e.id })}>Modifier</button></div>
    </Sheet>
  );
}
