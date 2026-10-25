# NIMOVA Terrain

Application native pour téléphone et tablette, en React Native avec Expo (SDK 58), Android d'abord.
Décisions du gérant du 25 octobre 2026, prises sur l'analyse
[`docs/projet/mobile/analyse-application-mobile.md`](../../docs/projet/mobile/analyse-application-mobile.md) :
Expo, Android d'abord ; formulaires HSSEQ directement dans l'application native, sans solution
d'attente dans Rotations web ; conducteurs équipés de téléphones de service.

## État

Socle (étape 1 du phasage) et premières fiches HSSEQ du lot 1 (étape 2), sur le contrat d'API
HSSEQ de la session DESIGN (`docs/design/hsseq-contrat.md`, branche `claude/design-nimova`) et le
noyau de la session OTHER (branche `hsseq`) :

- « Ma journée » : les modules ouverts au compte selon ses profils, et la file d'envoi commune,
  chaque saisie avec son heure de saisie et son état d'envoi.
- Contrôle avant départ : véhicule pré-rempli pour le conducteur, grille de son type (citerne ou
  benne, version envoyée avec le contrôle), un point critique par écran avec des réponses de 104 dp,
  photo obligatoire sur toute non-conformité, chronomètre qui mesure sans presser, récapitulatif
  avec la conséquence (V02).
- Alcootest : réalisé ou non, résultat et lecture sur un pavé masqué ; le résultat reste dans le
  coffre du téléphone jusqu'à l'envoi, jamais dans la base ; écran protégé des captures ;
  confirmation « Alcootest fait », sans résultat.
- Déclaration en un geste : trois tuiles, photo conseillée, une phrase, position relevée sans geste.
- Fiches envoyées une à une par leur route, idempotentes par `client_uuid`, puis leurs photos
  (compressées à 1 280 px, rattachées à l'événement ou à la non-conformité du point).

Socle :

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
« faux » est refusé, un identifiant commençant par « code » demande le code 123456, un identifiant
commençant par « conducteur » ouvre le profil conducteur. Une version
publiée sans adresse d'API refuse de démarrer.

- Aperçu dans un navigateur : `npx expo start --web` (rien n'y est gardé : ni coffre, ni base).
- Sur un téléphone Android : application Expo Go, ou version de développement (`eas build`).
- Contrôles avant tout envoi : `npm run typecheck`, `npm test`, `npx expo-doctor`,
  `npx expo export --platform android` (le paquet JavaScript se construit).

Configuration : copier `.env.example` en `.env` (jamais versionné).

## Organisation

| Dossier | Rôle |
|---|---|
| `src/app/` | Écrans routés (Expo Router) : `_layout.tsx` (polices, session, connexion, file d'envoi), `index.tsx` (Ma journée), un écran par module |
| `src/accueil/` | « Ma journée », modules ouverts par profil, garde des écrans |
| `src/hsseq/` | Fiches HSSEQ : contrôle avant départ, alcootest, déclaration, appareil photo, position, envoi |
| `src/api/` | Client de l'API (jetons, renouvellement unique, délais, erreurs), types, bureau simulé |
| `src/auth/` | Coffre sécurisé, session et étapes de connexion |
| `src/store/` | Base SQLite (file d'envoi, listes gardées), règles de l'appareil partagé |
| `src/sync/` | File d'envoi commune (`Envoi.tsx`) et envoi groupé des rotations |
| `src/rotations/` | Saisie et listes des rotations |
| `src/ui/` | Jetons visuels et éléments communs |
| `__tests__/` | Tests (Jest) : client de l'API, file d'envoi, saisie, écriture française |

## Sécurité et rôles

- Code d'application `terrain` (module HSSEQ du noyau) : profils admin, hsseq, exploitation et
  conducteur, société EGUITRA GROUP, sessions longues pour l'exploitation et le conducteur. Sur un
  noyau sans module HSSEQ, `EXPO_PUBLIC_APP_CODE=mobile` ouvre l'application sous le code de
  Rotations web (admin et exploitation, Rotations seules).
- Modules par profil (`src/accueil/modules.ts`, matrice du contrat HSSEQ) : Rotations pour admin et
  exploitation ; contrôle avant départ et alcootest pour hsseq, exploitation et conducteur ;
  déclaration pour admin, direction, hsseq, exploitation et conducteur. Un module hors profil ne
  s'ouvre pas, même par une adresse directe ; le noyau refuse de toute façon le reste.
  Comptes de recette : `test.parc` (agent de parc) et `test.exploitation` ; un compte conducteur
  sera à créer avec le module HSSEQ.
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
- Écran du départ : verrou de la rotation du jour (`GET /hsseq/me/rotations`), « Départ non
  vérifié » hors réseau, jamais « autorisé » ; le passage en route reste au chef de parc au lot 1.
- Envoi en arrière-plan (`expo-background-task`), signature, mode dépôt de la tablette partagée,
  levée des non-conformités et dérogations à la tablette.
