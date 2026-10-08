import { hashPassword } from '../../../../lib/crypto.ts';
import { env } from '../../../../server/env.ts';
import { mutate } from '../../../../server/mutate.ts';
import { clientIp, deps, fail, getStore, json, sameOrigin, startSession, guard } from '../../../../server/runtime.ts';

async function postHandler(req: Request) {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  if (!env().signupOpen) return fail('Les inscriptions sont fermées.', 403);
  const store = getStore();
  if (!(await store.hit(`signup:${await clientIp()}`, 5, 3600))) return fail('Trop de tentatives, réessaie plus tard.', 429);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof b?.['email'] === 'string' ? b['email'].trim().toLowerCase() : '';
  const name = typeof b?.['name'] === 'string' ? b['name'].trim().slice(0, 40) : '';
  const password = typeof b?.['password'] === 'string' ? b['password'] : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return fail('Adresse e-mail invalide.');
  if (password.length < 10 || password.length > 200) return fail('Le mot de passe doit faire au moins 10 caractères.');
  const user = await store.createUser(email, name || email.split('@')[0]!, hashPassword(password));
  if (!user) return fail('Un compte existe déjà avec cette adresse.', 409);
  await mutate(store, user.id, deps(), (d) => d);
  await startSession(user.id);
  return json({ user });
}

export const POST = guard(postHandler);
