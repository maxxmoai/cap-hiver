import { endSession, fail, json, sameOrigin } from '../../../../server/runtime.ts';

export async function POST() {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  await endSession();
  return json({ ok: true });
}
