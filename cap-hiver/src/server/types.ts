import type { DayBusy, FormEntry, RaceEvent, Session, Settings, Suggestion } from '../engine/types.ts';

export interface UserData {
  v: 2;
  settings: Settings;
  events: RaceEvent[];
  sessions: Session[];
  form: Record<string, FormEntry>;
  busy: Record<string, DayBusy>;
  suggestions: Suggestion[];
  anchor: string;
  calendar: { url: string | null; lastSyncAt: string | null; lastError: string | null; coveredTo: string | null };
  weather: { syncedAt: string | null; error: string | null };
  coach: { message: string; at: string | null; usageDate: string; usageCount: number };
  /** Identifiants Strava déjà traités, pour ignorer les doublons de webhook. */
  stravaSeen: string[];
  strava: { connected: boolean; lastSyncAt: string | null };
}

export interface User { id: string; email: string; name: string }
export interface UserWithHash extends User { passwordHash: string }

export interface StravaAccount {
  userId: string;
  athleteId: number;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: number;
}

export interface Loaded { data: UserData; version: number }

export interface Store {
  createUser(email: string, name: string, passwordHash: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<UserWithHash | null>;
  getUser(id: string): Promise<User | null>;
  /** Renvoie les données de l'utilisateur, ou null s'il n'a encore rien enregistré. */
  loadData(userId: string): Promise<Loaded | null>;
  /** Écrit si la version n'a pas changé depuis la lecture. Renvoie false en cas de conflit. */
  saveData(userId: string, data: UserData, expectedVersion: number): Promise<boolean>;
  listUserIds(): Promise<string[]>;
  getStrava(userId: string): Promise<StravaAccount | null>;
  findStravaByAthlete(athleteId: number): Promise<StravaAccount | null>;
  saveStrava(a: StravaAccount): Promise<void>;
  deleteStrava(userId: string): Promise<void>;
  /** Compte un appel et dit s'il reste dans la limite de la fenêtre. */
  hit(key: string, limit: number, windowSec: number): Promise<boolean>;
}
