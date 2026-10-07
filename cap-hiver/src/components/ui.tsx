'use client';
import { useEffect, type ReactNode } from 'react';
import { KINDS, SPORTS } from '../engine/constants.ts';
import { dateLabel, hm } from '../engine/dates.ts';
import { titleOf } from '../engine/describe.ts';
import type { Session } from '../engine/types.ts';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    document.body.classList.add('lock');
    return () => { document.removeEventListener('keydown', k); document.body.classList.remove('lock'); };
  }, [onClose]);
  return (
    <div id="sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div id="panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sh-h"><h2>{title}</h2><button className="icon sm" onClick={onClose} aria-label="Fermer">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export const Dot = ({ sport }: { sport: Session['sport'] }) => <i className="dot" style={{ background: `var(--${sport})` }} />;

export function SessionRow({ s, onOpen }: { s: Session; onOpen: () => void }) {
  const off = s.status === 'skipped';
  return (
    <div className={`sess${off ? ' off' : ''}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <div className="s-dur mono">{hm(s.done?.dur ?? s.dur)}</div>
      <div className="s-body">
        <div className="s-tags">
          <span className="tag"><Dot sport={s.sport} />{SPORTS[s.sport].short}</span>
          <span className="tag k">{KINDS[s.kind]}</span>
          {s.with.length > 0 && <span className="tag soc">avec {s.with.join(', ')}</span>}
          {s.src === 'ia' && <span className="tag">Coach</span>}
          {s.src === 'weather' && <span className="tag">Météo</span>}
          {s.indoor && <span className="tag">Intérieur</span>}
          {s.status === 'done' && <span className="pill good">Faite{s.done?.source === 'strava' ? ' · Strava' : ''}</span>}
          {off && <span className="pill mute">Annulée</span>}
        </div>
        <h3>{titleOf(s)}</h3>
        {(s.time || s.place) && <div className="s-when">{[s.time, s.place].filter(Boolean).join(' · ')}</div>}
      </div>
      <div className="rpe mono">RPE {s.done?.rpe ?? s.rpe}</div>
    </div>
  );
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="f"><span>{label}</span>{children}</label>;

export function Scale({ value, onChange, low, high, name }: { value: number | null | undefined; onChange: (v: number) => void; low: string; high: string; name: string }) {
  return (
    <div className="seg five" role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} className={value === n ? 'on' : ''} onClick={() => onChange(n)}>
          <b>{n}</b><small>{n === 1 ? low : n === 5 ? high : ' '}</small>
        </button>
      ))}
    </div>
  );
}

export const when = (d: string): string => dateLabel(d);
