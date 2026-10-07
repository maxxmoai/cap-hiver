'use client';
import { useState } from 'react';
import { adaptDay } from '../engine/adapt.ts';
import { KINDS, SPORTS } from '../engine/constants.ts';
import { addDays, dateLabel, diffDays } from '../engine/dates.ts';
import { loadStats } from '../engine/load.ts';
import { titleOf } from '../engine/describe.ts';
import type { CoachChange } from '../lib/coach.ts';
import { askCoach } from './api.ts';
import { useApp } from './store.tsx';
import { Bib } from './Courses.tsx';
import { Scale, SessionRow } from './ui.tsx';

export function Jour({ pending }: { pending: number }) {
  const { data, today, act, open, integrations, toast } = useApp();
  const form = data.form[today] ?? {};
  const mine = (d: string) => data.sessions.filter((s) => s.date === d && s.status !== 'skipped');
  const tomorrow = addDays(today, 1);
  const ls = loadStats(data.sessions, data.form, today);
  const next = data.events.filter((e) => e.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const sugg = data.suggestions.filter((s) => s.status === 'new');
  const busyToday = data.busy[today];

  return (
    <>
      <div><div className="eyebrow">{dateLabel(today)}</div><h1>Aujourd’hui</h1></div>

      {pending > 0 && (
        <section aria-label="À savoir" className="sug">
          {sugg.map((g) => (
            <div key={g.id} className={`alert ${g.kind === 'snow' || g.kind === 'weather' ? 'warn' : g.kind === 'overload' ? 'good' : ''}`}>
              <b>{g.title}</b>
              <p className="small">{g.body}</p>
              <div className="acts">
                {g.options.map((o, i) => <button key={o.label} className="btn sm pri" onClick={() => void act({ type: 'resolveSuggestion', id: g.id, optionIndex: i }, 'Séance remplacée.')}>{o.label}</button>)}
                <button className="btn sm" onClick={() => void act({ type: 'resolveSuggestion', id: g.id, optionIndex: null })}>{g.options.length ? 'Garder tel quel' : 'OK'}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card form" aria-label="Forme du jour">
        <div className="row"><h2>Comment tu te sens ?</h2><span className="small mute">se garde pour aujourd’hui</span></div>
        <div className="axis"><div className="ax-h"><b>Jambes</b><span>lourdes → fraîches</span></div>
          <Scale name="Jambes" value={form.leg} low="lourdes" high="fraîches" onChange={(v) => void act({ type: 'setForm', axis: 'leg', value: v })} /></div>
        <div className="axis"><div className="ax-h"><b>Tête</b><span>cuit → en forme</span></div>
          <Scale name="Fatigue nerveuse" value={form.nerv} low="cuit" high="en forme" onChange={(v) => void act({ type: 'setForm', axis: 'nerv', value: v })} /></div>
        <div className="axis"><div className="ax-h"><b>Sommeil</b><span>mauvais → bon</span></div>
          <Scale name="Sommeil" value={form.sleep} low="court" high="bon" onChange={(v) => void act({ type: 'setForm', axis: 'sleep', value: v })} /></div>
        {busyToday && busyToday.classMin > 0 && <p className="small mute">Cours aujourd’hui : {Math.round(busyToday.classMin / 6) / 10} h{busyToday.exam ? ' · examen' : ''}.</p>}
      </section>

      {[today, tomorrow].map((d) => {
        const list = mine(d);
        return (
          <section key={d} className="day" aria-label={dateLabel(d)}>
            <header><h2>{d === today ? 'Aujourd’hui' : 'Demain'}</h2><span className="small mute">{dateLabel(d)}</span></header>
            {list.length === 0 && <p className="dayempty">Rien de prévu.</p>}
            {list.map((s) => {
              const adv = d === today && s.status === 'planned' ? adaptDay(s, form, { sessions: data.sessions, settings: data.settings }) : null;
              return (
                <div key={s.id} style={{ display: 'contents' }}>
                  <SessionRow s={s} onOpen={() => open({ kind: 'session', id: s.id })} />
                  {adv && (
                    <div className="alert warn">
                      <b>{adv.label}</b><p className="small">{adv.why}</p>
                      <div className="acts">
                        <button className="btn sm pri" onClick={() => void act({ type: 'adaptSession', id: s.id, mode: adv.mode }, 'Séance adaptée.')}>Adapter</button>
                        <button className="btn sm" onClick={() => open({ kind: 'session', id: s.id })}>Voir {titleOf(s)}</button>
                      </div>
                    </div>
                  )}
                  {d === today && s.status === 'planned' && <div className="acts"><button className="btn sm pri" onClick={() => open({ kind: 'log', id: s.id })}>Marquer faite</button></div>}
                </div>
              );
            })}
          </section>
        );
      })}
      <div className="acts"><button className="btn" onClick={() => open({ kind: 'editSession', date: today })}>+ Ajouter une séance</button></div>

      <h2 className="sec">Charge</h2>
      <div className="stats four">
        <div><span>Forme</span><b>{Math.round(ls.ctl)}</b></div>
        <div><span>Fatigue</span><b>{Math.round(ls.atl)}</b></div>
        <div><span>Fraîcheur</span><b>{Math.round(ls.tsb)}</b></div>
        <div><span>7 jours</span><b>{Math.floor(ls.minutes7 / 60)}<small> h {String(ls.minutes7 % 60).padStart(2, '0')}</small></b></div>
      </div>
      {!ls.reliable && <p className="small mute">Les chiffres deviennent fiables après trois semaines et six séances validées.</p>}

      {next && <><h2 className="sec">Prochaine échéance</h2><Bib e={next} big onOpen={() => open({ kind: 'eventView', id: next.id })} /><p className="small mute">{diffDays(next.date, today)} jours.</p></>}

      <h2 className="sec">Coach</h2>
      {integrations.coach ? <Coach onToast={toast} /> : <p className="empty">Le coach IA n’est pas activé sur ce serveur (clé ANTHROPIC_API_KEY manquante).</p>}
    </>
  );
}

function Coach({ onToast }: { onToast: (m: string) => void }) {
  const { data, act } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ message: string; changes: CoachChange[] } | null>(null);
  const ask = async () => {
    setBusy(true);
    try { setReply((await askCoach(text)).reply); } catch (e) { onToast(e instanceof Error ? e.message : 'Coach indisponible.'); } finally { setBusy(false); }
  };
  const shown = reply ?? (data.coach.message ? { message: data.coach.message, changes: [] } : null);
  return (
    <div className="card ai">
      {shown && <p>{shown.message}</p>}
      {reply && reply.changes.length > 0 && (
        <>
          <ul className="steps">{reply.changes.map((c, i) => <li key={i}>{describeChange(c)}</li>)}</ul>
          <div className="acts">
            <button className="btn pri" onClick={() => void act({ type: 'applyCoach', changes: reply.changes }, 'Plan mis à jour.').then((ok) => { if (ok) setReply(null); })}>Appliquer</button>
            <button className="btn" onClick={() => setReply({ ...reply, changes: [] })}>Ignorer</button>
          </div>
        </>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={2} placeholder="Ex. : j’ai un partiel jeudi, ajuste ma semaine." aria-label="Message au coach" />
        <button className="btn pri" disabled={busy}>{busy ? 'Analyse…' : 'Demander au coach'}</button>
      </form>
    </div>
  );
}

function describeChange(c: CoachChange): string {
  const verb = c.action === 'remove' ? 'Retirer' : c.action === 'add' ? 'Ajouter' : 'Modifier';
  const what = [c.title, c.sport && SPORTS[c.sport].short, c.kind && KINDS[c.kind], c.date && dateLabel(c.date), c.dur && `${c.dur} min`].filter(Boolean).join(' · ');
  return `${verb} ${what}${c.reason ? ` — ${c.reason}` : ''}`;
}
