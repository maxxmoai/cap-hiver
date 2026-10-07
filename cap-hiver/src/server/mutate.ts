import { sanitizeUserData } from './sanitize.ts';
import { emptyUserData, todayOf, type Deps } from './service.ts';
import type { Store, UserData } from './types.ts';

/** Charge les données d'un utilisateur, ou crée son plan de départ. */
export async function loadOrCreate(store: Store, userId: string, deps: Deps): Promise<{ data: UserData; version: number }> {
  const row = await store.loadData(userId);
  if (!row) return { data: emptyUserData(deps), version: 0 };
  const today = todayOf(sanitizeUserData({ settings: (row.data as UserData).settings }, deps.newId, '2000-01-01'), deps);
  return { data: sanitizeUserData(row.data, deps.newId, today), version: row.version };
}

/**
 * Lecture, modification, écriture avec verrou optimiste. En cas de conflit (un webhook ou un autre onglet
 * a écrit entre-temps), on relit et on rejoue la modification.
 */
export async function mutate(store: Store, userId: string, deps: Deps, fn: (d: UserData) => UserData | Promise<UserData>, retries = 4): Promise<UserData> {
  for (let i = 0; i < retries; i++) {
    const { data, version } = await loadOrCreate(store, userId, deps);
    const next = await fn(data);
    if (await store.saveData(userId, next, version)) return next;
  }
  throw new Error('Trop de modifications simultanées, réessaie.');
}
