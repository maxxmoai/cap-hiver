import { dateLabel, hm } from './dates.ts';
import { SPORTS } from './constants.ts';
import type { Sport } from './types.ts';

export interface FuelPlan {
  carbsPerH: number;
  waterMlPerH: number;
  totalCarbs: number;
  totalWaterMl: number;
  /** Nombre de bidons de 750 ml pour couvrir l'eau. */
  bottles: number;
  needsFuel: boolean;
}

const round50 = (x: number): number => Math.round(x / 50) * 50;

/** Apports conseillés pour une séance d'endurance de cette durée. */
export function fuelPlan(sport: Sport, durMin: number, tempMaxC?: number | null): FuelPlan {
  const hours = durMin / 60;
  let carbs = 0;
  if (durMin >= 240) carbs = sport === 'bike' ? 75 : 60;
  else if (durMin >= 150) carbs = sport === 'bike' || sport === 'ski' || sport === 'roller' ? 60 : 50;
  else if (durMin >= 60) carbs = sport === 'bike' ? 50 : 40;
  let water = 500;
  if (typeof tempMaxC === 'number') {
    if (tempMaxC >= 30) water += 250;
    else if (tempMaxC >= 25) water += 150;
    else if (tempMaxC <= 5) water -= 100;
  }
  const totalWater = round50(water * hours);
  return {
    carbsPerH: carbs, waterMlPerH: water,
    totalCarbs: Math.round(carbs * hours),
    totalWaterMl: totalWater,
    bottles: Math.max(1, Math.ceil(totalWater / 750)),
    needsFuel: carbs > 0,
  };
}

const litres = (ml: number): string => `${(ml / 1000).toFixed(1).replace('.', ',')} L`;

/** Message de veille de séance longue, ou null si la séance est trop courte pour en justifier un. */
export function fuelMessage(sport: Sport, durMin: number, date: string, tempMaxC?: number | null): { title: string; body: string } | null {
  if (durMin < 90 || !SPORTS[sport].outdoor) return null;
  const f = fuelPlan(sport, durMin, tempMaxC);
  const name = SPORTS[sport].name.toLowerCase();
  const bodyParts = [
    `Vise ${f.carbsPerH} g de glucides et ${f.waterMlPerH} ml d’eau par heure dans tes bidons.`,
    `Pour ${hm(durMin)} : environ ${f.totalCarbs} g de glucides et ${litres(f.totalWaterMl)} d’eau (${f.bottles} bidon${f.bottles > 1 ? 's' : ''} de 750 ml).`,
  ];
  if (durMin >= 150) bodyParts.push('Ce soir : repas riche en glucides (pâtes, riz), pas de nouveauté. Demain : petit-déjeuner glucidique 2 h 30 avant.');
  return { title: `Sortie ${name} de ${hm(durMin)} ${dateLabel(date)}`, body: bodyParts.join(' ') };
}

export interface RacePlanOut {
  hours: number;
  carbsPerH: number;
  water: number;
  totalCarbs: number;
  gels: number;
  /** Allure moyenne en minutes par km, 0 si distance inconnue. */
  pace: number;
  thirds: [number, number];
}

/** Plan de course pour un temps visé : allure, hydratation, glucides et repères par tiers. */
export function racePlan(dist: number, targetMin: number): RacePlanOut {
  const h = targetMin / 60;
  const cho = targetMin < 75 ? 20 : targetMin < 150 ? 50 : 65;
  const totalCarbs = Math.round(h * cho);
  return {
    hours: h, carbsPerH: cho,
    water: Math.round((h * 500) / 50) * 50,
    totalCarbs, gels: Math.ceil(totalCarbs / 25),
    pace: dist ? targetMin / dist : 0,
    thirds: [Math.round((dist / 3) * 10) / 10, Math.round(((dist * 2) / 3) * 10) / 10],
  };
}
