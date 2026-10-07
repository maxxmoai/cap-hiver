'use client';
import { useState } from 'react';
import { weekWarnings } from '../engine/adapt.ts';
import { PHASES } from '../engine/constants.ts';
import { DAY_LONG, addDays, dateLabel, hm, weekStart } from '../engine/dates.ts';
import { sessionLoad } from '../engine/load.ts';
import { phaseInfo } from '../engine/planner.ts';
import { useApp } from './store.tsx';
import { SessionRow } from './ui.tsx';

export function Semaine({ initial }: { initial?: string }) {
  const { data, today, open } = useApp();
  const [ws, setWs] = useState(initial ?? weekStart(today));
  const info = phaseInfo(ws, { settings: data.settings, events: data.events, busy: data.busy });
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const ss = data.sessions.filter((s) => s.date >= ws && s.date <= days[6]! && s.status !== 'skipped');
  const planned = ss.reduce((n, s) => n + s.dur, 0);
  const done = ss.filter((s) => s.status === 'done').reduce((n, s) => n + (s.done?.dur ?? s.dur), 0);
  const tss = Math.round(ss.filter((s) => s.status === 'done').reduce((n, s) => n + sessionLoad(s), 0));
  const warns = weekWarnings(ws, data.sessions, data.settings);
  return (
    <>
      <div className="wk-nav">
        <button className="icon sm" aria-label="Semaine précédente" onClick={() => setWs(addDays(ws, -7))}>‹</button>
        <div><div className="eyebrow">{dateLabel(ws)} – {dateLabel(days[6]!)}</div><h1>Semaine</h1></div>
        <button className="icon sm" aria-label="Semaine suivante" onClick={() => setWs(addDays(ws, 7))}>›</button>
      </div>
      <div className="row"><span className={`phase ph-${info.ph}`}>{PHASES[info.ph]}</span>{info.note && <span className="small mute">{info.note}</span>}{info.exam && <span className="pill warn">Partiels : −{Math.round(data.settings.examTaper * 100)} % de volume</span>}</div>
      <div className="stats">
        <div><span>Prévu</span><b>{hm(planned)}</b></div>
        <div><span>Fait</span><b>{hm(done)}</b></div>
        <div><span>Charge</span><b>{tss}</b></div>
      </div>
      {warns.map((w) => <div key={w} className="alert warn">{w}</div>)}
      {days.map((d) => {
        const list = ss.filter((s) => s.date === d);
        const b = data.busy[d];
        return (
          <section key={d} className={`day${d === today ? ' today' : ''}${d < today ? ' past' : ''}`}>
            <header>
              <h2>{DAY_LONG[(days.indexOf(d))]!.slice(0, 3)} <span className="mono">{d.slice(8)}</span></h2>
              {b && b.classMin > 0 && <span className="flag">{Math.round(b.classMin / 6) / 10} h de cours</span>}
              {b?.exam && <span className="flag">Examen</span>}
              <button className="icon sm" aria-label={`Ajouter une séance le ${dateLabel(d)}`} onClick={() => open({ kind: 'editSession', date: d })}>+</button>
            </header>
            {list.length === 0 && <p className="dayempty">Repos.</p>}
            {list.map((s) => <SessionRow key={s.id} s={s} onOpen={() => open({ kind: 'session', id: s.id })} />)}
          </section>
        );
      })}
    </>
  );
}
