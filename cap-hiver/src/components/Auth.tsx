'use client';
import { useState, type FormEvent } from 'react';
import { auth } from './api.ts';
import { Field } from './ui.tsx';

export function AuthScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr('');
    try {
      await auth(mode, { email: String(f.get('email') ?? ''), password: String(f.get('password') ?? ''), name: String(f.get('name') ?? '') });
      onDone();
    } catch (x) { setErr(x instanceof Error ? x.message : 'Erreur'); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="brand"><i className="mark" />Cap Hiver</div>
      <h1>{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h1>
      <p className="lead">Plan trail et ski de fond, calé sur tes cours, la météo et tes sorties réelles.</p>
      <form onSubmit={submit} className="card">
        {mode === 'signup' && <Field label="Prénom"><input name="name" autoComplete="given-name" maxLength={40} /></Field>}
        <Field label="E-mail"><input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Mot de passe"><input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 10 : 1} required /></Field>
        {mode === 'signup' && <p className="small mute">10 caractères minimum.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn pri block" disabled={busy}>{mode === 'login' ? 'Se connecter' : 'Créer mon compte'}</button>
      </form>
      <button className="lnk" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>
        {mode === 'login' ? 'Pas encore de compte ? Créer un compte' : 'Déjà un compte ? Se connecter'}
      </button>
    </div>
  );
}
