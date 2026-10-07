import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.log('DATABASE_URL absent : migrations ignorées (mode démo en mémoire).');
  process.exit(0);
}
const sql = postgres(url, { max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
const dir = join(process.cwd(), 'migrations');
await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const applied = new Set((await sql<Array<{ name: string }>>`select name from schema_migrations`).map((r) => r.name));
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) continue;
  console.log(`Migration ${file}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
    await tx`insert into schema_migrations (name) values (${file})`;
  });
}
await sql.end();
console.log('Base à jour.');
