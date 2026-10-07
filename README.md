# Cap Hiver

Organisateur d'entraînement trail → ski de fond, pensé pour un étudiant : le plan se cale sur l'emploi du temps, la météo et les sorties réellement faites.

## Ce que fait l'appli

| Fonction | Détail |
| --- | --- |
| **Emploi du temps** | Colle le lien d'export iCalendar (ADE, Google Agenda, Outlook). Les semaines de partiels (mots-clés réglables) passent à −20 % de volume. Un jour à 7 h de cours ou plus n'a que du décrassage de 30′. |
| **Météo et neige** | Open-Meteo (sans clé). Pluie forte, orage, verglas ou neige annoncés : proposition de remplacer la séance (home-trainer, renfo, ski, décrassage). Environ 20 cm de neige : propose de privilégier les skis. |
| **Strava / Garmin** | Webhook Strava : la sortie réelle est importée, rapprochée de la séance prévue. Si 60 de charge prévus deviennent 130, les 3 jours suivants sont allégés. Garmin passe par la synchro Garmin → Strava. |
| **Physiologie** | Jambes, tête, sommeil (1–5). Jambes lourdes mais tête bonne : intervalles remplacés par du haut du corps. Tête cuite : version facile. |
| **Nutrition** | Veille de sortie longue : « vise 60 g de glucides et 500 ml d'eau par heure », ajusté à la température. |
| **Coach IA** | API Anthropic côté serveur, sortie contrainte par un outil, puis revalidée. Le navigateur ne peut jamais imposer de changement hors règles. |
| **Charge** | Charge estimée (puissance, FC ou effort ressenti), forme de fond (42 j), fatigue (7 j), fraîcheur. |

## Architecture

```
src/engine   logique pure : planning, charge, adaptation, suggestions (aucune dépendance)
src/lib      intégrations : iCalendar, Open-Meteo, Strava, coach, crypto
src/server   service (actions pures), validation, stockage (Postgres ou mémoire)
src/app      routes API et pages Next.js
src/components  interface React
tests        71 tests (node:test, TypeScript natif)
```

Les données d'un utilisateur forment un document JSON versionné (verrou optimiste) : un webhook Strava et un onglet ouvert ne s'écrasent pas.

## Démarrer en local

```bash
npm install
cp .env.example .env.local     # SESSION_SECRET suffit pour essayer ; sans DATABASE_URL tout est en mémoire
npm run dev
npm run check                  # typecheck + tests
```

## Déployer sur Vercel

1. Pousse le dépôt sur GitHub, puis **Add New → Project** dans Vercel.
2. Ajoute une base Postgres (Storage → Neon) : `DATABASE_URL` est injecté.
3. Variables : `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL` (voir `.env.example`). Optionnel : `ANTHROPIC_API_KEY`, Strava.
4. Le build exécute `scripts/migrate.ts` puis `next build`. La tâche quotidienne (`vercel.json`, 5 h UTC) resynchronise calendrier et météo.
5. Crée ton compte, puis mets `SIGNUP=closed` si l'appli est privée.

### Strava

1. Crée une appli sur https://www.strava.com/settings/api, domaine de rappel = ton domaine.
2. Renseigne `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN` (texte libre).
3. Abonne le webhook une fois :
```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=XXX -F client_secret=XXX \
  -F callback_url=https://TON-SITE/api/strava/webhook -F verify_token=TON_VERIFY_TOKEN
```
4. Dans Réglages, « Connecter Strava ».

### Emploi du temps ADE

Dans ADE : *Export iCalendar* → copie le lien. La fenêtre `firstDate`/`lastDate` du lien est remplacée automatiquement (7 jours passés → 150 jours à venir).

## Sécurité

Mots de passe scrypt ; session signée HMAC (cookie httpOnly) ; jetons Strava chiffrés AES-256-GCM ; contrôle d'origine sur les écritures ; limitation de débit ; téléchargement du calendrier limité aux URL https publiques (pas d'adresses privées, redirections revalidées, 5 Mo max) ; toute action du navigateur est validée côté serveur.
