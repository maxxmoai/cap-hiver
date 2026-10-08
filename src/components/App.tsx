'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action } from '../server/actions.ts';
import type { UserData } from '../server/types.ts';
import { ApiError, auth, getState, sendAction, syncNow, type StatePayload } from './api.ts';
import { AuthScreen } from './Auth.tsx';
import { Courses } from './Courses.tsx';
import { Jour } from './Jour.tsx';
import { Plan } from './Plan.tsx';
import { Reglages } from './Reglages.tsx';
import { Sheets } from './Sheets.tsx';
import { AppCtx, type Ctx, type Sheet } from './store.tsx';
import { Semaine } from './Semaine.tsx';

type Tab = 'jour' | 'semaine' | 'plan' | 'courses' | 'reglages';
const TABS: Array<[Tab, string]> = [['jour', 'Jour'], ['semaine', 'Semaine'], ['plan', 'Plan'], ['courses', 'Courses'], ['reglages', 'Réglages']];

export function App() {
  const [st, setSt] = useState<StatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('jour');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3500);
  }, []);

  useEffect(() => {
    getState().then(setSt).catch((e: unknown) => { if (!(e instanceof ApiError) || e.status !== 401) toast(e instanceof Error ? e.message : 'Erreur'); }).finally(() => setLoading(false));
  }, [toast]);

  // intervals.icu : une synchro silencieuse à l'ouverture, pour que le plan tienne compte de la sortie du matin.
  const icuOnce = useRef(false);
  useEffect(() => {
    if (!st?.data.intervals.connected || icuOnce.current) return;
    icuOnce.current = true;
    syncNow().then((r) => setSt((p) => (p ? { ...p, data: r.data, today: r.today } : p))).catch(() => undefined);
  }, [st]);

  // Reprend l'état quand l'onglet redevient visible : un webhook Strava a pu modifier le plan.
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible' && st) getState().then(setSt).catch(() => undefined); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [st]);

  const ctx: Ctx | null = useMemo(() => {
    if (!st) return null;
    const apply = (data: UserData, today?: string) => setSt((p) => (p ? { ...p, data, today: today ?? p.today } : p));
    return {
      data: st.data, today: st.today, user: st.user, integrations: st.integrations, busy,
      setData: (d) => apply(d),
      open: setSheet,
      toast,
      act: async (a: Action, okMsg?: string) => {
        setBusy(true);
        try { const r = await sendAction(a); apply(r.data, r.today); if (okMsg) toast(okMsg); return true; }
        catch (e) { toast(e instanceof Error ? e.message : 'Action impossible.'); return false; }
        finally { setBusy(false); }
      },
      sync: async () => {
        setBusy(true);
        try { const r = await syncNow(); apply(r.data, r.today); toast('Synchronisé.'); }
        catch (e) { toast(e instanceof Error ? e.message : 'Synchronisation impossible.'); }
        finally { setBusy(false); }
      },
      logout: async () => { await auth('logout').catch(() => undefined); setSt(null); },
    };
  }, [st, busy, toast]);

  if (loading) return <div className="auth"><p className="mute">Chargement…</p></div>;
  if (!st || !ctx) return <AuthScreen onDone={() => { setLoading(true); getState().then(setSt).catch(() => undefined).finally(() => setLoading(false)); }} />;

  const pending = st.data.suggestions.filter((s) => s.status === 'new').length;
  return (
    <AppCtx.Provider value={ctx}>
      <header className="top"><div>
        <div className="brand"><i className="mark" />Cap Hiver</div>
        <span id="snow" className="mono">{st.today}</span>
      </div></header>
      <main className={`wrap${busy ? ' spin' : ''}`}>
        {tab === 'jour' && <Jour pending={pending} />}
        {tab === 'semaine' && <Semaine />}
        {tab === 'plan' && <Plan goWeek={() => setTab('semaine')} />}
        {tab === 'courses' && <Courses />}
        {tab === 'reglages' && <Reglages />}
      </main>
      <nav className="tabs" aria-label="Navigation"><div>
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); window.scrollTo(0, 0); }}>
            {label}{id === 'jour' && pending > 0 ? ` · ${pending}` : ''}
          </button>
        ))}
      </div></nav>
      {sheet && <Sheets sheet={sheet} />}
      {msg && <div className="toast" role="status">{msg}</div>}
    </AppCtx.Provider>
  );
}
