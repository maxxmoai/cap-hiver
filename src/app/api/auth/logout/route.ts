import { endSession, fail, json, sameOrigin, guard } from '../../../../server/runtime.ts';

async function postHandler() {
  if (!(await sameOrigin())) return fail('Requête refusée.', 403);
  await endSession();
  return json({ ok: true });
}

export const POST = guard(postHandler);
