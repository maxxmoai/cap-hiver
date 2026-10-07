'use client';
import { PHASES } from '../engine/constants.ts';
import { addDays, dateLabel, hm, weekStart } from '../engine/dates.ts';
import { phaseInfo } from '../engine/planner.ts';
import { useApp } from './store.tsx';

/** Vue d'ensemble : 20 semaines, volume prévu et réalisé, courses et partiels. */
export function Plan({ goWeek }: { goWeek: () => void }) {
  const { data, today } = useApp();
  void goWeek;
  const start = weekStart(today);
  const weeks = Array.from({ length: 20 }, (_, i) => addDays(start, i * 7));
  const rows = weeks.map((ws) => {
    const we = addDays(ws, 6);
    const ss = data.sessions.filter((s) => s.date >= ws && s.date <= we && s.status !== 'skipped');
    return { ws, info: phaseInfo(ws, { settings: data.settings, events: data.events, busy: data.busy }), plan: ss.reduce((n, s) => n + s.dur, 0), done: ss.filter((s) => s.status === 'done').reduce((n, s) => n + (s.done?.dur ?? s.dur), 0), evs: data.events.filter((e) => e.date >= ws && e.date <= we) };
  });
  const max = Math.max(60, ...rows.map((r) => r.plan));
  return (
    <>
      <div><div className="eyebrow">20 semaines</div><h1>Plan</h1></div>
      <p className="lead">Volume prévu (clair) et fait (foncé). Les semaines de partiels sont allégées, une semaine sur quatre est plus légère, et le ski prend le relais le {dateLabel(data.settings.skiStart)}.</p>
      <div className="weeks">
        {rows.map((r) => (
          <div key={r.ws} className={`wrow${r.ws === start ? ' now' : ''}`}>
            <div className="w-l"><b className="mono">{dateLabel(r.ws)}</b><span className={`phase ph-${r.info.ph}`}>{PHASES[r.info.ph]}</span></div>
            <div className="w-bar">
              <div className="track"><i className="plan" style={{ width: `${(r.plan / max) * 100}%` }} /><i className="done" style={{ width: `${(r.done / max) * 100}%` }} /></div>
              <span className="mono">{hm(r.plan)}{r.info.exam ? ' · partiels' : ''}</span>
            </div>
            {r.evs.length > 0 && <div className="w-ev">{r.evs.map((e) => <span key={e.id} className="evchip">{e.name} · {dateLabel(e.date)}</span>)}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
