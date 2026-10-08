import postgres from 'postgres';
import { SCHEMA_SQL } from '../src/server/schema.ts';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.log('DATABASE_URL absent : migration ignorée (mode démo en mémoire).');
  process.exit(0);
}
const sql = postgres(url, { max: 1, prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
try {
  await sql.unsafe(SCHEMA_SQL);
  console.log('Base à jour.');
} catch (e) {
  // Ne bloque pas le déploiement : le serveur recrée les tables au premier accès.
  console.warn('Migration impossible au build :', e instanceof Error ? e.message : e);
} finally {
  await sql.end({ timeout: 5 });
}
