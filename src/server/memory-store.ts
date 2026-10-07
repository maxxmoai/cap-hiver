import { randomUUID } from 'node:crypto';
import type { Loaded, Store, StravaAccount, User, UserData, UserWithHash } from './types.ts';

/** Stockage en mémoire pour les tests et le développement sans base de données. */
export class MemoryStore implements Store {
  private users = new Map<string, UserWithHash>();
  private data = new Map<string, { data: UserData; version: number }>();
  private strava = new Map<string, StravaAccount>();
  private hits = new Map<string, { start: number; count: number }>();

  async createUser(email: string, name: string, passwordHash: string): Promise<User | null> {
    const e = email.trim().toLowerCase();
    if ([...this.users.values()].some((u) => u.email === e)) return null;
    const u: UserWithHash = { id: randomUUID(), email: e, name, passwordHash };
    this.users.set(u.id, u);
    return { id: u.id, email: u.email, name: u.name };
  }
  async findUserByEmail(email: string): Promise<UserWithHash | null> {
    const e = email.trim().toLowerCase();
    return [...this.users.values()].find((u) => u.email === e) ?? null;
  }
  async getUser(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? { id: u.id, email: u.email, name: u.name } : null;
  }
  async loadData(userId: string): Promise<Loaded | null> {
    const row = this.data.get(userId);
    return row ? { data: structuredClone(row.data), version: row.version } : null;
  }
  async saveData(userId: string, data: UserData, expectedVersion: number): Promise<boolean> {
    const row = this.data.get(userId);
    if ((row?.version ?? 0) !== expectedVersion) return false;
    this.data.set(userId, { data: structuredClone(data), version: expectedVersion + 1 });
    return true;
  }
  async listUserIds(): Promise<string[]> { return [...this.users.keys()]; }
  async getStrava(userId: string): Promise<StravaAccount | null> { return this.strava.get(userId) ?? null; }
  async findStravaByAthlete(athleteId: number): Promise<StravaAccount | null> {
    return [...this.strava.values()].find((a) => a.athleteId === athleteId) ?? null;
  }
  async saveStrava(a: StravaAccount): Promise<void> { this.strava.set(a.userId, { ...a }); }
  async deleteStrava(userId: string): Promise<void> { this.strava.delete(userId); }
  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || now - cur.start > windowSec * 1000) { this.hits.set(key, { start: now, count: 1 }); return 1 <= limit; }
    cur.count++;
    return cur.count <= limit;
  }
}
