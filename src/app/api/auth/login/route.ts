import { hashPassword, verifyPassword } from '../../../../lib/crypto.ts';
import { clientIp, fail, getStore, json, sameOrigin, startSession, guard } from '../../../../server/runtime.ts';

let DUMMY: string | null = null;

async function postHandler(req: Request) {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  const store = getStore();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof b?.['email'] === 'string' ? b['email'].trim().toLowerCase() : '';
  const password = typeof b?.['password'] === 'string' ? b['password'] : '';
  const ip = await clientIp();
  if (!(await store.hit(`login:ip:${ip}`, 20, 900)) || !(await store.hit(`login:mail:${email}`, 8, 900))) return fail('Trop de tentatives, réessaie dans quelques minutes.', 429);
  const u = email ? await store.findUserByEmail(email) : null;
  // Même coût et même message que l'adresse existe ou non.
  const ok = u ? verifyPassword(password, u.passwordHash) : (verifyPassword(password, (DUMMY ??= hashPassword('dummy-password'))), false);
  if (!u || !ok) return fail('E-mail ou mot de passe incorrect.', 401);
  await startSession(u.id);
  return json({ user: { id: u.id, email: u.email, name: u.name } });
}

export const POST = guard(postHandler);
