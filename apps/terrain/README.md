# NIMOVA Terrain

Application native pour téléphone et tablette, en React Native avec Expo (SDK 58), Android d'abord.
Décisions du gérant du 25 octobre 2026, prises sur l'analyse
[`docs/projet/mobile/analyse-application-mobile.md`](../../docs/projet/mobile/analyse-application-mobile.md) :
Expo, Android d'abord ; formulaires HSSEQ directement dans l'application native, sans solution
d'attente dans Rotations web ; conducteurs équipés de téléphones de service.

## État : socle (étape 1 du phasage)

- Connexion par jetons : identifiant et mot de passe, code de double authentification ou son
  activation, remplacement d'un mot de passe provisoire. Le jeton de renouvellement est gardé dans le
  coffre sécurisé de l'appareil, le jeton d'accès en mémoire seulement.
- Ouverture sans réseau sur le profil gardé : les saisies partent au retour du réseau.
- Rotations, reprise de Rotations web (`apps/web/components/mobile/RotationsApp.tsx`), mêmes champs,
  mêmes contrôles et mêmes messages : saisie, « À envoyer », « Envoyées ». File d'envoi dans une base
  SQLite, envoi idempotent par `client_uuid` (`POST /transport/sync`) à l'ouverture, au retour du
  réseau, au retour au premier plan et toutes les deux minutes.
- Mise en page téléphone (onglets) et tablette ou paysage (saisie à gauche, listes à droite).

Pas encore branché sur la recette : la passerelle publique n'accepte aujourd'hui que les cookies du
navigateur et refuse les envois sans en-tête `Origin`. Voir « Prérequis côté serveur ».

## Lancer

```bash
npm install
npx expo start
```

Sans `EXPO_PUBLIC_API_URL`, une version de développement travaille sur un **bureau simulé**
(`src/api/simulation.ts`), signalé à l'écran : tout identifiant ouvre la session, le mot de passe
« faux » est refusé, un identifiant commençant par « code » demande le code 123456. Une version
publiée sans adresse d'API refuse de démarrer.

- Aperçu dans un navigateur : `npx expo start --web` (rien n'y est gardé : ni coffre, ni base).
- Sur un téléphone Android : application Expo Go, ou version de développement (`eas build`).
- Contrôles avant tout envoi : `npm run typecheck`, `npm test`, `npx expo-doctor`,
  `npx expo export --platform android` (le paquet JavaScript se construit).

Configuration : copier `.env.example` en `.env` (jamais versionné).

## Organisation

| Dossier | Rôle |
|---|---|
| `src/app/` | Écrans routés (Expo Router) : `_layout.tsx` (polices, session, connexion), `index.tsx` (Rotations) |
| `src/api/` | Client de l'API (jetons, renouvellement unique, délais, erreurs), types, bureau simulé |
| `src/auth/` | Coffre sécurisé, session et étapes de connexion |
| `src/store/` | Base SQLite (file d'envoi, listes gardées), règles de l'appareil partagé |
| `src/sync/` | Envoi des saisies en attente |
| `src/rotations/` | Saisie et listes des rotations |
| `src/ui/` | Jetons visuels et éléments communs |
| `__tests__/` | Tests (Jest) : client de l'API, file d'envoi, saisie, écriture française |

## Sécurité et rôles

- Code d'application `mobile` (celui de Rotations) : le noyau n'ouvre l'application qu'aux profils
  administrateur et exploitation, dans la seule société EGUITRA GROUP, et réserve les longues sessions
  hors réseau au profil exploitation seul. Un autre profil reçoit le refus du noyau à la connexion.
  Comptes de recette : `test.parc` (agent de parc) et `test.exploitation`.
- Appareil partagé : les listes d'un compte sont effacées à l'ouverture par un autre ; les saisies
  en attente restent à leur auteur et ne partent que sous sa session.
- Aucun tarif, coût ni marge gardé sur l'appareil ; pas de sauvegarde Android de l'application
  (`allowBackup: false`).
- Déconnexion confirmée ; impossible sans réseau (la session doit être fermée au bureau).

## Prérequis côté serveur

À demander à la session qui conduit l'intégration, après son audit :

1. Une entrée de la passerelle pour l'application native : `Authorization: Bearer` accepté sans
   cookie ni contrôle d'origine, et des routes de session qui rendent les jetons en JSON
   (connexion, double authentification, renouvellement, déconnexion). Le noyau reste fermé à
   internet.
2. Sans doute une application « terrain » dans `organisation.APPS` (noyau) et `lib/config.ts`
   (web), quand les modules HSSEQ arriveront.

## Suite

- Compte Expo de l'entreprise pour EAS (constructions, publication en accès restreint, mises à jour
  à distance avec `expo-updates`) : décision et compte du gérant.
- Icônes et système de conception « terrain » : session DESIGN (`docs/design/mobile/`). Les icônes
  actuelles sont celles du modèle Expo.
- Envoi en arrière-plan (`expo-background-task`), puis les formulaires HSSEQ : photos, position GPS,
  base chiffrée pour l'alcootest, mode dépôt de la tablette partagée.
