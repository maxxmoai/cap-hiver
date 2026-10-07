'use client';
import { SPORTS } from '../engine/constants.ts';
import { dateLabel, diffDays } from '../engine/dates.ts';
import type { RaceEvent } from '../engine/types.ts';
import { useApp } from './store.tsx';

export function Bib({ e, big, onOpen }: { e: RaceEvent; big?: boolean; onOpen: () => void }) {
  const { today } = useApp();
  const n = diffDays(e.date, today);
  return (
    <div className={`bib${big ? ' big' : ''}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(k) => { if (k.key === 'Enter') onOpen(); }}>
      <div className="bib-pins"><i /><i /></div>
      <div className="bib-l"><div className="bib-prio mono">{e.kind === 'race' ? e.prio : '•'}</div><span className="bib-k mono">{e.kind === 'race' ? 'COURSE' : 'SORTIE'}</span></div>
      <div className="bib-c">
        <div className="bib-name">{e.name}</div>
        <div className="bib-meta">{dateLabel(e.date)} · {SPORTS[e.sport].short}{e.dist ? ` · ${e.dist} km` : ''}{e.dplus ? ` · ${e.dplus} m D+` : ''}</div>
      </div>
      <div className="bib-n">{n >= 0 ? <>{n}<span> j</span></> : <span>passée</span>}</div>
    </div>
  );
}

export function Courses() {
  const { data, today, open } = useApp();
  const list = [...data.events].sort((a, b) => (a.date < b.date ? -1 : 1));
  const up = list.filter((e) => e.date >= today);
  const past = list.filter((e) => e.date < today);
  return (
    <>
      <div className="row"><div><div className="eyebrow">Échéances</div><h1>Courses</h1></div><button className="btn pri" onClick={() => open({ kind: 'event' })}>+ Ajouter</button></div>
      {up.length === 0 && <p className="empty">Aucune échéance à venir. Ajoute une course : la préparation (J−28 → J+3), l’affûtage et la récupération se calent dessus.</p>}
      {up.map((e) => <Bib key={e.id} e={e} onOpen={() => open({ kind: 'eventView', id: e.id })} />)}
      {past.length > 0 && <><h2 className="sec">Passées</h2>{past.map((e) => <Bib key={e.id} e={e} onOpen={() => open({ kind: 'eventView', id: e.id })} />)}</>}
    </>
  );
}
