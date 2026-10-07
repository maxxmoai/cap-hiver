import type { IdGen, PrepItem, RaceEvent } from './types.ts';

/** Checklist de préparation d'une course, de J−28 à J+3. */
export function prepFor(ev: Pick<RaceEvent, 'dist' | 'dur'>, newId: IdGen): PrepItem[] {
  const long = ev.dist >= 20 || ev.dur >= 150;
  const rows: Array<[number, string]> = [
    [-28, 'Inscription validée, certificat ou licence à jour, hébergement et trajet réglés'],
    [-21, 'Étudier le profil : ravitaillements, barrières horaires, matériel obligatoire'],
    [-14, 'Dernière grosse sortie à allure course : tester chaussures, sac et nutrition du jour J'],
    [-10, 'Reconnaître une partie du parcours (ou le visionner) et repérer les points clés'],
    [-7, 'Fixer le plan de course : allures par tiers, ravitos, plan B météo'],
    [-5, 'Vérifier le matériel obligatoire et préparer la tenue complète'],
    [-3, 'Sommeil prioritaire (8 h minimum), hydratation régulière, aucune nouveauté alimentaire'],
    [-2, 'Retrait du dossard, sac prêt, trajet et horaires confirmés'],
    [-1, 'Décrassage court, repas habituel, alarmes réglées'],
    [0, 'Petit-déjeuner habituel 3 h avant, échauffement court, partir plus doux que prévu'],
    [1, 'Récupération : marche, mobilité, repas riche en glucides et protéines'],
    [3, 'Bilan : ressenti, erreurs, ce qui a marché. Note-le pour la prochaine'],
  ];
  if (long) rows.splice(6, 0, [-4, 'Charge en glucides légère sur 36 à 48 h : féculents à chaque repas, fibres réduites']);
  return rows.map(([off, text]) => ({ id: newId(), off, text, done: false }));
}
