import { KINDS, SPORTS } from './constants.ts';
import { hm } from './dates.ts';
import type { Session } from './types.ts';

const UPPER_STEPS: readonly string[] = [
  'Échauffement 8′ : rameur léger ou élastiques, mobilité des épaules',
  'Tirage horizontal (rowing ou élastique) 4 × 10',
  'Tractions ou tirage vertical 3 × 6–8',
  'Pompes ou développé 3 × 10',
  'Gainage rotatif (Pallof, bûcheron) 3 × 12 par côté',
  'Planche et gainage latéral 3 × 40″',
  'Mobilité douce 5′, sans étirement forcé des jambes',
];

export function titleOf(s: Session): string {
  if (s.title) return s.title;
  if (s.kind === 'strength') return s.phase === 'transition' || s.phase === 'ski' ? 'Renfo haut du corps et gainage' : 'Renfo jambes et gainage';
  if (s.kind === 'shake') return 'Décrassage';
  if (s.kind === 'interval' && s.light) return 'Rappel de vitesse';
  return `${KINDS[s.kind]} · ${SPORTS[s.sport].short}`;
}

const r5 = (x: number): number => Math.max(5, Math.round(x / 5) * 5);

/** Détail d'une séance : étapes et conseils. Les étapes écrites par le coach ou l'utilisateur priment. */
export function describe(s: Session): { steps: string[]; tips: string[] } {
  if (s.steps && s.steps.length) return { steps: s.steps, tips: s.why ? [s.why] : [] };
  const d = s.dur || 45;
  const k = s.kind;
  const sp = s.sport;
  const v = s.week ?? 0;
  const tips: string[] = [];
  const wu = r5(Math.min(15, d * 0.22));
  const cd = r5(Math.min(10, d * 0.14));
  const main = Math.max(10, d - wu - cd);
  const snow = sp === 'roller' || sp === 'ski';
  const warm = `Échauffement ${wu}′ très facile, puis 3 accélérations de 15″`;
  const cool = `Retour au calme ${cd}′ souple`;
  let st: string[];

  if (k === 'strength') {
    const ski = s.upper || s.phase === 'transition' || s.phase === 'ski';
    st = s.upper
      ? [...UPPER_STEPS]
      : ski
        ? ['Échauffement 8′ : rameur léger, mobilité épaules et hanches', 'Tirage horizontal (rowing ou élastique) 4 × 10', 'Tractions ou tirage vertical 3 × 6–8', 'Pompes ou développé 3 × 10', 'Gainage rotatif (Pallof, bûcheron) 3 × 12 par côté', 'Squat puis fentes 3 × 8', 'Mobilité 5′']
        : ['Échauffement 8′ : mobilité hanches et chevilles', 'Squat ou presse 4 × 8', 'Fentes bulgares 3 × 8 par jambe', 'Soulevé de terre jambes tendues 3 × 8', 'Montées de banc 3 × 10 par jambe', 'Mollets 3 × 15, gainage 3 × 45″', 'Mobilité 5′'];
    tips.push('Garde 2 répétitions en réserve sur chaque série. La qualité passe avant la charge.');
  } else if (k === 'interval') {
    if (s.light) {
      st = ['Échauffement 12′ facile', '6 × 1′ vif (RPE 8), récupération 1′ en trottinant', 'Retour au calme 10′'];
      tips.push('Court et vif : on garde le mordant sans fatiguer avant la course.');
    } else {
      const len = [2, 3, 4, 5][v % 4]!;
      const rec = Math.ceil(len / 2);
      const n = Math.max(3, Math.floor(main / (len + rec)));
      st = [warm, `${n} × ${len}′ à RPE 8${snow ? ' en poussée soutenue' : ', allure proche du 10 km'}, récupération ${rec}′ facile`, cool];
    }
  } else if (k === 'tempo') {
    st = [warm, `1 × ${r5(main * 0.7)}′ à RPE 7 (allure semi, quelques mots possibles)`, cool];
  } else if (k === 'hills') {
    const len = [1.5, 2, 3][v % 3]!;
    const n = Math.max(4, Math.floor(main / (len * 2)));
    const ls = len === 1.5 ? '1′30' : `${len}′`;
    st = [warm, `${n} × ${ls} en côte soutenue (RPE 7–8), ${snow ? 'montée en double-poussée ou pas alternatif, descente récupération' : 'redescente en trottinant'}`, cool];
  } else if (k === 'long') {
    if (sp === 'bike') st = [`${hm(d)} en endurance (RPE 3–4), cadence 85–95 tr/min, relances libres dans les côtes`];
    else if (sp === 'trail') st = [`${hm(d)} en terrain vallonné, endurance (RPE 3–4). D+ visé ≈ ${Math.round((d * 4) / 50) * 50} m`];
    else if (snow) st = [`${hm(d)} en endurance technique (RPE 3–4), rythme régulier, relâché dans les bras`];
    else st = [`${hm(d)} en endurance (RPE 3–4), allure constante`];
    if (d >= 90) tips.push('Au-delà de 1h30 : 40 à 60 g de glucides par heure et boire régulièrement. Teste ce que tu utiliseras en course.');
  } else if (k === 'easy') {
    st = [`${d}′ en endurance (RPE 3). Tu dois pouvoir tenir une conversation.`];
    if ((sp === 'run' || sp === 'trail') && d >= 40) st.push('Fin de séance : 4 × 20″ de foulées relâchées');
  } else if (k === 'recovery') {
    st = [`${d}′ très facile (RPE 2). Si les jambes sont lourdes : marche active ou vélo souple.`];
  } else if (k === 'tech') {
    st = [snow ? `Échauffement ${wu}′` : warm, 'Ateliers 25′ : double-poussée sans bâtons, un ski, pas alternatif sur faux-plat', `${Math.max(10, main - 25)}′ d’endurance technique, relâché`, cool];
  } else if (k === 'shake') {
    st = [`${d}′ très facile`, '4 × 15″ vifs pour garder le jus'];
  } else if (k === 'race') {
    st = ['Échauffement 10–15′ facile + 2 accélérations', 'Course : démarre 5 à 10 % plus doux que ton allure cible sur le premier tiers', 'Ravitaille avant d’avoir faim ou soif, selon ton plan'];
    tips.push('Suis ta checklist dans l’onglet Courses.');
  } else {
    st = [`${d}′ à RPE ${s.rpe || 4}`];
  }
  if (s.indoor) st = [`Séance en intérieur (home-trainer ou rouleaux) : ${st[0] ?? ''}`, ...st.slice(1)];
  if (s.why) tips.push(s.why);
  return { steps: st, tips };
}
