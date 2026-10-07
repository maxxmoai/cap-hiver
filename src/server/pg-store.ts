import postgres from 'postgres';
import type { Loaded, Store, StravaAccount, User, UserData, UserWithHash } from './types.ts';

type Sql = ReturnType<typeof postgres>;

/** Stockage Postgres. Les données d'un utilisateur tiennent dans un seul document jsonb versionné. */
export class PgStore implements Store {
  private sql: Sql;
  constructor(url: string) {
    this.sql = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
  }

  async createUser(email: string, name: string, passwordHash: string): Promise<User | null> {
    const rows = await this.sql<User[]>`
      insert into users (email, name, password_hash) values (${email.trim().toLowerCase()}, ${name}, ${passwordHash})
      on conflict (email) do nothing returning id, email, name`;
    return rows[0] ?? null;
  }
  async findUserByEmail(email: string): Promise<UserWithHash | null> {
    const rows = await this.sql<UserWithHash[]>`select id, email, name, password_hash as "passwordHash" from users where email = ${email.trim().toLowerCase()}`;
    return rows[0] ?? null;
  }
  async getUser(id: string): Promise<User | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await this.sql<User[]>`select id, email, name from users where id = ${id}`;
    return rows[0] ?? null;
  }
  async loadData(userId: string): Promise<Loaded | null> {
    const rows = await this.sql<Array<{ data: UserData; version: number }>>`select data, version from user_data where user_id = ${userId}`;
    return rows[0] ?? null;
  }
  async saveData(userId: string, data: UserData, expectedVersion: number): Promise<boolean> {
    const json = this.sql.json(data as unknown as Parameters<Sql['json']>[0]);
    if (expectedVersion === 0) {
      const rows = await this.sql`insert into user_data (user_id, data, version) values (${userId}, ${json}, 1) on conflict (user_id) do nothing returning version`;
      return rows.length === 1;
    }
    const rows = await this.sql`update user_data set data = ${json}, version = version + 1, updated_at = now() where user_id = ${userId} and version = ${expectedVersion} returning version`;
    return rows.length === 1;
  }
  async listUserIds(): Promise<string[]> {
    const rows = await this.sql<Array<{ id: string }>>`select id from users order by created_at`;
    return rows.map((r) => r.id);
  }
  async getStrava(userId: string): Promise<StravaAccount | null> {
    const rows = await this.sql<StravaAccount[]>`select user_id as "userId", athlete_id::float8 as "athleteId", access_token_enc as "accessTokenEnc", refresh_token_enc as "refreshTokenEnc", expires_at::float8 as "expiresAt" from strava_accounts where user_id = ${userId}`;
    return rows[0] ?? null;
  }
  async findStravaByAthlete(athleteId: number): Promise<StravaAccount | null> {
    const rows = await this.sql<StravaAccount[]>`select user_id as "userId", athlete_id::float8 as "athleteId", access_token_enc as "accessTokenEnc", refresh_token_enc as "refreshTokenEnc", expires_at::float8 as "expiresAt" from strava_accounts where athlete_id = ${athleteId}`;
    return rows[0] ?? null;
  }
  async saveStrava(a: StravaAccount): Promise<void> {
    await this.sql`
      insert into strava_accounts (user_id, athlete_id, access_token_enc, refresh_token_enc, expires_at)
      values (${a.userId}, ${a.athleteId}, ${a.accessTokenEnc}, ${a.refreshTokenEnc}, ${a.expiresAt})
      on conflict (user_id) do update set athlete_id = excluded.athlete_id, access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc, expires_at = excluded.expires_at`;
  }
  async deleteStrava(userId: string): Promise<void> {
    await this.sql`delete from strava_accounts where user_id = ${userId}`;
  }
  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    const rows = await this.sql<Array<{ count: number }>>`
      insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
      returning count`;
    return (rows[0]?.count ?? 1) <= limit;
  }
}
