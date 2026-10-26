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
- Départ : rotations du jour avec leur verrou (`GET /hsseq/me/rotations`, `POST /hsseq/lock/evaluate`),
  motifs V01 à V05 en mots simples, contrôle ou alcootest lancés depuis le motif ; hors réseau ou
  réponse de plus de 10 minutes, « Départ non vérifié », jamais « autorisé ». Passage en route par
  le chef de parc seul (`POST /transport/rotations/{id}/depart`).
- Dérogation (chef de parc) : un seul motif dérogeable, jamais V01 ni V03, justification de
  30 caractères au moins ; la demande vaut première validation et redemande le code personnel.
- Non-conformités (chef de parc, Responsable HSSEQ) : levée en ligne, code personnel redemandé,
  photo de la correction déposée d'abord (`role: "lift"`), puis citée par la levée ; la photo reste
  sur l'appareil jusqu'à la levée confirmée.
- Contrôle et alcootest lancés d'un départ : rattachés à sa rotation (`rotation_id`). Contrôle
  incomplet (points bloquants ajoutés à la grille après la saisie) : « Compléter le contrôle » sur
  les seuls points attendus (`POST /hsseq/checks/<id>/complement`), ou un contrôle complet.
- Accident : appels du chef de parc et des secours depuis la déclaration, dans l'ordre de
  l'annuaire de crise du site (`GET /hsseq/my/crisis-contacts`, gardé sur l'appareil).
- Documents (tous les profils, lot 3) : procédures en vigueur et alertes qui visent le compte
  (`GET /hsseq/my/documents`) ; une alerte se lit dans l'application, une procédure dans son
  document, téléchargé sous la session et ouvert par une application du téléphone ; l'accusé de
  lecture part par la file d'envoi avec l'heure de lecture, même sans réseau.
- Mon dossier (conducteur, lot 2) : aptitude médicale en statut seul, habilitations et leurs
  échéances, blocage du départ (V04) annoncé (`GET /hsseq/me`).
- Envoi en arrière-plan (`expo-background-task`, toutes les 15 minutes au plus) sous la session
  gardée, un seul envoi à la fois avec le premier plan.
- Code personnel : choisi après la connexion (4 à 6 chiffres, ni répétés ni suivis), empreinte salée
  au coffre ; redemandé après 5 minutes hors de l'application au téléphone, après 2 minutes sans
  geste à la tablette (préavis de 20 s, la frappe au clavier compte comme un geste) et avant une
  dérogation ou une levée ; cinq erreurs ferment la session. Verrouillé, l'écran passe au-dessus de
  toutes les fenêtres et le contenu dessous est caché au lecteur d'écran.
- Signature tracée du contrôle (facultative), envoyée avec la fiche.

Socle :

- Connexion par jetons : identifiant et mot de passe, code de double authentification ou son
  activation, remplacement d'un mot de passe provisoire. Le jeton de renouvellement est gardé dans le
  coffre sécurisé de l'appareil, le jeton d'accès en mémoire seulement.
- Ouverture sans réseau sur le profil gardé : les saisies partent au retour du réseau. Une session
  reprise au démarrage s'ouvre toujours verrouillée ; un mot de passe provisoire non remplacé
  rouvre sur son remplacement.
- File d'envoi : une coupure ou une session finie arrête l'envoi, un refus du bureau sur une saisie
  n'arrête pas les autres ; une erreur passagère (5xx, 429) ou une heure de saisie refusée
  (horloge en avance) laissent la saisie en attente ; une correction arrivée après la réception
  d'une rotation est signalée « Reçue », à corriger au bureau ; une fiche HSSEQ refusée se
  supprime de « Ma journée ». Photos orphelines balayées à l'ouverture.
- Rotations, reprise de Rotations web (`apps/web/components/mobile/RotationsApp.tsx`), mêmes champs,
  mêmes contrôles et mêmes messages : saisie, « À envoyer », « Envoyées ». File d'envoi dans une base
  SQLite, envoi idempotent par `client_uuid` (`POST /transport/sync`) à l'ouverture, au retour du
  réseau, au retour au premier plan et toutes les deux minutes.
- Mise en page téléphone (onglets) et tablette ou paysage (saisie à gauche, listes à droite).

Pas encore branché sur la recette : l'entrée native de la passerelle est prête sur cette branche
(voir « Côté serveur ») ; l'intégration passe par la recette après RH et HSSEQ.

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
| `src/hsseq/` | Fiches HSSEQ : contrôle avant départ, alcootest, déclaration, départ et verrou, dérogation, non-conformités, appareil photo, position, envoi |
| `src/api/` | Client de l'API (jetons, renouvellement unique, délais, erreurs), types, bureau simulé |
| `src/auth/` | Coffre sécurisé, session et étapes de connexion, code personnel et verrouillage |
| `src/store/` | Base SQLite (file d'envoi, listes gardées), règles de l'appareil partagé |
| `src/sync/` | File d'envoi commune (`Envoi.tsx`), envoi groupé des rotations, envoi en arrière-plan |
| `src/rotations/` | Saisie et listes des rotations |
| `src/ui/` | Jetons visuels et éléments communs |
| `__tests__/` | Tests (Jest) : client de l'API, files d'envoi, saisie, fiches HSSEQ, verrou, code personnel, modules par profil |

## Sécurité et rôles

- Code d'application `terrain` (module HSSEQ du noyau) : profils admin, hsseq, exploitation et
  conducteur, société EGUITRA GROUP, sessions longues pour l'exploitation et le conducteur. Sur un
  noyau sans module HSSEQ, `EXPO_PUBLIC_APP_CODE=mobile` ouvre l'application sous le code de
  Rotations web (admin et exploitation, Rotations seules).
- Modules par profil (`src/accueil/modules.ts`, matrice du contrat HSSEQ) : Rotations pour admin et
  exploitation ; départ pour admin, hsseq, exploitation et conducteur ; contrôle avant départ et
  alcootest pour hsseq, exploitation et conducteur ; déclaration pour admin, direction, hsseq,
  exploitation et conducteur ; non-conformités pour hsseq et exploitation ; documents pour tous ;
  mon dossier pour le conducteur. Passage en route et
  demande de dérogation : chef de parc (exploitation) seul. Un module hors profil ne
  s'ouvre pas, même par une adresse directe ; le noyau refuse de toute façon le reste.
  Comptes de recette : `test.parc` (agent de parc) et `test.exploitation` ; un compte conducteur
  sera à créer avec le module HSSEQ.
- Appareil partagé : les listes d'un compte sont effacées à l'ouverture par un autre ; les saisies
  en attente restent à leur auteur et ne partent que sous sa session.
- Aucun tarif, coût ni marge gardé sur l'appareil ; pas de sauvegarde Android de l'application
  (`allowBackup: false`).
- Déconnexion confirmée. Sans réseau (changement d'équipe), la session est oubliée sur l'appareil
  tout de suite et révoquée au bureau au premier échange réussi.

## Côté serveur

- Entrée de la passerelle pour l'application native : `apps/web/app/api/natif` (règles dans
  `apps/web/lib/natif.ts`, `npm test` dans `apps/web`). Jeton porté par l'application
  (`Authorization: Bearer`), sans cookie ; routes de session rendues avec leurs jetons ; seuls
  passent les codes `terrain` et `mobile` et les routes du compte, de `/transport/` et de `/hsseq/`.
  `EXPO_PUBLIC_API_URL` = `https://<adresse de l'application web>/api/natif`.
- Noyau : l'application `terrain` est déclarée par le module HSSEQ (`organisation.APPS`, branche
  `hsseq`) ; ses sessions sont bornées à leurs routes (`organisation.SESSION_ROUTES["terrain"]`),
  et sur une rotation à la seule action `depart`.
- Intégration : par la recette, après RH et HSSEQ (session Local).

## Suite

- Compte Expo de l'entreprise pour EAS (constructions, publication en accès restreint, mises à jour
  à distance avec `expo-updates`) : décision et compte du gérant.
- Signature par code personnel (en plus du tracé) : en attente de la Direction générale (valeur
  de la signature par code). Départ sans réseau et découpage de V05 : idem.
- Tablette en mode kiosque (gestion de flotte Android) avec les tuiles des habitués et le badge QR :
  demande une décision sur les badges et un registre côté serveur.
- Seconde validation des dérogations par le Responsable HSSEQ : écran web (session DESIGN).
