'use client';
import { createContext, useContext } from 'react';
import type { Action } from '../server/actions.ts';
import type { UserData } from '../server/types.ts';
import type { StatePayload } from './api.ts';

export interface Ctx {
  data: UserData;
  today: string;
  user: StatePayload['user'];
  integrations: StatePayload['integrations'];
  busy: boolean;
  act: (a: Action, okMsg?: string) => Promise<boolean>;
  sync: () => Promise<void>;
  setData: (d: UserData) => void;
  open: (s: Sheet | null) => void;
  toast: (m: string) => void;
  logout: () => Promise<void>;
}

export type Sheet =
  | { kind: 'session'; id: string }
  | { kind: 'log'; id: string }
  | { kind: 'editSession'; id?: string; date?: string }
  | { kind: 'event'; id?: string }
  | { kind: 'eventView'; id: string };

export const AppCtx = createContext<Ctx | null>(null);
export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('Contexte absent');
  return c;
}
