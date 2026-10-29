# État du projet EGUITRA, au 21 octobre 2026

Ce fichier est la mémoire du projet entre deux sessions de travail. Le mettre à jour à chaque fin de session.

## 1. Contexte

- Client : EGUITRA GROUP SARLU (transport d'hydrocarbures, BTP, immobilier, négoce) et MB AxisPro Consulting (cabinet d'accompagnement de porteurs de projets). Direction commune : M. Mohamed Nimaga, Directeur Général.
- Prestataire : E-VOLUTION XP, Madigbè Kouyaté, gérant, +224 628 86 22 55, emkouyate@e-volutionxp.com.
- Objet : une plateforme de gestion intégrée, deux applications métier à l'image du client (EGUITRA Finance, AxisPro Suite), un portail des porteurs de projets, une application mobile de saisie des rotations, sur un noyau Odoo Community invisible pour les utilisateurs.

## 2. Chronologie

| Date | Événement |
|---|---|
| 15 sept. 2026 | Offre initiale envoyée (deux propositions, 92 et 80 M GNF). PDF conservé dans `docs/offre/envoyes/`. |
| fin sept. 2026 | Courrier du client : proposition 1 retenue, six demandes (validité, garantie 6 mois, sauvegardes plus fréquentes, pénalités de retard, définition des évolutions incluses, prix à 40 M). |
| 29 sept. 2026 | Offre OTF-EGUITRA-2026-37 : offre unique et complète, 50 000 000 GNF HT, intégrant les six demandes. Annule et remplace l'offre du 15 septembre. Validité 30 jours, jusqu'au 29 octobre 2026. |
| 13 oct. 2026 | Réunion de cadrage tenue (support : `Reunion_de_cadrage.docx`). VPS commandé. |
| 14 oct. 2026 | VPS livré, installé et sécurisé. Dans la nuit : noyau Odoo 19 en recette, huit modules EGUITRA, applications web, sauvegardes continues avec restauration vérifiée, supervision, reprise des données, guides ; tout est déployé sur la recette. |
| 14 oct. 2026, après-midi | Production et recette séparées en deux environnements complets ; base de production `eguitra` créée (deux sociétés, administrateur `m.kouyate`) ; deux mises en production par `release.sh` ; multi-sociétés vérifié de bout en bout (un compte, deux comptabilités) ; dossier de conception en Word, guides Word par profil, cahier de recette. |
| 14 oct. 2026, fin d'après-midi | Écran Sociétés (identité, NIF, RCCM, logo, mentions légales des documents imprimés), paramétrage du courriel (`infra/mail-server.sh`), plan de bascule, copie nocturne de la recette ; quittancement automatique des loyers ; troisième revue de sécurité traitée (voir chapitre 5) ; mises en production successives par `release.sh`. |

À compléter : date d'encaissement de l'acompte, T0, date contractuelle de mise en production (T0 + 4 semaines), noms des référents.

## 3. Engagements contractuels à ne pas perdre de vue

- Périmètre : chapitres 3 et 4 de l'offre (vingt attentes du département Finance, toutes couvertes).
- Délai : 4 semaines à compter de T0 (acompte encaissé + prérequis remis). Pénalité de 0,1 % du HT par jour calendaire de retard imputable au prestataire, plafond 5 %. Les retards côté client se constatent au comité de pilotage hebdomadaire, sinon ils sont réputés nôtres.
- Garantie corrective : 6 mois à compter du PV de mise en production, couvrant la première clôture annuelle.
- Sauvegardes : perte de données maximale 15 minutes, reprise sous 4 heures ouvrées, disponibilité 99,5 %, test de restauration trimestriel.
- Support : bloquant 2 h / 8 h ouvrées, majeur 4 h / 2 jours, mineur 1 jour.
- Maintenance évolutive : 2 jours par mois inclus, cumulables par trimestre, critères au chapitre 7.4. Évolutions facturables à 750 000 GNF HT par jour-homme (tarif fixé par nous, non discuté avec le client).
- Paiement : 50 % commande, 30 % recette, 20 % PV. Forfait annuel 9 000 000 GNF HT à partir du 13e mois.
- Hors périmètre : paie, stocks, interfaces bancaires ou mobile money, ajout d'une société avec reprise, changement réglementaire majeur, montée de version majeure du noyau.

## 4. Décisions techniques et leurs raisons

### Odoo 19.0 : confirmé
Les dix modules OCA retenus s'installent proprement sur 19.0 (commits épinglés dans `infra/oca/lock.txt`) ; leurs propres tests passent (251 en anglais, un échec isolé dans `dms`, sans effet sur notre usage ; en français, seuls des libellés traduits diffèrent). La porte de sortie vers 18.0 n'est donc pas utilisée.
Les modules d'approbation `base_tier_validation` n'existent pas en 19.0 : un moteur spécifique a été écrit (`eguitra_approval`), plus simple et mieux adapté (niveaux par montant et par nature, approbateurs par profil, corbeille dans notre application, journal des décisions, contournement impossible hors du moteur).
Localisation : `l10n_gn` (plan SYSCOHADA en GNF, 1 142 comptes). À valider avec l'expert-comptable.

### Production et recette : deux environnements séparés (décision du 14 octobre)
Le gérant a délégué le choix. Retenu : deux environnements complets sur le même serveur, chacun avec
sa grappe PostgreSQL, son noyau, ses applications web, ses mots de passe et ses cookies ; seuls le
serveur et le proxy sont partagés. Raisons : une erreur, un test ou une copie de données en recette
ne peut ni toucher ni ralentir la production ; les tests (création de bases jetables) ne gonflent
plus les sauvegardes de production ; secrets distincts ; retour arrière possible. Écarté : un seul
noyau servant deux bases (code commun, une mise à jour de recette toucherait la production).

| | Production | Recette |
|---|---|---|
| Services | `db`, `odoo`, `web` (+ `backup`) | `db-recette`, `odoo-recette`, `web-recette` |
| Ports locaux | noyau 8069, web 3000 | noyau 8169, web 3100 |
| Base | `eguitra`, rôle `eguitra_app` sans superutilisateur | `eguitra_recette` |
| Code | version figée `infra/releases/current`, mise en service par `infra/release.sh` | code de travail synchronisé par `scripts/dev/sync.sh` |
| Sauvegardes | continues, hors site (dès que le stockage existe) | copie logique chaque nuit, 7 jours |

Cycle d'une évolution : `sync.sh`, tests (`infra/test.sh`, sur la grappe de recette), essais en
recette, puis `infra/release.sh` (copie figée, sauvegarde de base, mise à jour des modules, contrôle,
retour automatique au code précédent en cas d'échec ; historique dans `infra/releases/HISTORY`).
Piège rencontré : un noyau Odoo démarré sans sa base la crée d'office, vide. `up.sh` ne démarre donc
un noyau que si sa base existe, et `init-db.sh` remplace une base vide créée ainsi.

### Multi-sociétés (engagement pris auprès du client)
Les deux sociétés vivent dans la même base de chaque environnement, avec des comptabilités séparées
(vérifié en base : 1 142 comptes chacune, aucun partagé ; journaux, taxes et numérotation propres).
Un même compte peut être ouvert aux deux sociétés : sélecteur dans l'en-tête (rechargement complet de
l'écran), vue « Groupe consolidé ». L'écran Administration > Utilisateurs permet de choisir les
sociétés de chaque compte (ajouté le 14 octobre ; seule l'API le permettait). Vérifié en recette avec
`comptable.demo` (ouvert aux deux sociétés).

### Organisation des sociétés et des applications (rappel du gérant, 16 octobre)
EGUITRA GROUP SARLU et MB AxisPro Consulting sont deux entreprises différentes du même groupe (même
DG, mêmes locaux, métiers distincts) ; le département finance tient les deux comptabilités,
séparément. Règles, décrites en un seul endroit, `addons/eguitra_api/organisation.py` (pendant web :
`apps/web/lib/config.ts`) :
- EGUITRA Finance sert les deux sociétés (société de travail choisie à l'écran ; vue consolidée pour
  la direction et la finance). Ses modules métier (transport, chantiers, immobilier) ne servent
  qu'EGUITRA GROUP : menus masqués et API refusée (422 `wrong_company`) dans les livres de MB AxisPro.
- AxisPro Suite et le portail des porteurs ne servent que MB AxisPro Consulting ; Rotations, qu'EGUITRA
  GROUP. L'application y travaille toujours, même pour un compte ouvert aux deux sociétés ; un compte
  qui n'est pas ouvert à cette société ne peut pas l'ouvrir. Les routes d'AxisPro refusent de
  travailler dans EGUITRA GROUP, quelle que soit l'application qui les appelle.
- Profils et applications : un profil ouvre une ou plusieurs applications (administration et
  direction : tout ; finance : Finance ; achats : Finance, partie achats seule ; cabinet : AxisPro ;
  exploitation : Finance et Rotations ; porteur : portail). Un profil propre à une société exige que le compte y soit ouvert (exploitation,
  chantiers, immobilier : EGUITRA ; cabinet, porteur : MB AxisPro) : contrôlé à l'enregistrement du
  compte, la société est cochée d'office à l'écran.
- Nouvelle application ou nouveau module : une ligne dans `organisation.py` (APPS, MODULE_ENTITY,
  PROFILE_ENTITY) et dans `config.ts`.
- Honoraires du cabinet ventilés aussi sur l'activité « Conseil et accompagnement de projets » ; axes
  analytiques proposés selon la société (dossiers pour le cabinet ; chantiers, ensembles routiers,
  routes, biens pour le groupe).

### Architecture réalisée
- **Noyau** : Odoo 19 Community + PostgreSQL 16 (Docker Compose). N'écoute que sur 127.0.0.1 ; jamais exposé aux utilisateurs.
- **API métier dans le noyau** (`eguitra_api`) : routes `/api/v1/...` exécutées sous l'identité de l'utilisateur (droits et règles d'accès du noyau s'appliquent). Jetons opaques stockés hachés (accès 15 min, renouvellement 12 h, 30 jours pour Rotations au seul profil exploitation ; durée totale d'une session 7 jours, 90 pour Rotations), double authentification TOTP obligatoire pour tous, limitation des essais (5 échecs par identifiant depuis une même adresse, 50 toutes adresses confondues, 50 par adresse ; l'ancien mot de passe compte aussi), journal des accès 12 mois, piste d'audit (`auditlog`). Mot de passe remis par l'administrateur : provisoire, à remplacer avant tout autre accès (contrôlé par l'API elle-même). La déconnexion révoque toute la session, même jeton d'accès expiré. Adresse réelle du client transmise par la passerelle (`X-Forwarded-For` avec `X-Forwarded-Host`, sans quoi le noyau ne voit que l'adresse du conteneur web).
- **Fichiers reçus** (`eguitra_api/files.py`) : format reconnu au contenu (PDF, JPEG, PNG, DOCX, XLSX) pour la data room et les justificatifs ; macros, ZIP, .doc et .xls refusés ; nom ramené à l'extension reconnue. Quotas des dépôts du porteur (400 pièces, 1 Go par dossier, 50 messages par jour). Classeurs importés bornés (50 Mo décompressés, 20 000 lignes). Exports CSV et XLSX : un libellé ne devient jamais une formule.
- **Approbations** : la demande garde l'empreinte de la pièce soumise (tiers, compte bancaire, comptes, montants, taxes, analytique) ; une pièce approuvée, remise en brouillon et modifiée doit être approuvée à nouveau.
- **Une seule application Next.js** (`apps/web`) sert les quatre surfaces : `/finance`, `/axispro`, `/portail`, `/mobile`, chacune avec son thème (`data-app`). Raison : un seul déploiement, une seule passerelle de sécurité, des composants partagés ; les domaines (finance.*, axispro.*, portail.*) aiguillent vers la bonne surface. Remplace le découpage en quatre applications envisagé au cadrage.
- **Passerelle** : le navigateur ne voit jamais les jetons (cookies httpOnly, préfixe `__Host-` en production) ; `/api/odoo/...` relaie vers l'API avec renouvellement automatique (chemins non normalisés refusés) ; protection CSRF par Origin et Sec-Fetch-Site ; politique de sécurité du contenu (CSP) en production. Société de travail mémorisée par application ; AxisPro Suite et le portail travaillent par défaut dans la société du cabinet.
- **Rotations** : application web installable (manifeste, service worker), saisie hors réseau dans IndexedDB, envoi idempotent (`client_uuid`) dès le retour du réseau. Le tarif n'est pas saisi au parc : le noyau l'applique (tarif client, sinon tarif de la route). Le téléphone ne garde ni tarifs ni marges ; listes effacées quand un autre compte ouvre l'application ; page hors ligne et listes effacées à la déconnexion (les saisies en attente restent à leur auteur).
- **Quittancement** : tâche de nuit « EGUITRA : quittancement des loyers » (facture de chaque échéance passée, datée de l'échéance, validée aussitôt) ; la génération du module `contract`, qui laissait des brouillons, est désactivée.
- **Sauvegardes** : archivage continu des WAL (`archive_timeout` 15 min), sauvegarde de base chaque nuit, filestore toutes les 15 minutes, copie hors site chiffrée (rclone, distant `crypt`) avec les rétentions de l'offre (30 quotidiennes, 12 mensuelles, journaux sur 14 jours), contrôle de santé, test de restauration (y compris à un instant donné) vérifié le 14 octobre. Voir `infra/backup/README.md`.
- **Supervision** : `infra/monitor.sh` toutes les 5 minutes (conteneurs, API, web, disque, sauvegardes), alertes vers un webhook ou ntfy à configurer dans `.env`.
- **Journal des à-nouveaux** : code `AN`. Ses écritures forment la situation d'ouverture du tableau des flux ; la reprise des soldes d'ouverture l'utilise.
- **Proxy** : Caddy (TLS automatique), profil `proxy`, à démarrer quand les domaines pointeront vers le serveur. Client web du noyau ouvert aux seules adresses d'administration.
- Précaution d'exploitation : toujours redémarrer le noyau après installation ou mise à jour de modules (le module d'audit modifie les modèles au chargement de ses règles).

### Serveur
- Commandé : VPS-3 2027 (6 vCore, 12 Go, 100 Go NVMe), OVHcloud Gravelines (France), engagement 12 mois, Ubuntu 26.04 LTS, option de sauvegarde automatique de l'hébergeur activée (gratuite). Le VPS-4 était indisponible dans tous les centres de données.
- Écart avec l'offre : 100 Go de disque au lieu de 160. À traiter : ajouter un disque de 100 Go si l'hébergeur le propose ; sinon inscrire la configuration réelle dans le dossier de conception avec engagement d'ajouter du disque sans surcoût au besoin. Processeur et mémoire sont supérieurs à l'offre (4 vCPU, 8 Go).
- Sécurisé le 14 octobre 2026 par `infra/setup-vps.sh` : utilisateur `deploy`, SSH par clé uniquement, root interdit, pare-feu (22, 80, 443), fail2ban, mises à jour de sécurité automatiques sans redémarrage automatique, Docker et Compose du dépôt officiel, swap 4 Go, fuseau Africa/Conakry. Adresse et accès : chez le gérant, hors dépôt.
- Docker contourne le pare-feu pour les ports publiés : seuls 80 et 443 (proxy) le seront ; noyau, base et applications restent sur 127.0.0.1 ou le réseau interne.
- Outils de conversion présents sur le serveur pour vérifier les documents : images `gotenberg/gotenberg:8` (Word et Excel vers PDF) et `alpine:3.20` (pages PDF en images).

## 5. Ce qui existe dans le dépôt

| Chemin | Contenu |
|---|---|
| `infra/` | `setup-vps.sh` (sécurisation), `compose.yaml` (production et recette), `up.sh` (déploiement), `release.sh` (mise en production, retour arrière), `init-db.sh` et `admin-account.sh` (base et administrateurs, par environnement), `test.sh` (tests sur base jetable de recette), `monitor.sh` (supervision des deux environnements), `oca/` (modules OCA épinglés), `odoo/` (image et configuration), `backup/` (sauvegardes, restauration, copie de la recette), `caddy/` (proxy TLS, domaine de recette), `README.md` (exploitation). |
| `addons/eguitra_base` | Sociétés (groupe, cabinet), huit profils, sept axes analytiques, règles d'audit. |
| `addons/eguitra_api` | Cadre de l'API, authentification, double authentification, sessions, administration des utilisateurs et des sociétés (identité, NIF, RCCM, logo, mentions légales), journaux, contrôle des fichiers reçus (`files.py`). |
| `addons/eguitra_finance` | Tableau de bord dirigeant, rapport mensuel de gestion, ventes, relances clients, achats, trésorerie (import de relevés, rapprochement), tiers, écritures et virements internes, bilan, compte de résultat et tableau des flux SYSCOHADA, balance et grand livre, clôtures avec contrôles, fiscalité (TVA, export pour l'auditeur, IFRS), dette et DSCR, immobilisations (dotations automatiques, cessions), budget, alertes, 12 rapports exportables. |
| `addons/eguitra_approval` | Circuits d'approbation à plusieurs niveaux (pièces, paiements, OD), alertes de retard. |
| `addons/eguitra_transport` | Flotte, chauffeurs, routes et tarifs, rotations, facturation, rentabilité, synchronisation mobile. |
| `addons/eguitra_chantier` | Chantiers, situations d'avancement, facturation, retenues de garantie (4117) et leur libération. |
| `addons/eguitra_immobilier` | Biens, baux, loyers récurrents (module OCA `contract`) facturés et validés chaque nuit, impayés, quittances. |
| `addons/eguitra_axispro` | Politique d'évaluation versionnée (grille importée), dossiers, évaluation par gate, score, éliminatoires, recommandation, écarts, data room, comités verrouillés et comparés, rapports, temps et honoraires, portail des porteurs. |
| `addons/eguitra_portail` | Portail des porteurs (22 octobre) : communications ciblées du cabinet avec accusé de lecture, centre de ressources (rubriques, articles, guides, questions fréquentes, modèles à télécharger, recommandés selon l'étape du dossier), événements et formations (inscriptions, liste d'attente, présence), rendez-vous (demande sur créneaux, confirmation, compte rendu partagé), notifications (créées par les événements du dossier AxisPro, rappels du matin), messages lus, avis des porteurs (note et recommandation), pièces jointes aux messages ; API du porteur `/portail/...` et outils du cabinet `/axispro/portail/...`. |
| `addons/eguitra_commerce` | Achats et ventes (27 octobre) : catalogue, offres et commandes des clients (acomptes, quantités exécutées, offre de travaux vers le chantier et avance de démarrage), bons de commande fournisseur au circuit d'approbation, réceptions, rapprochement à trois voies, devis fournisseurs, tableaux de bord ; sur `sale` et `purchase`, sans stock. |
| `addons/eguitra_service_client` | Service client (29 octobre, pas encore en recette) : dossiers des demandes et réclamations par société, saisie par l'équipe, courriel entrant relevé en IMAP, WhatsApp (API Cloud de Meta), espace client en ligne, échéances en heures ouvrées et escalade, réponses types, satisfaction, fusion, tableau de bord, liens vers les fiches et HSSEQ. |
| `apps/web` | Les quatre surfaces web (33 écrans), la passerelle sécurisée, l'application Rotations hors ligne. |
| `scripts/dev/sync.sh` | Envoi du code sur le serveur de recette. |
| `scripts/recette/donnees_demo.py` | Données fictives « Démo » pour la recette (transport, achats, chantier, biens, AxisPro). |
| `scripts/reprise/` | Reprise contrôlée depuis des CSV (comptes, axes, journaux de trésorerie, tiers, soldes d'ouverture par facture, immobilisations, référentiels du transport, écritures de l'exercice avec lettrage par référence, emprunts, budget, rotations 2026), modèles de fichiers ; conversion du dossier JSON du prototype (`dossier_json.py`) et contrôle des 26 valeurs de référence (`extraire_reference.py`, `controle_reference.py`). |
| `docs/guides/` | Guides des utilisateurs par profil (direction, finance, exploitation, chantiers, immobilier, cabinet, porteur, administration) en Markdown et en Word (`word/`, générés par `build.js`). |
| `docs/projet/` | Dossier de conception (Markdown source et `Dossier_de_conception.docx` généré), cahier de recette (`Cahier_de_recette.xlsx`, 61 scénarios, généré par `cahier-de-recette.py`), plan de bascule vers la production (`Plan_de_bascule.docx`), accord de confidentialité (ajouté par une autre session), support de cadrage. |
| `docs/outils/md-docx.js` | Conversion Markdown vers Word aux couleurs du projet. |
| `docs/` | Offre contractuelle, support de cadrage, ce fichier. |

Tests : 100 tests automatisés sur les huit modules (`infra/test.sh`), tous au vert le 14 octobre à 15 h 50 ; lint Python (`ruff.toml`) et TypeScript propres, construction Next.js réussie. Parcours vérifiés dans le navigateur sur la recette : connexion avec double authentification et mot de passe provisoire, AxisPro de bout en bout (grille, évaluation avec preuves, data room, comités, honoraires), portail du porteur, Rotations hors réseau puis synchronisation, rapport mensuel, tableau des flux, relances ; après la troisième revue, connexion avec les cookies `__Host-`, politique de contenu sans violation, écrans finance et métiers.

Revues de sécurité : trois revues automatiques traitées. La troisième (14 octobre) a relevé et fait corriger : une lecture inter-sociétés dans AxisPro (pièces, revues, grilles du cabinet lisibles par un profil direction d'une autre société), des dépôts contrôlés sur le seul type annoncé, une approbation rejouable après remise en brouillon, le cloisonnement du téléphone dans Rotations, l'injection de formules dans les exports, un chemin « /./auth » de la passerelle, la déconnexion sans révocation, le blocage d'un compte par un tiers, les classeurs piégés, la piste d'audit d'un administrateur partiel, les cookies et la CSP. Compléments du même jour : écrans de fin de bail (les loyers dus sont soldés), de modification d'un bien (valorisation du patrimoine), d'annulation d'une situation de chantier, de création des comptes de banque et de caisse ; contrôles d'intégrité affichés avec recalcul réel des empreintes ; droit « Contact/Création » donné à la finance (la modification d'une fiche tiers échouait) ; guides des profils chantiers et immobilier (prévus par l'offre, manquants). Une relecture indépendante de ces correctifs a ensuite fait corriger : la formule de tableau « {=…} » encore écrite comme formule dans les exports XLSX (texte désormais écrit par `write_string`), l'adresse du client au changement de mot de passe, la déconnexion de Rotations hors réseau, et la piste d'audit des comptes multi-sociétés. En passant : le noyau ne voyait que l'adresse du conteneur web (20 échecs de connexion auraient bloqué tout le monde), le sélecteur de tiers échouait pour les profils chantiers, immobilier, exploitation et cabinet, et la tâche OCA des contrats restait active en production (corrigé par un appel rejoué à chaque mise à jour).

## 6. Les environnements aujourd'hui

- Accès : tunnel SSH `ssh -N -L 3000:127.0.0.1:3000 -L 3100:127.0.0.1:3100 eguitra-vps`, puis http://localhost:3000 (production) et http://localhost:3100 (recette), chemins /finance, /axispro, /portail, /mobile.

### Production
- Version en service : 20261022-1935 (commit c5df60b), mise en production le 22 octobre à 19 h 37 à la
  demande du gérant, sauvegarde prise avant : application web seule, modules identiques à la 20261022-1445.
  **Sécurité : Next.js 16.4.2** (la 16.4.0 avait trois failles publiées, dont deux exécutions de code à
  distance sans authentification : GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r ;
  `npm audit` à 0). Design du 22 octobre (critique en six angles : montants arrondis, billet de trésorerie,
  Transport, Rotations, AxisPro), cache `rotations-v6`, titre d'onglet « NIMOVA · MB AxisPro Consulting ».
  Contrôlé : Next 16.4.2 dans le conteneur, trois adresses HTTPS 200, santé de l'API, mfa_required à 0,
  charte EGUITRA intacte. Lancer `npm audit --omit=dev` dans `apps/web` avant chaque mise en production.
- Version précédente : 20261022-1445 (commit b5af2d9), mise en production le 22 octobre à 14 h 47 à la
  demande du gérant (« mets la correction en production », « GNF partout et mets tout en production »),
  conduite par la session RH : corrections de droits de l'audit, « MB AxisPro Consulting », charte des
  documents, devise « GNF » après le montant, noms de paie (« Paie d'octobre »), bon de livraison du
  transport. Avant : 382 tests des onze modules sans échec ni erreur, répétition sur une copie de la
  base de production sans erreur. Contrôlé : onze modules à jour (eguitra_base 19.0.1.7.0,
  eguitra_axispro 19.0.1.4.0, eguitra_rh 19.0.1.0.2), sociétés renommées, grille AxisPro en vigueur
  inchangée (SC-01 version 1, 8 compartiments), paramètres de connexion inchangés, aucune erreur au
  noyau. Charte EGUITRA (logo, couleurs) réglée ensuite par la session Local.
- Version précédente : 20261022-1213 (commit 9b95835), mise en production le 22 octobre à 12 h 14 à la demande du gérant, après vérification (code du serveur identique au commit, modules identiques à la production, six espaces contrôlés sur la recette sans erreur ; sauvegarde prise juste avant) : application web seule, page de connexion du portail sur photo, harmonisation des composants (états communs, confirmations NIMOVA, aplats, Analyse en or bronze), œil des champs de mot de passe, cache `rotations-v5`. Modules inchangés depuis 20261022-1030 (RH, voir plus bas) ; double authentification toujours suspendue. Version précédente du matin : 20261022-1012 (commit e396cf6), mise en production le 22 octobre à 10 h 13 (sauvegarde prise à 10 h 12) : outil de scoring v3 et compartiments AxisPro, grille AxisPro importée et en vigueur, portail des porteurs (`eguitra_portail` installé), application Transport, profil Achats et saisie libre enfin appliqués dans les écrans (passerelle `/auth/me`), design. Dix modules ; `eguitra_rh` pas encore installé. Détail au chapitre 7 (22 octobre).
- Base `eguitra`, deux sociétés « EGUITRA GROUP SARLU » et « MB AxisPro », vide de données (en attente de la reprise). Version précédente : 20261021-1655 (commit 574b21d : le module ouvert depuis l'accueil reçoit la société affichée, et Analyse passe d'elle-même dans les livres de la section demandée quand le compte y est ouvert ; défaut signalé par le gérant, Pipeline ouvert depuis l'accueil sur MB AxisPro affichait EGUITRA), mise en production le 21 octobre à 16 h 56, sauvegarde prise juste avant. Versions précédentes du jour : 20261021-1645 (commit 7fb8cf3 : nouvelle page de connexion de la session design, photo d'équipe ; verrou du mot de passe commun de la recette, inactif en production), 20261021-1536 (commit 8cf57ee : logo NIMOVA « le pli », icônes et cache `rotations-v3` de Rotations ; application web seule, aucun module changé), mise en production le 21 octobre à 15 h 36 à la demande du gérant (sauvegarde prise juste avant) ; noyau et applications répondent, page de connexion contrôlée en HTTPS. Version précédente : 20261021-1505 (commit 63bf889 : profil Achats, libellés « MB AxisPro » et « BTP » avec migration d'`eguitra_base` 19.0.1.4.0, conventions d'amortissement des biens repris, `eguitra_finance` 19.0.1.7.0), mise en production le 21 octobre à 15 h 05 après 315 tests au vert sur les neuf modules (sauvegarde prise juste avant) ; noyau et applications répondent. Adresses publiques provisoires en HTTPS, en attendant nimova.gn : https://finance.178-33-206-212.sslip.io, https://axispro.178-33-206-212.sslip.io, https://portail.178-33-206-212.sslip.io (recette : https://recette.178-33-206-212.sslip.io). Versions précédentes : 20261021-1303 (direction visuelle « papier-valeur », menus du haut, bandeau des dossiers AxisPro), 20261021-1218 (export Excel d'Analyse, correctif de la page de changement du mot de passe ; le même code avait été mis en production six minutes plus tôt par une autre session, 20261021-1212 : à l'avenir une seule session pour la production), 20261018-0806 (NIMOVA · Analyse), 20261017-2328 (finance 19.0.1.5.0, transport 19.0.1.2.0 ; `monitor-install.sh` relancé), 20261014-1548 ; historique : `infra/release.sh --list`.
- Double authentification suspendue le 21 octobre à la demande du gérant, pendant la prise en main des comptes du client (même paramètre que la recette). Écart à l'offre (chapitre 5.3) : **à rétablir avant la reprise des données réelles** (paramètre à 1, puis redémarrage du noyau).
- Tâches de nuit actives : quittancement des loyers, dotations aux amortissements, relances des clients, purges (jetons, journaux d'accès, tentatives). La génération du module `contract` est désactivée.
- Identité des sociétés (adresse, NIF, RCCM, logo) à saisir dans Administration > Sociétés dès réception des informations du client : elles figurent en tête et au pied des factures.
- Super administrateur `emkouyate` (Madigbè Kouyaté, E-VOLUTION XP), créé le 15 octobre à la demande du gérant : tous les profils internes (administration, direction, finance, exploitation, chantiers, immobilier, cabinet), deux sociétés, mot de passe provisoire choisi par le gérant, à remplacer à la première connexion avec l'activation de la double authentification. Contrôlé le 16 octobre : compte actif, mot de passe définitif choisi, double authentification activée, aucun échec de connexion, noyau et applications de production en service.
- Administrateur `m.kouyate` (Madigbè Kouyaté), ouvert aux deux sociétés. Mot de passe provisoire dans `~/eguitra/infra/secrets/production-admin.txt` sur le serveur (lisible du seul utilisateur `deploy`) : à la première connexion, activer la double authentification puis choisir le mot de passe ; supprimer ensuite ce fichier.
- Comptes du client (21 octobre, liste reçue par le gérant) : sept comptes, identifiant = adresse
  électronique professionnelle, créés par `scripts/comptes/comptes.py` (liste dans
  `infra/secrets/comptes-client.json` du serveur, jamais dans le dépôt) : direction (deux sociétés),
  finance (deux sociétés), achats (EGUITRA GROUP), exploitation et cabinet (deux sociétés), deux comptes
  cabinet (MB AxisPro, dont un en attendant le module RH annoncé pour plus tard), exploitation (EGUITRA
  GROUP). Mots de passe provisoires dans `infra/secrets/comptes-client-production.tsv` (lisible du seul
  utilisateur `deploy`) ; à la première connexion : nouveau mot de passe et double authentification.
  Relancer le script avec la liste complète met à jour profils et sociétés sans toucher aux mots de
  passe existants.
- 22 octobre, à la demande du gérant (confirmé ensuite : « oui Bintou Nimaga gère le personnel ») : la
  responsable RH reçoit le profil « Ressources humaines »,
  ouvert aux deux sociétés (gestion RH commune), à la place du profil cabinet provisoire ; mot de
  passe inchangé. Liste du serveur mise à jour (copie de l'ancienne gardée à côté, `.bak`), script
  lancé sur ce seul compte.
- Restauration de la base de production vérifiée le 14 octobre (sauvegarde de 13 h 21).

### Recette
- Base `eguitra_recette` (grappe `db-recette`), huit modules installés, données de démonstration chargées (fictives, repérées « Démo »). Grille AxisPro en vigueur depuis le 17 octobre : la grille officielle MB AxisPro (111 critères, version 2) ; les dossiers de démonstration antérieurs restent sur la grille de démonstration de 10 critères (version 1).
- Compte d'administration de recette `recette.admin` : mot de passe et clé de double authentification dans `infra/.env` du serveur (`RECETTE_ADMIN_PASSWORD`, `RECETTE_ADMIN_TOTP`, à saisir dans une application d'authentification), jamais dans le dépôt. Il dispose aussi des profils cabinet et exploitation pour les démonstrations.
- Compte porteur de démonstration `porteur.demo` (« Démo - Porteur Briqueterie de Kindia »), rattaché au seul dossier AX/2026/0002, profil porteur, ouvert au portail uniquement (AxisPro Suite et Finance refusés, vérifié le 16 octobre) : mot de passe définitif `RECETTE_PORTEUR_PASSWORD` dans le même fichier ; double authentification remise à zéro le 16 octobre, à activer à la première connexion (code QR).
- Compte `emkouyate` présent aussi en recette (mot de passe provisoire, double authentification à activer).
- Comptes de test pour les utilisateurs réels (16 octobre) : test.dg (direction, deux sociétés), test.daf et test.comptable (finance, deux sociétés), test.exploitation et test.parc (exploitation, EGUITRA GROUP), test.chantiers, test.immobilier (EGUITRA GROUP), test.consultant (cabinet, MB AxisPro), test.admin (administration, deux sociétés), test.porteur (portail, dossier « Unité de séchage de mangues (démo) »). Créés par scripts/recette/comptes_test.py (recette seulement) ; mots de passe provisoires dans infra/secrets/comptes-test-recette.tsv du serveur (lisible du seul utilisateur deploy), double authentification à activer à la première connexion. Accès vérifiés : chaque compte n'ouvre que ses applications. Guide des testeurs (docs/projet/Guide_des_testeurs.docx) et fiche de retours (docs/projet/Fiche_de_retours.xlsx) remis au gérant.
- Double authentification désactivée sur la recette le 16 octobre, à la demande du gérant, pendant la période de test (paramètre `eguitra_api.mfa_required` = 0 de la base de recette ; noyau redémarré, les processus gardaient l'ancienne valeur en cache). La production la garde obligatoire. À rétablir en fin de tests : paramètre à 1, puis redémarrage de `odoo-recette`.
- Compte `comptable.demo` (profil finance, ouvert aux deux sociétés) pour montrer le multi-sociétés : `RECETTE_COMPTABLE_PASSWORD` et `RECETTE_COMPTABLE_TOTP`.
- Sauvegardes de la production actives en local ; copie hors site en attente du stockage objet.
- 22 octobre : corrections de droits issues de l'audit (`docs/projet/audit-roles-2026-10-22.md`), décidées par le gérant (carte blanche), en recette avec le renommage « MB AxisPro Consulting », la lettre de relance en PDF et le logo d'EGUITRA GROUP (commit 8fc70a7). Tests : 380 sur les onze modules (deux échecs corrigés puis finance, approbations et RH 170/170). Règles : un compte ne tranche qu'une étape d'une même demande ; personne ne modifie son propre dossier, ses éléments de paie ni ses avances ; la paie n'est validée que par la direction, jamais par un compte qui l'a préparée ou qui a modifié pendant sa préparation une donnée qui y entre (dossier, éléments, avances, absences non rémunérées), champs protégés dans le modèle ; aucune auto-approbation d'absence, direction comprise ; AxisPro : évaluation réservée au consultant du compartiment (compartiment libre ouvert, responsable du dossier sur tout), affectation par le responsable (un consultant peut prendre un compartiment libre), décision du comité et passage forcé à deux personnes au moins, réouverture par un autre que le verrouilleur, facture d'honoraires au seul cabinet, rattachement d'un porteur d'un autre promoteur refusé ; écrans alignés sur ces droits (accueil de Finance par profil, commandes masquées). Comptes de test ajoutés : test.rh, test.salarie (Mon espace seul), test.achats. Production : en attente du feu vert du gérant. Restent de l'audit : tests de refus BTP et immobilier, modèles RH enfants sans règle de société, droits de suppression de l'exploitation sur les tarifs, dossiers visibles de tout le cabinet (à trancher), archivage du compte `m.kouyate` en production (refusé par le contrôle de sécurité de la session, à faire par le gérant).

## 7. Prochaines étapes

### 29 octobre 2026 : chaîne documentaire du transport (branche transport-documents, ni recette ni production)

- Demande du client (documents d'une opération d'un autre logiciel, message vocal : « les documents doivent apparaître lorsqu'on finit de remplir les informations »), carte blanche du gérant. eguitra_transport 19.0.1.8.0, qui dépend désormais d'eguitra_approval. Les documents du client ont servi de modèles, rien n'en est versionné.
- Ordre de transport (OT/année/0001) : commande du client (type de prestation, marchandise, quantité en litres, kg ou t, poids, valeur, assurance, documents joints, origine et destination, destinataire réel, adresse de facturation, référence du client), états brouillon, validé (pièce signée jointe), exécuté et clôturé d'eux-mêmes au fil des opérations, annulé. Choix : l'OT tient lieu de dossier (pas de « DO » distinct, sans contenu propre dans le transport d'hydrocarbures) ; son numéro est repris sur tous les documents.
- Ensemble routier en tracteur et remorque (eguitra.transport.unit, numéro de parc et immatriculation) : l'ensemble reste l'unité des relevés, des charges, de l'analytique et d'HSSEQ ; une remorque rattachée à un autre ensemble quitte le précédent ; la rotation garde les engins qui ont roulé (facture : leurs immatriculations ; capacité : celle de la remorque). Migration : un tracteur et, s'il y a citerne, une remorque par ensemble (numéro de parc = code de l'ensemble, à corriger dans Flotte), rotations rattachées par SQL. Convoyeur (fonction du personnel roulant), dates prévues ETD, ETA, ETR, volume prévu.
- Ordre de mission (OM) : plan de voyage pré-rempli depuis la route (départ, étapes types, destination, retour), mention aux autorités réglable ; distinct du plan de trajet d'HSSEQ. Budget de voyage (BV) : initial pré-rempli (jours × frais de route par jour, litres = aller-retour × consommation de l'ensemble au prix de la flotte, péages), additifs motivés, rubriques paramétrables, approbation par eguitra_approval (nature « Budgets de voyage » : finance dès 0, direction au-delà de 20 M GNF, seuils sur le cumul de l'opération), bons carburant BCA émis à l'approbation et rapprochés de la facture de la station, avance en caisse au compte 4213 (frais avancés au personnel ; à défaut 4211), justification avec pièces, clôture (reliquat en caisse, opération diverse des dépenses au crédit du compte d'avances, montants réels à la place des coûts déclarés de la rotation, écarts). Lettre de voiture (LV) : colis, chargement, livraison, transitaire, réception qui fixe le volume livré (une seule saisie), avarie, visa, immobilisation au-delà de la franchise (2 jours) facturable par client, consignes au chauffeur réglables. Panneau « Documents » (prêt ou ce qui manque) et un PDF pour tout, au gabarit de la société. Vigilances de départ T02 et T03 (jamais bloquantes) pour une opération d'OT.
- Revue de sécurité intégrée : seuils sur le cumul de l'opération ; aucune sortie de caisse sans approbation (dépassement de l'avance : clôture refusée au-delà de la tolérance, additif de régularisation soumis au circuit dans la tolérance) ; quatre yeux (auteurs des dépenses écartés de l'approbation et de la clôture, approbateur d'un complément ne le décaisse pas) ; rattachement à un OT contrôlé à l'écriture.
- Écrans : Transport > Ordres de transport, fiche de l'opération (/transport/operations?id=…), Budgets de voyage, Lettres de voiture, Bons carburant, tracteurs et remorques dans Flotte, réglages dans Paramètres ; Finance > Comptabilité > Budgets de voyage ; Rotations au téléphone : convoyeur et remorque (cache rotations-v9).
- Tests écrits, pas encore joués (7 fichiers, 41 tests, le dernier couvrant 48 routes sur chaque profil refusé : ordre de transport, tracteur et remorque avec la migration, ordre de mission, budget de voyage, lettre de voiture, documents, droits par profil sur chaque route). Hypothèses sur le noyau 19 : la ligne de relevé créée avec counterpart_account_id est comptabilisée d'office ; les rapports rendus en HTML en mode test ; séquences à plages annuelles (%(range_year)s) ; routes statiques prioritaires sur les routes à paramètre de même profondeur. Contrôles locaux passés (ruff, compilation, XML, tsc).
- À faire : `scripts/dev/sync.sh`, `-u eguitra_transport,eguitra_approval` en recette puis redémarrage du noyau ; `infra/test.sh eguitra_base eguitra_api eguitra_finance eguitra_approval eguitra_transport eguitra_hsseq` ; `scripts/recette/donnees_demo_transport_documents.py` ; cahier 03 partie G (17 scénarios, onze cahiers, 452 scénarios) ; production par `infra/release.sh` avec l'accord du gérant.
- À régler à la mise en service (Transport > Paramètres et Flotte) : rubriques et leurs comptes de charge (à valider avec l'expert-comptable : 6053 carburant, 6384 missions, 618 péages, 6242 pneus et dépannage) ; frais de route par jour et étapes types de chaque route ; consommation de chaque ensemble ; stations carburant (fiches fournisseurs) et station habituelle ; compte des avances (4213 proposé, à valider) et caisse ; tolérance de complément (0 par défaut) ; franchise d'immobilisation (2 jours) et clients dont l'immobilisation est facturée, avec leur tarif journalier ; préfixes OT, OM, BV, LV, BCA si le client continue une numérotation ; mention aux autorités, consignes au chauffeur, signataires ; numéros de parc réels des tracteurs et des remorques. Seuils du circuit des budgets (Finance > Administration, règles d'approbation).
- Reportés : réouverture d'un budget clôturé (contre-passation à faire par la finance), PDF d'un budget seul, bon carburant imprimé à part, lien automatique entre plan de voyage et plan de trajet d'HSSEQ, numéro d'opération dans l'application mobile.
### 29 octobre 2026 : HSSEQ, politiques et procédures HSE (branche `hsseq-politiques`, ni recette ni production)

- Demande du client (message vocal du 29/10, « la partie HSE : les politiques et les procédures »), carte blanche du gérant. Le modèle des procédures devient le référentiel documentaire HSE (eguitra_hsseq 19.0.1.3.0) : types politique, procédure, instruction de travail ou mode opératoire, consigne, formulaire ou modèle ; références proposées par type (POL-HSE-001, PR-HSE-001, IT-HSE-001, CS-HSE-001, FO-HSE-001) ; hiérarchie (une procédure met en œuvre une politique, une instruction sa procédure, une consigne ou un formulaire une procédure ou une instruction) ; écran « Politiques et procédures » de Documents et urgences, en liste ou en arbre, filtres de type, de domaine, de site et d'état, onglets « À approuver » et « Revue en retard ».
- Politique : engagement de la direction (texte) et objectifs chiffrés reliés si besoin aux indicateurs du cockpit (valeur sur douze mois, dans la portée du lecteur) ; version soumise puis approuvée par un compte Direction hors administration, jamais par un rédacteur (création ou modification du contenu) ni par qui l'a soumise (quatre yeux) ; refus motivé, retrait ; nom et date de l'approbateur imprimés sur le document à afficher (PDF au gabarit de la société). Autres types : même cycle, approbation par le Responsable HSSEQ (seconde personne si le réglage le demande), publication d'un geste gardée.
- Revue périodique : prochaine revue à la mise en vigueur (politique 12 mois, procédure, instruction et consigne 24, formulaire 36, réglables par type et par document), alerte 30 jours avant au Responsable HSSEQ, au responsable du document et, pour une politique, à la direction, puis chaque semaine de retard ; revue tracée (reconduit, ou nouvelle version préparée en brouillon) et action du plan d'actions (origine « Document HSE »). Tableau de bord : en vigueur par type, revues, versions à approuver, lecture par document et par site, accusés manquants par personne (jamais pour l'auditeur), export Excel. Cockpit et revue de direction : revues en retard, politiques en vigueur.
- Diffusion : public visé et accusé de lecture comme les procédures ; les politiques passent dans « À lire » et sur NIMOVA Terrain (même route, texte et objectifs ajoutés, écran Documents de l'application mis à jour) ; le PDF à afficher n'est pas ouvert à la session de Terrain.
- Migration : procédures existantes au type « procédure », versions publiées notées approuvées et soumises par leur publicateur, prochaine revue fixée (publication + périodicité des procédures), réglages des sociétés complétés. Revue de sécurité automatique traitée (quatre yeux sur chaque modificateur, objectifs dans la portée du lecteur).
- Tests écrits (test_policies, 8 tests : types et hiérarchie, approbation et quatre yeux, modificateurs, revue et alertes, diffusion et tableau de bord, PDF, portée des objectifs, refus par profil et non-régression), à lancer sur le serveur : `infra/test.sh eguitra_hsseq` (avec eguitra_api et eguitra_base pour la piste d'audit). Contrôles locaux passés : ruff, compilation, XML, tsc de l'application web ; Terrain : syntaxe seule (pas de node_modules). Données de démonstration : POL-HSE-DEMO-01 approuvée par test.dg, PR-HSE-DEMO-01 rattachée, revue dans vingt jours (`scripts/recette/donnees_demo_hsseq.py`). Cahier 09 HSSEQ : partie J, HSE-59 à HSE-68 (68 scénarios). Contrat d'API : section 17 de `docs/design/hsseq-contrat.md`.
- À faire par la session principale : fusion, `infra/test.sh`, `-u eguitra_hsseq` en recette puis redémarrage du noyau, données de démonstration, essais du cahier, production avec l'accord du gérant. Reporté : échéances de revue dans l'Agenda, PDF à afficher depuis NIMOVA Terrain, signature manuscrite scannée.
### 29 octobre 2026 : service client (branche `service-client`, ni recette ni production)

- Décisions du gérant (29/10) : demandes et réclamations des clients des deux sociétés (pas de gestion clientèle), canaux saisie par l'équipe, courriel, espace client en ligne et WhatsApp ; dossiers séparés par société comme la comptabilité. Nouveau module `eguitra_service_client` 19.0.1.0.0 (seizième module, sur `eguitra_finance` et `mail`), application NIMOVA · Service client (`/service-client`) et application externe « Espace client » (`/espace-client`), inscrites dans APPS avec `model`. Profils (eguitra_base 19.0.1.12.0) : « service_client » (agent, deux sociétés possibles) et « client » (utilisateur du portail, exclusif comme le porteur) ; l'administration et les agents traitent tout, la direction lit tout et traite ce qui lui est confié, les métiers (finance, exploitation, BTP, immobilier, cabinet) ne voient et ne traitent que les dossiers confiés à eux ou à leur équipe ; l'agent ouvre aussi l'agenda et la discussion.
- Contenu : dossiers SC/EG/AAAA/NNNN et SC/MBAX/AAAA/NNNN (compteur annuel), client (tiers) ou contact non client rattachable, canal, catégorie paramétrable (neuf préchargées, activité, délais propres, équipe, nature HSSEQ), type, priorité, pièces, fiche liée sans dépendance (facture, rotation, bail, bien, chantier, dossier AxisPro, offre) ; états nouveau, assigné, en cours, en attente du client (horloge arrêtée), résolu, clos, rouvert ; échéances de première réponse et de résolution en heures ouvrées (lundi à vendredi, 8 h à 17 h réglables, jours fériés de la RH, le plus court de la priorité et de la catégorie) ; escalade au responsable dès le dépassement puis à la direction après 4 heures ouvrées (réglable), notifications dans l'application et par courriel ; fil : réponses au client par le canal du dossier, notes internes jamais visibles du client, événements ; réponses types à variables ; accusé de réception ; satisfaction (1 à 5 et commentaire) demandée par le même canal (lien du courriel, chiffre en WhatsApp, formulaire de l'espace client, saisie de l'agent au téléphone) ; fusion des doublons ; clôture d'office des dossiers résolus (7 jours) ; piste d'audit des dossiers, du fil, des réglages, catégories, équipes, réponses types et invitations (empreintes exclues).
- Courriel entrant : relève IMAP par la plateforme (une boîte par société, identifiants dans l'environnement du noyau, tâche de 5 minutes), plutôt que le serveur entrant du noyau (mot de passe en base, fil du noyau). Idempotence par l'identifiant du message ; rattachement par les en-têtes de réponse ou la référence [SC/…] de l'objet ; expéditeur vérifié seulement s'il est un contact de la société authentifié par notre serveur de réception (en-tête du dessus, authserv-id réglé, DMARC ou DKIM du domaine de l'expéditeur, un seul From) ; sinon dossier « expéditeur non vérifié », jamais rattaché au tiers ni à un dossier existant, sans réponse automatique ; boucles, rebonds, absences et envois en nombre refusés (journal), 20 messages par heure et par expéditeur ; pièces bornées (5, 10 Mo, PDF, images, Word, Excel reconnus au contenu).
- WhatsApp (API Cloud de Meta) : adresse publique `/api/whatsapp/webhook`, route de l'application web qui relaie au noyau le corps brut et la signature, sans détenir de secret ; le noyau, seul détenteur du secret, contrôle X-Hub-Signature-256 avant toute lecture (non signé : 401), vérifie le jeton de vérification, ignore un message déjà reçu, rattache au dossier ouvert du numéro (sinon nouveau dossier, numéro inconnu : non vérifié) ; envoi en texte dans la fenêtre de 24 heures, modèle approuvé au-delà (le message part à la réponse du client), refus clair sans modèle ; médias et envois automatiques par une tâche, téléchargement borné (hôtes de Meta, types, 10 Mo, format reconnu, messages vocaux Ogg acceptés). Identifiants dans l'environnement du noyau (compose.yaml, infra/.env.example ; RECETTE_… pour la recette).
- Espace client : comptes créés par un agent ou l'administration, sans inscription libre ; invitation par courriel (lien haché, 72 heures, usage unique ; lien remis une fois à l'agent sans serveur de courrier, pour un compte jamais connecté), réinitialisation d'un compte déjà utilisé par son seul courriel, code de double authentification exigé si elle est activée ; un compte n'est retrouvé que par son identifiant, jamais repris s'il est interne ou d'une autre société, rattaché à un autre tiers sur confirmation de l'agent ; le client voit les dossiers de son tiers (et de ses contacts), dépose, joint des pièces, répond, confirme la résolution, note ; jamais les notes, les échéances ni le responsable au-delà de son prénom ; dépôts bornés.
- Tableau de bord (ouverts par état, priorité, catégorie, canal, responsable ; délais moyens ; retards ; satisfaction ; réclamations par client et par activité ; exports XLSX et CSV) ; échéances `/service-client/deadlines` pour l'agenda ; réclamation de qualité qui crée ou rejoint la réclamation client d'HSSEQ si le module est installé. Deux revues de sécurité traitées pendant le développement (usurpation de l'expéditeur, DMARC lié au domaine, prise de contrôle d'un compte par l'invitation).
- Tests : 86 tests écrits (calendrier, parcours, échéances, escalade, satisfaction, fusion, audit ; courriel et WhatsApp simulés sans réseau ; espace client ; refus par profil de chaque route ; séparation des sociétés ; liens et HSSEQ), pas encore joués sur une base Odoo. Hypothèses sur le noyau 19 : `all_group_ids` (repli `group_ids`), `mail.mail` avec `headers` (repr d'un dictionnaire), `message_id` et `references`, `res.users.login_date` tiré de `res.users.log`, `_check_credentials` de type totp, `ir.cron._trigger()`, `registry.in_test_mode()`, `freezegun`. Contrôles locaux passés (ruff, compilation, XML, tsc). Données de démonstration : `scripts/recette/donnees_demo_service_client.py` ; comptes test.serviceclient, test.client, test.client.cabinet (`comptes_test.py`). Cahier de test : `12-service-client.md`, 54 scénarios (douze cahiers, 489 scénarios) ; guide des testeurs mis à jour.
- À faire : en recette, `scripts/dev/sync.sh`, `-u eguitra_base,eguitra_api,eguitra_agenda,eguitra_chat -i eguitra_service_client` puis redémarrage du noyau ; `infra/test.sh eguitra_base eguitra_api eguitra_finance eguitra_agenda eguitra_chat eguitra_hsseq eguitra_commerce eguitra_service_client`, puis la série complète (listes d'applications des comptes changées) ; `comptes_test.py`, puis `donnees_demo_service_client.py` ; web reconstruit (`next build`) ; production par `infra/release.sh` (module dans MODULES) avec l'accord du gérant. Reportés : lien d'un client vers ses factures depuis l'espace client, recherche plein texte, gestion clientèle (prospects, affaires), source « service client » dans l'agenda (l'échéancier est exposé, l'agenda ne le lit pas encore).
- À régler à la mise en service : boîtes de courriel du service client par société (adresse dans les réglages, identifiants SC_IMAP_… sur le serveur), identifiant du serveur de réception (SC_MAIL_AUTHSERV_ID ou réglage, ce serveur devant retirer les en-têtes qui le prétendent) et serveur d'envoi (`infra/mail-server.sh`) ; compte Meta Business vérifié, numéro WhatsApp de chaque société, application Meta (jeton d'accès permanent, secret, jeton de vérification), modèle de message approuvé (deux paramètres : nom du client, numéro du dossier) ; adresse publique du site en https (réglages, et adresse de notification déclarée chez Meta : https://…/api/whatsapp/webhook) ; catégories, délais, équipes et réponses types réels ; comptes de l'espace client des premiers clients.

### 29 octobre 2026 : menu « Achats et ventes » (version 20261029-1050)

- Le gérant ne trouvait pas les achats en recette : les écrans n'étaient que des onglets de Ventes et d'Achats et dépenses. Rubrique « Achats et ventes » ajoutée au menu de Finance (offres, commandes clients, bons de commande, catalogue, tableaux des ventes et des achats), en recette puis en production (version 20261029-1050, sauvegarde 20261029T1050 prise avant ; changement de l'application web seule).
- Recette : compte test.achatvente (profils finance et achats, deux sociétés) pour parcourir le cahier 11 d'un seul compte ; les scénarios à deux personnes gardent test.daf et test.achats. Cahier 11 envoyé au gérant.

### 27 octobre 2026, 21 h 30 : Achats et ventes en production (version 20261027-2132)

- En production : version 20261027-2132 (code 9903b18), sauvegarde prise avant (20261027T2132), carte blanche du gérant. Contenu : module eguitra_commerce (quinze modules ; sale et purchase d'Odoo installés, sans stock), eguitra_chantier 19.0.1.1.1 (déduction de l'avance de démarrage dans les situations). Offres OF/EG et OF/MBAX, commandes et acomptes, offre de travaux vers chantier, bons de commande BC, réceptions REC, rapprochement, comparaison de devis, tableaux de bord, dans Finance.
- Vérifications : premier passage sur Odoo, deux défauts corrigés (avance de démarrage calculée sur un chantier sans situation facturée, import du catalogue avec une recherche par référence vide) ; 318 tests ciblés puis série complète de 928 tests sans erreur ; recette mise à jour (données de démonstration : catalogues, offres, acomptes, bons de commande, réception partielle et écart) ; offre PDF relue (gabarit de la facture, « Référence offre », « Validité offre », montant en lettres) ; droits vérifiés (achats et exploitation : bons de commande seuls ; RH et porteur refusés) ; répétition réussie ; après la mise en production, quinze modules, noyau, web et sauvegardes sains.
- À régler à la mise en service : catalogue réel (import CSV ou XLSX), validité des offres, tolérance du rapprochement (2 % par défaut), règle des trois devis (désactivée), compte des acomptes (4191), séquences OF, BC et REC par société. Location de véhicules (dans Transport, avec les ressources de l'agenda) et stocks : reportés, à décider.
- Cahiers de test : onze cahiers, 435 scénarios (10 Agenda, 11 Achats et ventes) ; guide des testeurs mis à jour (HSSEQ, agenda, achats et ventes, comptes test.hsseq, test.auditeur, test.conducteur, connexion de repli).

### 27 octobre 2026, 19 h 30 : Agenda en production (version 20261027-1926) ; Achats et ventes en tests

- En production : version 20261027-1926 (code fc98ac8), sauvegarde prise avant (20261027T1926), carte blanche du gérant. Contenu : module eguitra_agenda (NIMOVA · Agenda, quatorze modules) : agendas personnels, d'équipe et de ressources, récurrence, invitations, partage en trois niveaux, délégation (« par … pour le compte de … »), heures de travail et recherche de créneau, planning d'équipe, absence du bureau, rappels et récapitulatif, échéances des modules bornées aux droits, abonnement iCal et import ICS, prise de rendez-vous (fermée par défaut).
- Sécurité : deux revues automatiques traitées avant la recette (droits sur les séries et l'import ICS, règles de récurrence bornées, invitation par courriel limitée aux sociétés communes, conflits limités aux disponibilités lisibles, recherche par adresse en égalité, adresse portée par plusieurs comptes traitée en invité externe).
- Vérifications : 103 tests de l'agenda (trois tests corrigés au premier passage : créneau, absence du bureau, conflits), puis série complète de 895 tests sans erreur ; recette mise à jour (agenda installé, délégation de test.dg à test.daf) ; contrôle des routes par profil (porteur et conducteur refusés) ; répétition réussie ; après la mise en production, quatorze modules, noyau, web et sauvegardes sains.
- À régler à la mise en service de l'agenda : déclarer les vraies salles, véhicules et équipements (Agenda > Ressources) ; serveur de courrier pour les invitations ICS ; prise de rendez-vous en ligne seulement si le gérant le décide.
- Achats et ventes (décision du gérant, carte blanche, 27/10) : module à part, eguitra_commerce, écrans dans Finance ; socle sale et purchase d'Odoo sans stock ; offres, commandes et acomptes, offre de travaux vers chantier avec avance de démarrage déduite des situations, bons de commande, réceptions, rapprochement, comparaison de devis. Fusionné (a3aa705e), tests en cours sur la recette. Location de véhicules et stocks reportés.

### 27 octobre 2026, 13 h : factures et états au modèle du client en production (version 20261027-1301)

- En production : version 20261027-1301 (code 1590b1e), sauvegarde prise avant (20261027T1301), carte blanche du gérant (27/10). Contenu : factures et avoirs au modèle du client (eguitra_base 19.0.1.11.0), états SYSCOHADA au modèle du système normal et comparatifs du premier exercice (eguitra_finance 19.0.1.11.0), tableau des rotations sur la facture et N° de bon (eguitra_transport 19.0.1.7.0), correctifs HSSEQ du cahier de test (eguitra_hsseq 19.0.1.2.3), contrôle des sauvegardes corrigé (conteneur backup sain).
- Correctifs ajoutés à l'intégration : modification d'un brouillon de facture des rotations dans Ventes sans perte du lien à la rotation (source_line_id, _eguitra_kept_on_edit) ; N° de bon dans l'export des rotations, la saisie de Rotations et NIMOVA Terrain ; menu « Factures et journaux » ouvert en lecture à la direction ; connexion de repli : depuis l'adresse commune (Finance par défaut), un compte qui n'ouvre pas Finance (test.rh) entre dans sa première application web interne au lieu d'un refus.
- Vérifications : série complète de 802 puis 809 tests sans erreur, 51 tests de l'API après le repli de connexion ; recette mise à jour (réglages de démonstration des factures : scripts/recette/donnees_demo_factures.py, compte bancaire fictif affiché, journaux de vente au dernier numéro EG24137 et MBAX/2026/0026) ; PDF d'une facture de rotations relu (charte, tableau du transport, montant en lettres, TVA 18 %, banque, signataire) ; classeur des états au modèle (trois feuilles) ; répétition sur une copie de la production réussie ; après la mise en production, treize modules aux nouvelles versions, noyau, web et sauvegardes sains, adresses publiques en 200.
- Cahiers de test : 02 Finance 64 scénarios, 03 Transport 38, 09 HSSEQ 58 ; neuf cahiers, 326 scénarios.
- À saisir en production à la mise en service (Finance > Administration > Factures et journaux, Administration > Sociétés) : identité et slogan, comptes bancaires à afficher, signataires et modes de règlement, derniers numéros (EG24137 pour EGUITRA GROUP SARLU, MBAX/2026/0026 pour MB AxisPro Consulting). Puis faire valider par l'expert-comptable la table des postes du bilan détaillé (2181, 239, 249, le 22 entier, AP hors de AI) et importer les états 2025 une fois corrigés (bilan non équilibré dans le classeur remis).
- Agenda : module eguitra_agenda en développement (agent), puis tests, recette, répétition et mise en production.

### 27 octobre 2026, 11 h : HSSEQ et NIMOVA Terrain en production (version 20261027-1104)

- En production : version 20261027-1104 (code f1ca92d), sauvegarde prise avant (20261027T1104), décision du gérant du 27/10 (« tout doit aller en production, après test et validation »). Contenu : module HSSEQ installé (eguitra_hsseq 19.0.1.2.2, treize modules), entrée native de l'application NIMOVA Terrain (passerelle /api/natif, session « terrain »), écrans HSSEQ de DESIGN. Aucune donnée de démonstration en production : sites, réglages et motifs du verrou d'HSSEQ sont à paramétrer par le Responsable HSSEQ.
- Intégration reprise par la session principale : la série de tests d'OTHER (nuit du 26 au 27) avait échoué sur deux tests mal écrits (format « 5,00 t », mois figé lu pour les deux sociétés), corrigés (1bf2f205) ; la fusion avec l'application mobile bornait la session de Terrain à des routes antérieures aux dernières d'HSSEQ : six lectures du conducteur ouvertes (f1ca92d3).
- Vérifications : série complète (773 tests, seules les six erreurs ci-dessus), puis 251 tests ciblés (api, transport, hsseq) sans erreur ; recette mise à jour (HSSEQ installé, comptes test.hsseq, test.conducteur, test.auditeur, données de démonstration HSSEQ et RH) ; contrôle des routes par profil (conducteur borné à Terrain, auditeur en lecture, exploitation sans réglages) ; répétition sur une copie de la production réussie ; après la mise en production, treize modules installés, noyau et web sains, adresses publiques en 200.
- Sauvegardes : 105 fausses alertes « aucun segment WAL archivé » quand la production n'écrit rien (aucun segment produit, rien à archiver) ; contrôle corrigé (7bccc7e6) : alerte sur un segment terminé en attente plus de 15 minutes, un archivage inactif ou en échec. Entre en service à la prochaine mise en production.
- Documents du client reçus le 27/10 (« DOCUMENT COMPTABLE EGUITRA GROUP 2025 », « Modèle facture Eguittra »), analysés comme modèles (non versionnés). Modèle comptable : système normal OHADA, codes identiques à ceux de la plateforme ; défauts du modèle signalés au gérant (marge N-1 en +RB, valeur ajoutée en +RD, liens vers un classeur 2022, flux sans lien avec le bilan, aucun contrôle actif = passif ni CJ = XI) ; le bilan 2025 remis n'est pas équilibré (écart d'environ 11,6 Md GNF) et CJ diffère de XI : à voir avec l'expert-comptable avant tout emploi en N-1. Modèles de facture : cinq feuilles, défauts signalés (« Arrêter », montant en lettres tapé à la main, numérotation EG irrégulière, identité écrite de quatre façons, NIF et RCCM absents, total TTC libellé « MONTANT HT » dans l'immobilier, TVA sur une location nue d'habitation à confirmer).
- États et factures au modèle du client : fusionnés dans la branche commune (1bb32a5b ; eguitra_base 19.0.1.11.0, eguitra_finance 19.0.1.11.0, eguitra_transport 19.0.1.7.0), série complète des tests en cours sur la recette ; production après tests, recette et répétition.
- Cahiers de test : neuf cahiers, 308 scénarios (cahier 09 HSSEQ, 55 scénarios, ajouté). Cahiers 02 Finance et 03 Transport en cours de mise à jour pour les factures et les états.
- HSSEQ, anomalies relevées en rédigeant le cahier (création d'une action depuis un événement, modification d'une action par son responsable, tri par retard, codes anglais dans les journaux, textes périmés, boutons refusés à l'auditeur, cible cumulée du rapport mensuel, information du donneur d'ordre sous 24 heures) : en correction, prochaine mise en production.
- Agenda (demande du gérant du 27/10 : agenda par personne, partage, délégation à une assistante, planification automatique, échéances des modules) : module eguitra_agenda en développement.
- Décisions du gérant (27/10) : double authentification maintenue désactivée en production pour le moment ; numérotation des factures : MB AxisPro Consulting au format MBAX/AAAA/NNNN (compteur annuel, continuant le compteur 2026 de l'ancien système : MBAX/2026/0027), EGUITRA GROUP SARLU garde sa suite EG (dernier numéro EG24137, puis EG24138). Le réglage est propre à chaque journal de vente (Finance > Administration > Factures et journaux).
- À décider par le gérant : copie hors site des sauvegardes (stockage objet).

### 27 octobre 2026, 1 h : RH habilitations et profil associé en production (version 20261027-0104)

- En production : version 20261027-0104 (code 2b90161), sauvegarde prise avant (20261027T0104), accord explicite du gérant. Contenu : branche RH « habilitations » (habilitations des conducteurs, aptitude en statut seul, équipements de protection, import Excel, interface pour HSSEQ ; eguitra_rh 19.0.1.2.0, 98 tests en base isolée) ; profil « Associé du cabinet » (eguitra_base 19.0.1.9.0) : sceller une revue, forcer un gate et rouvrir une révision sont réservés à l'associé ou à la direction du cabinet sans profil administration, deux personnes toujours exigées (décision du gérant par délégation) ; porteur créé en recette avec le mot de passe saisi ; test.consultant responsable d'un dossier de démonstration (cloche du cabinet).
- Vérifications : série complète de 668 tests puis 235 tests ciblés (un test corrigé : 2b90161) ; recette mise à jour ; répétition sur une copie de la production réussie ; après la mise en production, versions, groupe associé, adresses publiques, supervision et sauvegardes contrôlés ; aucun compte de test en production.
- Recette : données de démonstration RH rechargées (12 salariés) après correction de donnees_demo_rh.py (17aee2a6).
- En production, à faire par le gérant : donner le profil « Associé du cabinet » aux associés réels de MB AxisPro Consulting (Administration > Utilisateurs) avant le premier comité, sinon seule la direction du cabinet peut sceller.
- Cahiers de test des utilisateurs : 253 scénarios, guide des testeurs corrigé, envoyés au gérant le 26/10.
- Application mobile NIMOVA Terrain : construction de l'APK reportée par le gérant (« nous le ferons en temps voulu ») ; version de démonstration prête sur claude/nimova-terrain (profil preview, bureau simulé) ; le jour venu : connexion du gérant à son compte Expo, puis eas build -p android --profile preview depuis apps/terrain.
- Suite : verrou rendu à OTHER pour HSSEQ en recette (avec les écrans de DESIGN) ; puis entrée native de la session Mobile App (/api/natif) en recette. HSSEQ et l'application mobile : production avec l'accord du gérant (avenant).
- États au modèle du client (branche etats-modele-syscohada, eguitra_finance 19.0.1.10.0, tests écrits, à lancer sur le serveur ; ni recette ni production) : bilan détaillé par poste (AE à AH, AJ à AN, AR, AS) avec brut, amortissements et dépréciations (28, 29, 39, 49, 59), net et N-1 ; notes annexes, signe du compte de résultat, lettres A à H et variation du BF du tableau des flux, contrôle de ZH par la trésorerie du bilan ; export « Modèle SYSCOHADA » (trois feuilles nommées comme le classeur « DOCUMENT COMPTABLE EGUITRA GROUP 2025 », valeurs sans formules) depuis l'écran États. Comparatifs du premier exercice : import des états 2025 au même modèle (Clôtures et contrôles, administration seule ; contrôles affichés sans bloquer, remplacement confirmé, piste d'audit), employés en N-1 tant que 2025 n'a pas d'écritures dans la plateforme, et bilan d'ouverture (à-nouveaux AN) comparé poste par poste. AP reste une rubrique propre (présentation officielle) alors que le modèle du client le range dans AI ; un AI qui comprend AP est ramené à l'import. **À valider par l'expert-comptable** : table des postes (notamment 2181 en AE, 239 en AK, 249 en AM, 22 entier en AJ), AP hors de AI, signes « - » des variations de stocks (RB, RD, RF, TE), libellés du modèle ; défauts relevés dans son classeur (marge commerciale et valeur ajoutée N-1, liens vers « BILAN 2022 » et « COMPTE DE RESULTAT 2022 », ZA, FA, FD et FE de N non renseignés, AQ N-1 calculé « E23-F23 », aucun contrôle actif = passif ni CJ = XI, CB additionné dans CP, années écrites en dur).
- Factures au modèle du client (branche factures-modele-client, ni recette ni production ; tests écrits, à lancer : `infra/test.sh eguitra_base eguitra_api eguitra_finance eguitra_transport eguitra_rh`). Les factures et avoirs des clients suivent les cinq modèles Excel remis le 27/10 (MB AxisPro, transport carburant, location de véhicule, BTP, immobilier), dans la charte (logo, couleur de la société, à défaut vert #006C1B) : identité de la société (adresse, téléphones, courriel, NIF, RCCM ; logo et slogan en en-tête), « FACTURE », numéro, « Conakry, le … », bloc CLIENT, référence de l'offre (`ref`), « Commentaire ou indication » (nouveau champ objet, saisi dans le formulaire de vente), lignes avec rubriques I, II… et leur sous-total, notes, colonne Unité si une ligne n'est pas en « Unité », totaux par groupe de taxe, « Arrêtée la présente facture à la somme de » (montant TTC en lettres, partagé avec la paie dans `eguitra_base/lettres.py`), échéance, modes de règlement, tous les comptes bancaires marqués, signataire puis raison sociale ; « Paiement perçu » et « Reste à payer » si la facture est partiellement réglée ; brouillon et annulation marqués. Factures des rotations : tableau N°, N° de BL, N° de bon (nouveau champ de la rotation, colonne `bon` de la reprise), camion, départ, destination, litres, péréquation au litre, total HT ; taxes refacturées et manquant en lignes simples dessous. Pièces d'achat : gabarit du noyau inchangé. Versions : eguitra_base 19.0.1.10.0, eguitra_finance 19.0.1.11.0, eguitra_transport 19.0.1.7.0 (migration : lignes des factures existantes reliées à leur rotation).
- À saisir à la mise en service, par l'administration : Sociétés (adresse, quartier, boîte postale, ville, téléphones séparés par « / », courriel, NIF, RCCM, slogan « Votre partenaire global pour un avenir durable », logo) ; Finance > Administration > Factures et journaux : pour chaque compte de banque, la banque, le numéro, l'IBAN et le SWIFT, puis « Afficher sur les factures » (aucun compte n'est coché d'office) ; pour chaque journal de vente, le signataire (défaut « Service Comptabilité & Finance » ; « SERVICE FINANCE » ou « SERVICE COMMERCIAL » selon les modèles), les modes de règlement (MB AxisPro : « Par espèces, virement bancaire ou chèque ») et le dernier numéro de l'ancien système, avant la première facture : EGUITRA « EG24137 » (la suivante sera EG24138) ; MB AxisPro numérote « 0026/MBAX06/26 », compteur en tête, que le noyau ne sait pas continuer : l'écran le refuse et propose « MBAX/2026/0026 » (première facture MBAX/2026/0027, compteur remis à 1 chaque année), à faire accepter par le client. Ouvert : la « Validité offre » des modèles n'a pas de champ (à trancher) ; signataire par journal de vente (un journal par activité si le client veut un service par activité).
- Agenda (branche `agenda`, pas encore sur le serveur) : nouveau module `eguitra_agenda` 19.0.1.0.0 et application NIMOVA · Agenda (`/agenda`), ouverte à tous les comptes internes (jamais au salarié seul, au conducteur, au porteur ni à l'auditeur), un seul agenda par compte pour les deux sociétés. Modèles propres plutôt que le module `calendar` d'Odoo (droits par agenda, délégation, ressources et refus de conflit à notre main ; contenu des événements exclu de la piste d'audit ; l'administration ne lit pas les agendas des autres). Contenu : agendas personnels créés d'office, agendas d'équipe, ressources (salles, véhicules, équipements) réservées sans double réservation avec le créneau libre le plus proche ; événements complets (récurrences quotidienne, hebdomadaire, mensuelle par date ou par rang, annuelle ; occurrence, suivantes ou série ; visibilité publique, privée, confidentielle ; statut ; catégories ; pièces ; lien vers une fiche) ; invitations internes et externes, réponses avec commentaire, proposition d'horaire ; partages en trois niveaux ; délégation à une assistante (« par … pour le compte de … », journal, pose par la direction ou l'administration pour un dirigeant) ; heures de travail, « Trouver un créneau », planning d'équipe, absence du bureau avec refus d'office ; rappels et récapitulatif quotidien (tâches planifiées sans double envoi) ; échéances des modules (congés, fiscalité, clôtures, HSSEQ, AxisPro, approbations) bornées aux droits ; lien d'abonnement iCalendar secret, haché et révocable ; import et export .ics ; prise de rendez-vous en ligne fermée par défaut. Données de démonstration : `scripts/recette/donnees_demo_agenda.py` (test.daf tient le rôle de l'assistante du DG). Cahier de test : `10-agenda.md`, 55 scénarios. Contrôles locaux passés (ruff, compilation, tsc, 15 tests du moteur hors noyau) ; les 82 tests du module ne sont pas encore joués sur une base Odoo.
- Agenda, à faire : en recette, `scripts/dev/sync.sh`, `-i eguitra_agenda` puis redémarrage du noyau, `infra/test.sh eguitra_base eguitra_api eguitra_approval eguitra_agenda`, puis les données de démonstration ; production par `infra/release.sh` (le module est dans MODULES ; installé au premier passage) avec l'accord du gérant. À la mise en service : déclarer les salles, véhicules et équipements réels (Agenda > Administration > Ressources) ; sans serveur de courrier (`infra/mail-server.sh`), invitations et rappels restent dans l'application ; la prise de rendez-vous en ligne exige l'adresse publique du site et le serveur de courrier, puis l'ouverture par l'administration. Reportés : réponse d'un invité externe par lien (l'organisateur note sa réponse), refus d'office sur une série récurrente (simple indication), fuseaux au nom Windows des fichiers .ics d'Outlook non convertis (heure lue à l'heure de Conakry), application mobile.
- Achats et ventes (branche `achats-ventes`, périmètre décidé par le gérant le 27/10, carte blanche ; ni recette ni production) : nouveau module `eguitra_commerce` 19.0.1.0.0, quinzième module, sur les modules `sale` (sans `sale_management`) et `purchase` du noyau, sans stock ; écrans dans Finance (onglets sous Ventes : Factures, Offres, Commandes, Catalogue, Tableau de bord ; sous Achats et dépenses : Pièces d'achat, Bons de commande, Catalogue, Tableau de bord ; Administration > Achats et ventes ; Bons de commande au menu des métiers), pas d'application propre ni d'entrée dans APPS. Contenu : catalogue par société (unité, prix, comptes, TVA, activité ; import CSV ou XLSX au modèle) ; offres numérotées par société (OF/EG/AAAA/NNNN, OF/MBAX/AAAA/NNNN), validité 15 jours réglable, rubriques, unités, remises, conditions, PDF « OFFRE » au gabarit des factures (« Référence offre », « Validité offre »), envoi par courriel si un serveur existe, états brouillon, envoyée, acceptée, refusée (motif), expirée (tâche de nuit), annulée, remplacée (versions -V2…), relance de l'auteur avant expiration ; commande facturée en totalité, par acomptes en pourcentage ou en montant TTC (compte 4191, déduits sur la facture finale) ou par quantités exécutées, la facture reprenant la référence de l'offre et son objet ; offre de travaux (EGUITRA GROUP SARLU) : acceptée, elle crée le chantier ou s'y rattache au hors taxes de l'offre, l'avance de démarrage se facture une fois puis se déduit au prorata de chaque situation jusqu'à épuisement (deux points d'extension ajoutés à `eguitra_chantier`, 19.0.1.1.1, sans effet sans avance ; retenue de garantie inchangée) ; bons de commande (BC/…) depuis un engagement approuvé (approuvés d'office dans sa limite et sa tolérance) ou directs, soumis au moteur `eguitra_approval` prolongé par héritage (règles des engagements, nature « Bons de commande fournisseur », quatre yeux : saisisseur, demandeur et demandeur de l'engagement écartés), PDF « BON DE COMMANDE » avec ses approbateurs, envoi au fournisseur ; réceptions (REC/…) partielles, par qui, quand, bon de livraison joint, annulables ; pièce d'achat rattachée et rapprochée (quantités facturées dans le reçu, prix dans la tolérance) : conforme, validée sans circuit ; en écart, circuit actuel des pièces d'achat ou blocage (réglage) ; pièce sans commande inchangée ; devis fournisseurs comparés sur l'engagement, choix motivé, règle des trois devis au-delà d'un seuil (désactivée par défaut) ; tableaux de bord des ventes et des achats, exports XLSX et CSV ; échéances (fin de validité, livraisons attendues) exposées par `/commerce/deadlines` pour l'agenda. Les commandes du noyau sont manipulées avec ses droits après contrôle du profil et de la société (aucun groupe du noyau ajouté aux profils, identité gardée dans la piste d'audit) ; `sale.order`, `purchase.order`, leurs lignes, les articles et les trois nouveaux modèles sont dans la piste d'audit ; menus du noyau réservés à l'administrateur technique. Données de démonstration : `scripts/recette/donnees_demo_commerce.py`. Cahier de test : `11-achats-ventes.md`, 54 scénarios (onze cahiers, 435 scénarios). Contrôles locaux passés (ruff, compilation, XML, tsc) ; tests écrits (offres, offre de travaux, achats, routes avec refus par profil), pas encore joués sur une base Odoo.
- Achats et ventes, à faire : en recette, `scripts/dev/sync.sh`, `-i eguitra_commerce` (installe aussi `sale`, `purchase`, `sales_team`, `account_payment`, `payment`, `utm` et le pont `sale_purchase`), `-u eguitra_chantier,eguitra_finance` puis redémarrage du noyau ; `infra/test.sh eguitra_base eguitra_api eguitra_finance eguitra_approval eguitra_chantier eguitra_commerce`, puis la série complète (les tests des autres modules doivent rester verts avec sale et purchase installés) ; données de démonstration ; production par `infra/release.sh` (module dans MODULES ; installé au premier passage), avec l'accord du gérant. Points à vérifier aux premiers tests, hypothèses sur le noyau 19 : acompte en montant fixe TVA comprise ; déduction des acomptes par `_create_invoices(final=True)` ; nom des menus racine (`sale.sale_menu_root`, `purchase.menu_purchase_root`). À la mise en service, par l'administration et la finance (Administration > Achats et ventes, par société) : validité des offres, relance, tolérances de rapprochement (2 % sur les prix, 0 sur les quantités par défaut), écart soumis au circuit ou bloquant, seuil des trois devis, préfixes et prochains numéros (OF, BC, REC) si le client continue une numérotation existante ; le compte des acomptes (4191) est posé d'office ; catalogue de chaque société (import au modèle) ; serveur de courrier pour les envois. Reportés : location de véhicules au jour (Transport, étape suivante), stocks (hors contrat), grille de prix par client, relance automatique du client (la relance automatique vise l'auteur ; le client se relance d'un clic).

### 26 octobre 2026, soir : audit en production (version 20261026-1845)

- En production : version 20261026-1845 (code 323817d), mise en service à 18 h 46, sauvegarde de base prise juste avant (20261026T1845). Douze modules : base 19.0.1.8.0, api 19.0.1.3.0, finance 19.0.1.9.0, approval 19.0.1.3.0, transport 19.0.1.6.0, chantier 19.0.1.1.0, immobilier 19.0.1.2.0, axispro 19.0.1.5.0, analytics 19.0.1.0.0, portail 19.0.1.3.0, rh 19.0.1.1.0, chat 19.0.1.0.0 (nouveau, chat interne). Images rafraîchies (Odoo 19.0 du 17/10, PostgreSQL 16 du 21/10) : mise à jour mensuelle consignée dans logs/maj-securite/2026-10.md. Double authentification toujours suspendue (décision du gérant).
- Vérifications : série complète de 658 tests (un seul échec, dû au test, corrigé : 9b905cc) ; répétition sur une copie de la production réussie ; recette mise à jour (douze modules, chat, web) ; contrôle de connexion de chaque compte de test, refus attendus compris (logs/controle-profils.sh sur le serveur) ; après la mise en production : adresses publiques, santé du noyau, supervision, sauvegardes, piste d'audit des paramètres système.
- Recette : compte test.associe ajouté (second compte du cabinet). Mot de passe commun réappliqué aux 18 comptes.
- Cahiers de test des utilisateurs : huit fichiers Word, 248 scénarios (docs/projet/tests-utilisateurs/word/, générateur build.js) ; relecture d'AxisPro et du chat en cours.
- Décisions prises par délégation du gérant (26/10) : scellement d'un comité, passage forcé et réouverture réservés à un associé du cabinet ou à la direction (nouveau profil associé, en cours de développement, prochaine mise en production) ; chat : messages retirés gardés en base comme trace, historique visible des nouveaux membres d'un groupe, relectures automatiques hors du journal des accès.
- Verrou libéré après la mise en production. Ordre suivant : RH (rh-hsseq, recette), puis OTHER et DESIGN (HSSEQ, recette ; production avec l'accord du gérant, avenant), puis l'évolution AxisPro (profil associé).

### 26 octobre 2026 : intégration de l'audit, interrompue par la limite d'usage

- Fusionné et poussé (0922a14), pas encore en recette ni en production : corrections du noyau du transport, du départ en route (administration et exploitation) et du barème ; espace de suivi des demandes (« Mes demandes », eguitra_api 19.0.1.2.0) ; socle web (pannes, reconnexion, société par onglet, déconnexion après 1 minute d'inactivité puis 30 secondes, eguitra_api 19.0.1.3.0) ; portail des porteurs ; Transport, Rotations hors ligne et RH (eguitra_rh 19.0.1.1.0) ; Finance en deux lots (eguitra_finance 19.0.1.9.0, eguitra_approval 19.0.1.3.0, chantier, immobilier) ; clôture de l'exercice et bilan (CJ limité à l'exercice en cours) ; Analyse.
- Tests : série du 26/10 à 12 h 15 : 8 échecs, corrigés depuis ; troisième série lancée à 13 h 16 sur 0922a14 (journal ~/eguitra/logs/tests-1026c.log), résultat à lire.
- En cours (copies isolées) : AxisPro (agent aaa3f12…), chat interne (module eguitra_chat, agent a96e702…). Après eux : série complète, -u de tous les modules en recette, redémarrage, répétition, release.sh, puis libérer le verrou et prévenir RH (rh-hsseq, 98 tests réussis), TRANSPORT, OTHER et DESIGN (HSSEQ).
- Chat interne fusionné (branche chat-interne) : module eguitra_chat 19.0.1.0.0 (modèles propres plutôt que discuss.channel ; conversations à deux, de groupe et de fiche ; membres seuls lecteurs, administration comprise, par règles d'enregistrement globales ; relectures à 5 s et 30 s hors journal des accès, sans effet sur la déconnexion après inactivité), icône et panneau dans l'en-tête, page /discussions, bouton « Discussion » des fiches (dossier, chantier, rotation, bien), retrait d'un compte archivé par l'administration ; 10 tests écrits, à lancer (infra/test.sh eguitra_base eguitra_api eguitra_chat eguitra_axispro) ; recette : -i eguitra_chat, -u eguitra_base,eguitra_api, redémarrage du noyau, web reconstruit.
- Demandes du gérant à faire ensuite : vérification complète du système, puis un fichier Word de test par module pour les utilisateurs finaux. Gestion clientèle et WhatsApp : mis de côté, à reprendre.
- À faire valider par l'expert-comptable : plafond d'exonération de 25 %, avantage en nature (781), plancher CNSS, stagiaires ; résultat non affecté en CH, comptes d'affectation, provision pour perte de change, nouvelles rubriques du bilan.

### 25 octobre 2026, après-midi : audit approfondi, interrompu par la limite d'usage

- Fait et poussé (branche claude/bold-shannon-gpg2hv, 87a097c), pas encore en production :
  - exploitation : supervision du proxy, des accès HTTPS et des certificats ; rappels quotidiens des écarts connus ; `infra/maj-securite.sh` ; `infra/export-reversibilite.sh` ; `restore-test.sh --offsite` ; 15 jours de journaux hors site ; disponibilité hors seules maintenances annoncées (`release.sh --annoncee`) ;
  - noyau : piste d'audit complète, avec un test qui signale tout modèle oublié ; contrôle « cohérence des références » ; exports jusqu'à 100 000 lignes ; politique rappelée dans le PDF « Pièces à fournir » ; lien de l'Analyse corrigé ;
  - Transport : fiche rotation ; rotation validée par un autre compte (décision du 22/10, jamais appliquée jusque-là) ; règles de répartition modifiables ; branche du barème officiel fusionnée (correctif critique des tarifs C6, écrans corrigés) ;
  - web : lecture unique des nombres saisis (`lireNombre`) ;
  - documents : dossier de conception à jour, dossier technique, PV de recette et de mise en production, compte rendu de comité, registre des prérequis.
- Recette : images de base mises à jour (Odoo 19.0 du 17/10, PostgreSQL 16 du 21/10) ; 404 tests sur 404, avant la fusion du barème.
- En cours, non fusionné, dans des copies isolées : corrections des écrans Finance (deux lots), AxisPro, portail des porteurs, Transport et Rotations hors ligne, RH, Analyse et socle web ; clôture de l'exercice avec bilan corrigé (le résultat de 2026 ne doit plus rester dans CJ en 2027) ; espace de suivi des demandes. L'audit du noyau Python n'a pas encore rendu son rapport.
- Reste à faire : fusionner ces branches ; `infra/test.sh` sur tous les modules ; `-u` en recette ; répétition sur une copie de la production ; `infra/release.sh` ; puis libérer le verrou et prévenir RH (rh-hsseq), TRANSPORT et OTHER (HSSEQ, lot 1).
- À faire par le gérant : destinations des alertes (`ALERT_NTFY_URL`, `HEARTBEAT_URL` dans infra/.env) ; stockage hors site (infra/backup.env) ; relais SMTP ; double authentification à rétablir avant les données réelles ; disque de 160 Go ou accord écrit du client ; T0 et premier comité de pilotage ; signature du dossier de conception.

**25 octobre : application mobile NIMOVA Terrain, socle** (branche `claude/nimova-terrain`, à fusionner
après l'audit en cours). Analyse : `docs/projet/mobile/analyse-application-mobile.md`. Décisions du
gérant : React Native avec Expo, Android d'abord ; formulaires HSSEQ directement dans l'application
native, sans solution d'attente dans Rotations web ; conducteurs équipés de téléphones de service.
- Fait : `apps/terrain` (Expo SDK 58), connexion par jetons de l'API avec double authentification et
  mot de passe provisoire, ouverture hors réseau, Rotations reprises de Rotations web (file d'envoi
  SQLite, envoi idempotent), mise en page téléphone et tablette, bureau simulé en développement.
  29 tests, `tsc`, `expo-doctor` et paquet Android au vert ; parcours vérifiés dans l'aperçu web.
- Entrée native de la passerelle faite le 26/10 au soir sur la branche, après l'audit de Local :
  `apps/web/app/api/natif` (jeton porté par l'application, routes de session rendant les jetons,
  seuls les codes terrain et mobile et les routes du compte, de /transport/ et de /hsseq/ ; 9 tests
  `npm test`) et sessions `terrain` bornées à leurs routes dans le noyau
  (`SESSION_ROUTES["terrain"]`, seule action `depart` sur une rotation ; tests eguitra_api et
  eguitra_transport écrits, à lancer sur le serveur). `tsc` et `next build` au vert.
  Intégration par la recette après RH et HSSEQ (Local).
- 27 octobre : version de démonstration préparée (profil de construction `preview`, APK) : bureau
  simulé embarqué ou adresse d'un bureau saisie à la connexion (https seulement), chaque serveur dans
  son propre espace sur l'appareil (`src/serveur.ts` : base, coffre, code personnel), rien envoyé au
  vrai bureau depuis la démonstration, numéros d'urgence fictifs jamais composés. 79 tests,
  `tsc` et `expo-doctor` au vert. Construction de l'APK (EAS) reportée par le gérant : rien n'a été
  lancé, aucune connexion au compte Expo.
- 26 octobre : relecture indépendante du socle, défauts corrigés (renouvellement de session,
  réseau Android, envois concurrents, bord à bord) ; système de conception « terrain » de DESIGN ;
  « Ma journée » par profil, file d'envoi commune, contrôle avant départ, alcootest masqué et
  déclaration en un geste, sur le contrat HSSEQ et le noyau de la session OTHER (branche `hsseq`).
  53 tests au vert, parcours vérifiés dans l'aperçu web avec le bureau simulé.
- 26 octobre, suite : départ et verrou du jour (jamais « autorisé » sans réponse récente du bureau,
  passage en route par le chef de parc seul), demande de dérogation, levée des non-conformités avec
  photo, envoi en arrière-plan, code personnel au réveil et verrouillage de la tablette après
  2 minutes (revue de sécurité : session reprise toujours verrouillée), signature tracée du contrôle.
  64 tests au vert ; parcours vérifiés au téléphone et à la tablette sur le bureau simulé.
- 26 octobre, soir : relecture contradictoire de l'application (49 constats tenus sur 56), tous
  corrigés : file d'envoi (refus d'une route sans arrêt des autres, erreurs passagères et horloge
  décalée laissées en attente, correction reçue trop tard signalée), session (renouvellement lié
  au compte gardé, mot de passe provisoire repris, étapes de connexion qui expirent), verrou (code
  redemandé avant dérogation et levée, frappe comptée, contenu caché au lecteur d'écran), photos
  (cliché brut et orphelines supprimés, photo de levée gardée jusqu'à la levée), départ vérifié
  rotation par rotation, formulaires protégés (confirmation avant abandon, retour Android, messages
  d'échec), tâche de fond déclarée avant le routeur. Ajouts sur le noyau HSSEQ de la session OTHER
  (branche `hsseq`, lots 2 et 3) : appels d'urgence depuis la déclaration d'accident (annuaire de
  crise), « Documents » (procédures et alertes, accusé de lecture même sans réseau), « Mon
  dossier » du conducteur (habilitations, aptitude en statut seul), contrôle complémentaire d'un
  contrôle incomplet. 77 tests au vert, `tsc` et paquet Android au vert ; parcours vérifiés sur le
  bureau simulé.
- Ensuite : branchement sur la recette dès l'entrée native de la passerelle (Local, après son audit)
  et l'intégration du module HSSEQ ; compte Expo de l'entreprise (EAS) pour essayer sur de vrais
  téléphones ; réponses de la Direction générale (départ sans réseau, valeur de la signature par
  code, V05). Hors offre initiale : avenant à chiffrer avec HSSEQ.

**22 octobre, nuit : portail des porteurs refait de fond en comble**, demandé par le gérant (« un vrai
portail, complet, carte blanche »). Fait :
- Module `eguitra_portail` 19.0.1.0.0 (dépend d'`eguitra_axispro` sans modifier ses fichiers), 8 tests au
  vert. Le porteur ne lit que ses dossiers et les publications dont il fait partie du public ; jamais le
  scoring, les notes internes ni les critères. Indicateur « préparation du dossier » propre au portail
  (pièces 50 %, actions 30 %, étapes 20 %), distinct du score du cabinet. La fiche de l'entreprise ne
  change pas depuis le portail : la demande part au consultant (revue de sécurité).
- Écrans du porteur (`apps/web/app/portail/`, coquille `components/portail/PortailShell.tsx`) : accueil
  (prochaines étapes, à venir, fil du projet, actualités, conseils de l'étape), mon projet (équipe,
  financements, fil complet), pièces et data room, plan d'actions, messagerie avec pièces jointes,
  rendez-vous (ajout à l'agenda .ics), actualités, conseils et ressources, événements et formations,
  agenda, simulateurs (prêt, DSCR, seuil de rentabilité, BFR), notifications, profil, avis.
- Outils du cabinet (`apps/web/app/axispro/portail/`, menu Cabinet > « Portail des porteurs ») :
  synthèse, messagerie de tous les dossiers (notes internes), communications, ressources, événements et
  inscriptions, rendez-vous, porteurs et avis.
- Neuf contenus de conseil proposés à l'installation, **en brouillon, à relire et publier par le
  cabinet** (rien n'est publié en production sans lui). Recette : publiés, avec communications,
  événements, rendez-vous et échanges de démonstration (`scripts/recette/portail_demo.py`). Comptes de
  test : `test.porteur` et `porteur.demo` (portail), `test.consultant` (cabinet).
- `infra/test.sh` installe désormais un module nouveau (première commande en `-i` et `-u`) ; le module
  est dans `release.sh`, `init-db.sh` et `scripts/reprise/essai.sh`. Protocole entre sessions : on se
  prévient avant chaque `test.sh` (base `eguitra_ci` partagée).
- Reste : courriels de notification quand le serveur d'envoi sera fourni (aujourd'hui, notifications
  dans le portail seulement) ; pagination des notifications et des rendez-vous anciens.
- Les neuf conseils proposés à l'installation sont publiés en production le 22 octobre à 14 h 19, à
  la demande du gérant (le cabinet peut les modifier ou les archiver dans Portail des porteurs >
  Ressources).
- **En production depuis la version 20261022-1012** (22 octobre, 10 h 13, mise en production conduite
  par la session AXISPRO SUITE) : tests des dix modules sur ce code, 342 au vert ; répétition sur une
  copie de la base de production ; contrôlé ensuite : portail installé (6 rubriques, 9 contenus en
  brouillon), routes du portail et d'AxisPro en service, double authentification toujours suspendue
  (choix du gérant), aucune erreur au journal du noyau.
- `infra/test.sh` affiche « ÉCHEC » quand une longue série de tests se termine : les contrôles de
  santé du conteneur, en attente pendant les tests, sont servis à l'arrêt et ne peuvent plus écrire
  au journal des accès (« cursor already closed »). Lire le décompte « 0 failed, 0 error(s) of N
  tests » ; à corriger dans le script (ignorer cette ligne ou couper le contrôle de santé du conteneur
  de test).

**22 octobre, nuit : outil de scoring du cabinet, version 3 (AxisPro)**, demandé par le gérant (« intègre
tout, carte blanche »). Reçu : deux versions du classeur « MB AxisPro Outil Scoring Maturité Projet »
(réf. MBAP/PROJECT-DEVELOPMENT/SC-01). L'ancienne (111 critères, 15 domaines, 8 gates) est la grille v2
déjà en service. La nouvelle compte 104 critères (domaine SPV / Gouvernance retiré), 14 domaines
renommés en clair, 8 compartiments d'expertise C0 à C7 confiés chacun à un consultant, 7 gates (gate
SPV fusionné avec le financial close), 39 pièces et une notice sous chaque onglet. Les classeurs restent
hors du dépôt (document du client, nom du mandat) : `infra/secrets/grille/` du serveur.
- Fait (eguitra_axispro 19.0.1.3.0, migration de la piste d'audit) :
  - Import natif de l'outil du cabinet (`addons/eguitra_axispro/grille_cabinet.py`). Règles des gates
    déduites des noms, seuils, complétude minimale et domaines contrôlés lus dans Stage_Gate ; seuils
    et barème lus dans Parametres (barème différent refusé). Codes, aides, livrables, indicateurs et
    rattachements des pièces repris de la version en vigueur. L'ancien classeur redonne exactement la v2.
  - Réglages du classeur : un knock-out incomplet ne bloque pas, « non applicable » vaut 1 point.
  - Compartiments, consultant par compartiment sur un dossier (journal), suivi par compartiment
    (score, manques, études renseignées, knock-outs), check-list filtrée (« Mes compartiments »),
    complétude documentaire minimale pour examiner un gate (HOLD en dessous).
  - Exports et réimport de l'outil rempli hors ligne (études à produire), compartiment des actions.
  - Analyse : bloc « Par compartiment d'expertise » du diagnostic des projets, deux constats.
  - Guide du cabinet, cahier de recette (A01 revu, A12 à A14). Tests : 55 AxisPro et 10 Analyse du
    cabinet au vert.
  - Passerelle web : `GET /auth/me` ouvert au navigateur. Il était refusé (404), si bien que le profil
    Achats seul et la saisie libre des comptes ne s'appliquaient jamais dans les écrans, en production
    aussi : à mettre en production.
- Recette : modules mis à jour le 22 octobre à 01 h 00, grille v3 importée et en vigueur (version 3 :
  7 gates, 8 compartiments, 14 domaines, 104 critères, 9 knock-outs, 39 pièces, 95 rattachements ;
  30 critères sans pièce rattachée) ; dossiers de démonstration restés sur leur version ; web-recette
  reconstruit. Incident : `apps/web/lib/nav.ts` du serveur était rempli d'octets nuls (écrit à 00 h 40,
  origine inconnue) et bloquait toute reconstruction ; remplacé par la version commitée.
- Production (22 octobre, 10 h 13, mandat du gérant : « tout terminer, tester et mettre en production ») :
  version 20261022-1012 (commit e396cf6, toutes les sessions), conduite par la session AxisPro seule
  (verrou `~/eguitra/logs/mise-en-production.lock`, accord écrit des autres sessions, qui avaient reçu
  la même consigne : à l'avenir, une seule session reçoit la mise en production). Avant : serveur en
  miroir exact du commit poussé, 342 tests au vert sur les dix modules (seule ligne ERROR : une requête
  /health écrite au journal d'accès pendant l'arrêt du serveur de test), répétition générale sur une
  copie de la base de production restaurée à part (-i/-u des dix modules sans erreur, import de la
  grille, copie supprimée). Puis grille AxisPro importée et en vigueur en production (version 1 :
  7 gates, 8 compartiments, 104 critères, 39 pièces, 95 rattachements), exportée à l'identique de la
  recette (`scripts/grille/exporter.py`, puis `importer.py` avec `GRILLE_REGLAGES`). Contrôles :
  `eguitra_api.mfa_required` resté à 0 (demande du gérant), `eguitra_portail` installé, `eguitra_rh`
  absent et aucune application « rh » visible, /login 200 sur les trois adresses, `/api/odoo/auth/me`
  401 sans session et `/auth/login` toujours fermé. Verrou libéré pour la session RH (seconde mise en
  production, avec `eguitra_rh`).
- À demander au cabinet : le questionnaire Word de préqualification (14 sections, une par domaine,
  section 19 : fiche de synthèse), qui pourrait devenir le formulaire du porteur au portail.
- 24 octobre, compléments du noyau demandés par le design du 22 octobre (commit f8154b0, en recette,
  pas en production : la session Local groupe la prochaine mise en production) : messages accordés au
  nombre dans tout le module (plus de « (s) », `scoring.pluriel`) ; par gate, critères encore à
  évaluer (`pending`, `pending_in_scope`) et knock-outs actifs que sa règle oppose
  (`knockouts_blocking`), pour le bloc « Ce qui bloque le prochain gate » ; liste des dossiers avec la
  recommandation de la méthode et les critères à évaluer (score provisoire). 67 tests AxisPro au vert.

**22 octobre : module RH (NIMOVA · RH)**, à la demande du gérant (« une gestion complète, simple et
intelligente des ressources humaines », carte blanche). La paie était hors du périmètre de l'offre
(chapitre 3) : évolution demandée par le gérant. Spécification : `docs/projet/rh/specification.md` ;
guide : `docs/guides/guide-rh.md` (et `word/Guide_rh.docx`).
- Fait, socle : profil « Ressources humaines » (`rh`, eguitra_base 19.0.1.5.0), application `rh`
  (administration, direction, RH ; les deux sociétés). Un compte lié à un dossier salarié en cours
  ouvre aussi l'espace, réduit à « Mon espace ».
- Fait, noyau (`addons/eguitra_rh`, 16 tests) : salariés (matricule EG-/AX- par société, fiche tiers
  pour le 422, éléments fixes, documents à échéance, historique du salaire avec motif), départements,
  absences en jours ouvrables (lundi au samedi, jours fériés de la Guinée 2026-2027, fêtes musulmanes
  2027 estimées), soldes de congés calculés (2,5 jours par mois, solde de reprise), décision par la
  RH, la direction ou le responsable hiérarchique, avances et prêts retenus sur la paie ; paie du mois
  (prorata, absences non rémunérées, heures majorées, prime par rotation des chauffeurs si
  paramétrée, CNSS 5 % et 18 % plafonnée à 2 500 000, RTS au barème du CGI art. 63 vérifié dans le
  texte officiel, exonération des indemnités forfaitaires dans la limite de 25 % du brut, VF 6 %,
  taxe d'apprentissage 2 %), contrôles avant validation, bulletin (net en lettres, cumuls), écriture
  de paie en brouillon dans le journal « Salaires » (SAL, créé au besoin ; 661/663/664/641, 431, 4472,
  4478, 4211, 422 au nom de chaque salarié, axe d'activité), export Excel (livre de paie, virements,
  CNSS, impôts), simulateur (du net au salaire de base), échéancier (fins d'essai et de CDD,
  documents, soldes élevés, paie non validée, fiches incomplètes, anniversaires). Revue de sécurité :
  références écrites dans un dossier contrôlées contre la société de travail (signalé par la session
  Transport).
- Fait, web : espace `/rh` (thème prune), 14 écrans (tableau de bord, salariés et fiche, absences et
  planning, avances, paie, bulletin imprimable, simulateur, Mon espace, paramètres, guide).
- Recette (22 octobre) : `eguitra_rh` installé, `eguitra_base` mis à jour, noyau redémarré,
  application web reconstruite ; données fictives chargées (`scripts/recette/donnees_demo_rh.py` :
  12 salariés des deux sociétés, documents à échéance, absences, une avance, paie de septembre
  validée) ; `recette.admin` reçoit le profil RH ; test.dg, test.exploitation, test.parc et
  test.consultant sont liés à des dossiers pour essayer « Mon espace ». Vérifié dans le navigateur :
  tableau de bord, paie de septembre, bulletin imprimable (montants recalculés à la main) ; et par
  l'API : libre-service de test.parc (son dossier, son solde, son bulletin ; liste du personnel 403,
  `/rh` renvoyé vers `/rh/moi`). Soldes de congés des dossiers fictifs élevés faute de solde de
  reprise : à la reprise réelle, saisir le solde et sa date pour chaque salarié.
- **À faire valider par l'expert-comptable et la CNSS avant la première paie réelle** : taux et
  plafond CNSS, SMIG, traitement des indemnités, taxe d'apprentissage ou contribution de 1,5 % à la
  formation professionnelle selon l'effectif, comptes de paie (CNSS par défaut sur la racine 431).
- **Gestion commune aux deux sociétés** (remarque du gérant : « comme le cas des finances »), commits
  200029c et 3fb7e95 : un seul service RH, mêmes listes et tableau de bord consolidé (filtre Société),
  employeur légal choisi à l'embauche, une paie par société préparées ensemble, départements communs
  (gérés par un compte ouvert aux deux sociétés, revue de sécurité de la session AxisPro) ou propres à
  une société, responsable hiérarchique de l'une ou l'autre ; taux, barème, congés, heures, alertes et
  comptes communs, numéro d'employeur CNSS, taxe de formation et journal propres à chaque société.
  Écrans de gestion fermés au libre-service (renvoi vers Mon espace, 32680ba). L'application `rh`
  n'est accordée que là où le module est installé (b215d21). 71 tests au vert (eguitra_rh,
  eguitra_transport ; eguitra_api et eguitra_base au passage précédent). Recette mise à jour et
  vérifiée (12 salariés des deux sociétés dans une liste, paie par société).
- **Production (22 octobre, 10 h 30, carte blanche du gérant)** : version 20261022-1030 (32680ba),
  `eguitra_rh` installé (ajouté à `MODULES` de `release.sh`, à `init-db.sh` et à `essai.sh`),
  sauvegarde prise juste avant ; vide de données (19 rubriques, 9 types d'absence, 18 jours fériés) ;
  contrôlé : noyau et applications sains, paramètres de connexion et grille AxisPro en vigueur
  inchangés. La direction et l'administration voient
  l'espace RH ; pour la personne chargée des RH, lui donner le profil « Ressources humaines »
  (Administration > Utilisateurs) à la place du profil cabinet provisoire. Saisie des dossiers et des
  congés possible dès maintenant ; **première paie réelle seulement après validation des taux** (point
  ci-dessus).

**22 octobre : ensembles gérés pour des propriétaires et coûts standard** (écarts 5.1 et 5.2 de
l'analyse du logiciel actuel, sur l'accord du gérant : « poursuis »). `eguitra_transport` 19.0.1.3.0.
- Fait, noyau : propriété de l'ensemble (propre, géré pour un propriétaire) et charges mensuelles
  (prorata des jours, charge annuelle au douzième) ; règles de répartition en % du chiffre d'affaires
  brut, par ensemble ou par catégorie ; relevés par ensemble et par période (frais déclarés et
  charges mensuelles, ou pièces comptabilisées sur l'ensemble, selon le paramètre ; les deux
  montants gardés), figés, imprimables (PDF) et exportables (Excel) ; pièces en brouillon (facture
  d'achat du propriétaire, refacturation d'une part négative, factures des commissions des tiers),
  supprimées si le relevé est rouvert. Coûts standard des routes (litres aller et retour, prime,
  péages, autres frais) et prix du carburant datés ; coût standard et marge estimée des rotations,
  mis à jour tant qu'elles sont saisies, figés à la validation ; rentabilité avec coûts standard ;
  contrôle des forfaits de carburant incohérents (écart de plus de 40 % à la médiane au km).
  Routes `/transport/share-rules`, `/transport/fuel-prices`, `/transport/owner-statements` (lecture
  administration, direction, finance ; écriture administration, finance). Piste d'audit étendue
  (migration 19.0.1.3.0). 10 tests ; 54 tests du module au vert sur base jetable.
- Fait, application web : onglet « Propriétaires » (relevés du mois, détail, PDF, Excel, pièces,
  règles de répartition), propriété et charges dans « Flotte et chauffeurs », forfaits et prix du
  carburant dans « Routes et tarifs », gain estimé dans le formulaire de rotation, marge estimée dans
  la liste tant qu'aucun frais n'est saisi, paramètres des relevés (base, comptes).
- Recette : module mis à jour (`-u eguitra_transport`), noyau redémarré, application web reconstruite.
- À décider avec l'expert-comptable : traitement des ensembles gérés (mandat ou commission) et comptes
  (par défaut 6223 part des propriétaires, 7078 refacturation, 6322 commissions, avec repli sur la
  racine) ; avec le client : contrats des propriétaires et du partenaire (questions 7 à 11 de
  l'analyse).
- Production : par `infra/release.sh` après validation du gérant (module transport à mettre à jour).

**24 octobre : compléments du Transport demandés par le design du 22 octobre** (feu vert du gérant,
relayé par la session Local ; en recette, pas en production : la session Local groupe la prochaine
mise en production). Commits bdcc83f, b6237dd, 678ea88.
- Liste des rotations : tri par le noyau sur toutes les colonnes (`sort`, « -clé » décroissant),
  pages de cent, marge minimale de la règle d'alerte renvoyée avec la liste (le taux de chaque ligne
  est jugé), taux de la marge estimée. Champs stockés pour trier ce que la ligne affiche : volume
  facturable, marge et taux déclarés ou estimés (`eguitra_transport` 19.0.1.4.0, `-u` sur la recette).
- Écriture des nombres : relevé du propriétaire (PDF), alertes et exports suivent la règle de
  `apps/web/lib/format.ts` (`eguitra_transport/nombres.py`) ; durée des rotations à une décimale dans
  l'export. Défaut des classeurs communs corrigé : « # ##0 » n'était qu'une espace littérale (Excel
  écrivait « 1234 568 », vérifié dans Excel), remplacé par « #,##0 » dans
  `eguitra_finance/controllers/exporting.py`. Le même format reste dans d'autres exports (budget,
  fiscalité, rapprochement bancaire, états, AxisPro), signalés à leurs sessions.
- Rotations mobile : délai de réponse facultatif dans `apiGet` et `apiSend` (8 s pour les listes,
  20 s pour l'envoi), pastille « Réseau faible » sur le dernier échange réel (coupé ou lent), date du
  dernier envoi gardée sur le téléphone, liste « Envoyées » qui ne reste plus en attente sans fin ;
  cache `rotations-v7`. Vérifié sur la maquette (réseau ralenti dans le navigateur, retour à la
  normale, date gardée après rechargement).
- Tests : 58 d'`eguitra_transport` au vert sur la base jetable `eguitra_ci_transport`, puis les
  classes touchées après le dernier correctif (liste, export, relevés : 15 tests). Recette : code
  commité seul envoyé (2a0f7c2), `-u eguitra_transport,eguitra_finance`, noyau et application web
  reconstruits ; 41 rotations recalculées, `rotations-v7` servi.

**22 octobre : NIMOVA · Transport, application à part entière** (décision du gérant : « TRANSPORT est
un module comme AxisPro Suite et Finance »).
- Noyau : application `transport` dans `organisation.py` (profils administration, direction,
  finance, exploitation ; société servie : EGUITRA GROUP). Liens des alertes et des constats
  d'Analyse vers les pages du transport (`/transport/rentabilite`, `/transport/rotations`,
  `/transport/manquants`). Contrôle du tiers propriétaire ou bénéficiaire (lisible, commun ou de la
  société de travail), à la suite de la revue de sécurité.
- Web : espace `/transport` (accent ambre) : tableau de bord (chiffres du mois, contrôles, rotations
  à traiter), Rotations, Manquants, Rentabilité, Propriétaires et répartition (direction et
  finance), Taxes spécifiques, Flotte et chauffeurs, Routes et tarifs, Paramètres ; registre des
  applications, navigation, accueil (rayon Transport), bascule des espaces, passerelle (en-tête
  X-Eguitra-App), garde des pages. Les écrans sont des composants partagés
  (`components/transport/`). L'ancienne adresse `/finance/transport` redirige ; l'entrée Finance >
  Métiers > Transport disparaît. Le profil exploitation garde Finance (engagements, validations).
- Maquette d'API : application transport, relevés, règles, prix du carburant, contrôles. Vérifié
  dans le navigateur sur la maquette (connexion, accueil, tableau de bord, relevés, pièces, flotte,
  charges, routes, gain estimé).
- Tests : 86 tests d'eguitra_api et d'eguitra_transport sur une base jetable séparée
  (`eguitra_ci_transport`, les sessions parallèles se gênant sur `eguitra_ci`), tous au vert pour le
  transport ; seul `test_admin` échoue, sur la version non committée de la session RH (profil « rh »
  attendu). Idée pour `infra/test.sh` (en cours de modification par une autre session) : un nom de
  base jetable paramétrable, pour que deux sessions testent en même temps.
- Recette : noyau à jour (redémarré par la session AxisPro). Application web à reconstruire : la
  construction échoue sur l'état intermédiaire des fichiers RH envoyés au serveur (`lib/nav.ts` abîmé,
  registre « rh » sans la coque correspondante) ; la session RH est prévenue. Ensuite `/transport`
  apparaîtra sur la recette ; l'écran Finance > Transport de la version en service porte déjà les
  relevés des propriétaires et les coûts standard.
- Production : en service depuis la version 20261022-1012 (22 octobre, 10 h 13 ; code e396cf6 ;
  release.sh mené par la session AXISPRO SUITE après 342 tests sans échec et une répétition générale
  sur une copie de la base de production). Vérifié : /transport et sa connexion, transport
  19.0.1.3.0, quatre nouvelles tables, piste d'audit des onze modèles du transport, journal sans
  erreur, double authentification toujours coupée (mfa_required = 0, demande du gérant).
- Constat à traiter à part : la passerelle web refuse toute route `/auth/*`, si bien que
  `useSaisieLibre()` et `useAchatsSeul()` (lecture de `/auth/me` dans le navigateur, `lib/api-client.ts`)
  reçoivent toujours 404 ; l'écran Transport lit donc ses droits dans `/transport/settings`
  (`sees_accounts`).

**21 octobre fin d'après-midi : mise en production 20261021-1505 et comptes du client.**
- Décisions du gérant sur la liste des utilisateurs : un vrai profil « Achats » pour la responsable
  des achats ; module RH plus tard (la personne concernée reçoit en attendant le profil cabinet) ; société
  nommée « MB AxisPro » ; « Chantiers » renommé « BTP » à l'écran ; on n'attend pas nimova.gn pour
  ouvrir la production.
- Fait : profil Achats (engagements, pièces d'achat, fournisseurs sans soldes, demandes, guide
  `docs/guides/guide-achats.md`) ; 315 tests au vert ; mise en production 20261021-1505 ; production
  ouverte sur les adresses provisoires `*.178-33-206-212.sslip.io` ; sept comptes du client créés
  (chapitre 6).
- À faire : remettre à chacun son identifiant, son mot de passe provisoire et l'adresse (le gérant,
  depuis le fichier protégé du serveur) ; saisir l'identité des sociétés ; bascule vers nimova.gn dès
  la finalisation (`infra/domaines.sh`) ; reprise des données en production après le choix de la
  convention d'amortissement.

**21 octobre après-midi : convention d'amortissement des biens repris, essai outillé, domaines.**
- Les trois conventions de la décision 1 sont prêtes, au choix de l'expert-comptable, par une seule
  variable `REPRISE_CONVENTION_AMORTISSEMENT` (reprise.sh) et l'option `--convention` du contrôle :
  `plateforme` (défaut, rattrapage de l'écart de reprise en janvier, dotations de l'exercice
  d'environ +10 %), `fin-de-plan` (écart reporté sur la dernière dotation du plan, environ +0,8 %),
  `prototype` (mois entiers à compter du mois qui suit l'acquisition, arrondis seulement). Détail :
  `scripts/reprise/README.md`. `eguitra_finance` 19.0.1.6.0 avec migration ; paramètre système
  `eguitra_finance.takeover_gap` (`first` ou `last`) pour les reprises faites ensuite à l'écran.
  Note de réponse aux attentes (décision 1) mise à jour et régénérée.
- Tests : 304 au vert sur les neuf modules avant la fusion ; `eguitra_finance` seul ensuite,
  120 au vert (dont les 6 de `TestTakeoverConventions`). Le test de la piste d'audit exigeait les
  modèles d'`eguitra_approval` même quand ce module n'est pas installé (test d'`eguitra_finance` seul) :
  corrigé. Recette mise à jour (`-u eguitra_finance`, noyau redémarré). La production recevra
  19.0.1.6.0 à la prochaine mise en production, menée par la session « AXISPRO SUITE » avec le profil
  Achats (qui prendra 19.0.1.7.0 s'il modifie `eguitra_finance`).
- Essai de reprise outillé : `scripts/reprise/essai.sh dossier` (base jetable `eguitra_reprise_essai`,
  copie de la base modèle des tests, reprise enregistrée, dotations jusqu'à la date d'arrêté et
  résultat « n/26 » par `validation.py`, sans montant) remplace `~/essai_complet.sh` et
  `~/validation_essai.py`. Essais du 21 octobre sur le dossier réel, 18/26 dans les deux cas, comme
  le contrôle hors ligne : convention `plateforme`, dotations +10,0 % et résultat net -50,8 % ;
  convention `fin-de-plan`, dotations +0,77 %, résultat net -3,9 %, capitaux propres -0,14 %, totaux
  du bilan -0,05 % (20 biens sur 24 portent un écart de reprise sur leur dernière dotation). La
  convention `prototype` reste à essayer dans la plateforme (dossier converti par `dossier_json.py
  --convention=prototype`).
- Domaines : `infra/domaines.sh verifier|appliquer nimova.gn` contrôle les enregistrements A (finance,
  axispro, portail, recette, noyau), inscrit les noms dans `infra/.env` (copie de l'ancien fichier),
  recrée le proxy et contrôle le HTTPS. nimova.gn commandé chez Afribone, en attente de finalisation ;
  d'ici là la production est servie sur des adresses provisoires `*.178-33-206-212.sslip.io` (session
  « AXISPRO SUITE », ancien `.env` copié dans `infra/secrets/env.avant-domaines-provisoires`). Après
  la bascule : rétablir la double authentification de la recette si les tests sont finis.
- Logo NIMOVA « le pli » (session design, validé par le gérant) fusionné et en recette (application
  web reconstruite, commit 76732c4) ; cache hors ligne de Rotations passé en `rotations-v3` pour
  livrer les nouvelles icônes. En production depuis la version 20261021-1536.
- Engagement de confidentialité court du prestataire, à signer avant la remise des données réelles
  (`docs/projet/Engagement_de_confidentialite.docx`, générateur `engagement-de-confidentialite.js`),
  en complément de l'accord réciproque. Engagements à tenir : réglage de confidentialité de
  l'assistant d'IA (pas d'entraînement), disque du poste chiffré, base d'essai `eguitra_reprise_essai`
  (données réelles, grappe de recette) à effacer dès la convention d'amortissement décidée.
- Recette : un mot de passe commun à tous les comptes, que personne ne modifie, à la demande du
  gérant (`scripts/recette/mot_de_passe_commun.py`, paramètre `eguitra_api.shared_password` ; refus
  403 `password_locked` des changements et réinitialisations). Valeur choisie par le gérant, dans le
  fichier protégé du serveur `infra/secrets/recette-mot-de-passe-commun.txt`. Tests de l'API : 32 au
  vert (test du profil Achats rendu valable sans `eguitra_finance` installé).
- Poste de travail : disque C: saturé le 21 octobre (0 octet libre, fusion git impossible) ; place
  libérée par le gérant. Surveiller l'espace libre avant les constructions et les analyses de vidéo.

**21 octobre : analyse du logiciel de transport actuel** (vidéo de présentation reçue par le gérant,
43 minutes). Le logiciel est Datakö Fleet Manager (service en ligne, formule Business) : 5 citernes,
8 conducteurs, 13 routes, environ 45 rotations en 2026, historique de mai à octobre. Synthèse,
comparaison avec `eguitra_transport`, correspondance des données et questions au client :
`docs/projet/analyse-systeme-transport-actuel.md`. La vidéo, les images, la transcription et les notes
détaillées restent hors du dépôt (données du client ; `.gitignore` exclut les vidéos).
- Constats : outil de pilotage aux coûts forfaitaires (carburant au prix officiel du mois, recalculé
  rétroactivement), sans facture ni comptabilité, encaissement coché par livraison ; chiffre d'affaires
  sur le livré, manquant sans tolérance (fret perdu seulement). NIMOVA réglé sur « constat seulement »
  reproduit ce calcul.
- Écarts à combler, proposés au gérant : camions gérés pour des propriétaires tiers avec règles de
  répartition et relevé mensuel (5.1), coûts standard par route et gain estimé figé à la saisie (5.2),
  dossier de livraison (5.3), documents et conformité des véhicules (5.4), simulation d'investissement
  (5.5). Décision du gérant attendue sur le périmètre (offre ou évolution).
- Reprise : demander à Datakö un export complet (l'export Excel des livraisons arrondit le tarif et omet
  conducteurs, coûts et encaissements) ; expliquer l'écart entre 383 rotations (classeur cité par
  l'offre) et environ 45 dans Datakö.
- Analyse chiffrée (même jour) : valeurs de la vidéo relevées et recalculées au franc près ; classeur
  confidentiel remis au gérant, hors dépôt (scratchpad de la session). Conclusions sans montants au
  chapitre 9 du document : marge de Datakö sans salaires, entretien réel, amortissement ni crédit-bail ;
  flotte peu employée ; camions gérés à l'arrêt ; forfaits de carburant incohérents ; simulateur sans
  charges variables. Deux questions ajoutées (26 au total).
- Convertisseur `scripts/reprise/datako.py` (export « Livraisons » de Datakö vers `routes.csv`,
  `ensembles.csv`, `rotations.csv`, avec tarifs à deux décimales, forfaits de route et prix mensuel du
  carburant en compléments) ; testé sur les livraisons d'octobre relevées : chiffre d'affaires
  retrouvé au franc. Documenté dans `scripts/reprise/README.md`.

**19 octobre : rechargement sans fin de la page de changement du mot de passe** (signalé par le gérant
après réinitialisation du mot de passe de `test.dg` en recette). Cause : le cadre de la page interroge
`/finance/shell` (en-tête de Finance, ajouté le 17 octobre) pour les profils administration, direction
et finance ; le noyau refuse tout appel tant que le mot de passe est provisoire (403
`password_change_required`) et `apps/web/lib/api-client.ts` renvoyait alors vers la même page.
Corrigé dans l'application web seule (commit b0c4182) : l'en-tête n'interroge plus l'API pendant un mot
de passe provisoire, et le client ne redirige plus vers la page quand il s'y trouve déjà. Reproduit puis
vérifié dans Chromium (maquette d'API et relais imitant le refus du noyau) : 140 chargements en
8 secondes avant, page stable après, changement mené à son terme.
- À faire : déployer en recette (`scripts/dev/sync.sh`, puis `docker compose up -d --build web-recette`
  sur le serveur) ; puis en production par `release.sh` avant de créer les comptes du client, qui
  recevront tous un mot de passe provisoire (la production a le même défaut depuis la version
  20261017-2328).


**18 octobre : NIMOVA · Analyse** (demande du gérant, carte blanche : module d'analyse de données de
niveau expert, différent selon la société). Spécification et contrat d'API :
`docs/projet/analyse/specification.md` ; guide : `docs/guides/guide-analyse.md`.
- Fait, noyau (`addons/eguitra_analytics` 19.0.1.0.0, lecture seule, Python pur) : moteur statistique
  (`engine/` : statistiques robustes, régression, Lorenz, Gini, HHI, Holt-Winters et Holt avec
  validation glissante, Monte-Carlo à graine fixe, CUSUM, loi de Benford selon Nigrini, Kaplan-Meier,
  kappa de Cohen, constats classés par impact) ; EGUITRA GROUP en huit sections (cockpit et santé sur
  cinq axes, rentabilité et pont d'EBE volume-prix-mix, trésorerie à 13 semaines par Monte-Carlo sur
  les délais réels des clients, clients, flotte et routes, dépenses et contrôles, atterrissage et
  élasticités, fiabilité des données) ; MB AxisPro en sept sections (cockpit et pipeline pondéré,
  portefeuille et durées dans les gates, diagnostic des faiblesses systémiques, qualité des décisions,
  financements, activité et honoraires, risques et exécution) ; environ 75 règles de constats ; routes
  `/api/v1/analyse/...` cloisonnées par société et par profil. 34 tests au vert ; les 30 routes
  répondent en moins d'une seconde sur la recette.
- Fait, application web : espace `/analyse` (« NIMOVA · Analyse », tuile de l'accueil, bascule à trois
  espaces), navigation et contenu selon la société de travail, kit de visualisation en SVG sur les
  jetons NIMOVA (cascade, carte de chaleur, Lorenz et Pareto, entonnoir, sankey, treemap, bulles à
  quadrants, éventail de prévision, radar, Benford, puces, petits multiples, matrice de risques), mode
  nuit, impression, simulateur ; maquette d'API alignée sur le noyau. Écrans vérifiés dans le
  navigateur sur les réponses réelles de la recette (deux sociétés, deux périodes).
- Déployé en recette puis en production (version 20261018-0806, 18 octobre). Application `analyse`
  inscrite au noyau (`organisation.py`), dans `release.sh` (qui installe désormais un module nouveau)
  et `init-db.sh`.
- Réglages : `eguitra_analytics.cabinet_hourly_rate` (taux horaire de référence du cabinet, sinon déduit
  des factures) et `eguitra_analytics.cabinet_cost_ratio` (taux de revient du temps, 0,40 par défaut).
- Export Excel de chaque écran (19 octobre) : route `/analyse/<société>/<section>.xlsx`, mêmes période et
  droits que la route JSON ; onglets Synthèse, Constats, puis un par bloc, intitulés en français
  (`controllers/libelles.py`) ; bouton « Excel » dans l'en-tête de chaque écran.
- Limite : la marge par activité n'est mesurable que si les achats portent l'activité analytique (sinon
  « non mesurable »).

**17 octobre : conformité aux prototypes du DGA (M. Diallo) et au courrier du responsable financier
(M. Kalissa)**, demandée par le gérant (« tout en mieux », carte blanche). Sources : prototypes
reçus le 14 septembre, conservés hors dépôt ; courrier : `docs/client/2026-09-courrier-responsable-financier.md`.
- Fait, AxisPro (module 19.0.1.2.0, migration) : méthode MB AxisPro du prototype (réf.
  MBAP/PROJECT-DEVELOPMENT/SC-01) dans `addons/eguitra_axispro/scoring.py` : statuts et points du
  prototype, non évalué compté non disponible, requalification sans toucher la saisie (preuve
  manquante sur un critère exigeant, preuve périmée), scores Project Readiness, APD Readiness (hors DD,
  SPV, closing) et Bankability, knock-outs (incomplet bloquant), priorité des écarts (formule de la
  colonne P), data room alimentée par les preuves des critères (42 pièces, 102 rattachements), huit
  règles de passage des gates, cinq classes, recommandation BANKABLE / APD READY / CONDITIONAL GO /
  HOLD / NO-GO. Décisions prises : portée « cumulée » (critères des gates atteints) pour les seuils des
  gates 1 et 2, sinon inatteignables tôt ; pondération à plat pour la grille officielle, par domaine
  pour les anciennes ; recommandation « à compléter » tant que les critères des gates atteints ne sont
  pas tous évalués ; décision HOLD au comité, motif obligatoire pour HOLD et NO-GO. En plus du
  prototype : décision scellée (HMAC-SHA256 avec le secret du serveur) qui fige le dossier jusqu'à
  une nouvelle révision, vérification de l'empreinte, journal du dossier, passage de gate forcé et
  motivé, devise par dossier, contrôles de cohérence (investissement, financements, suggestions du
  modèle financier), rapports PDF (comité, pièces à fournir, aussi au portail), classeur au plan du
  modèle du cabinet (Dashboard, Scoring, Gaps_Prioritaires, Data_Room_Index, Stage_Gate, Politique),
  fiche d'évaluation exportable et réimportable (par code ou par intitulé, aperçu), export JSON, data
  room compressée. Écrans : synthèse « où en est le dossier », check-list par domaine (saisie guidée,
  filtres, preuves déposées sur le critère avec validité), gates, comité, journal, grille (réglages de
  la méthode, règles des gates). Tests : `tests/test_methode.py` (formules et parcours), 41 tests
  AxisPro au vert.
- Fait, grille officielle : `scripts/grille/extraire_prototype.py` tire du prototype le classeur
  d'import (111 critères, 15 domaines, 8 gates, 42 pièces, 9 knock-outs) ; importée et en vigueur en
  recette (« Grille officielle MB AxisPro (SC-01) », version 2) avec un dossier fictif « Centrale
  solaire de Kindia (démonstration) ». Le classeur n'est pas versionné (document du client).
- En cours (agents dans des arbres de travail séparés, à fusionner, tester et déployer) : Finance
  selon le prototype EGUITRA_App et les vingt attentes (axes analytiques multiples et imputations,
  budget réparti, fiscalité et retenues, immobilisations, clôture mensuelle complète, réévaluation
  des devises, produits transportés, manquants et taxes spécifiques, pilotage et alertes).
- Fait, exploitation (courrier, attentes 16 et 18, à appliquer en production à la prochaine
  `release.sh`, qui reconstruit désormais la base et les sauvegardes si leur configuration change,
  puis relancer `infra/monitor-install.sh`) : archivage des WAL toutes les 5 minutes et copie hors
  site dans les 5 minutes suivantes (perte de 15 minutes au plus même en cas de perte du serveur),
  alerte au-delà de 15 minutes et si la copie hors site exigée (`OFFSITE_REQUIRED=1`) n'est pas
  configurée ; supervision de la double authentification en production et sonde externe
  (`HEARTBEAT_URL`) ; restauration trimestrielle à un instant donné avec compte rendu ; rapport
  mensuel de disponibilité (`infra/availability-report.py`) hors maintenances, que `release.sh`
  inscrit ; procédure de support (`docs/projet/procedure-de-support.md`) et dossier technique
  (`docs/projet/dossier-technique.md`) ; cahier de recette mis à jour.
- Fait, finance (fusion des agents, tests du serveur au vert après correction de leurs jeux
  d'essai) : pilotage (BFR, flux mensuels et prévision, dette réglée depuis le relevé, alertes à
  quatre gravités, tableau de bord et questions du dirigeant, rapport mensuel enrichi, balance âgée,
  guide intégré `/finance/guide`) ; fiscalité (retenues à la source configurables, déclarations et
  historique), immobilisations (dotations mensuelles, reprise des biens en service), clôture
  mensuelle complète (dotations, liquidation de la TVA, factures à établir, sceau, PV), réévaluation
  des devises, exports des états, IFRS (pertes attendues, passerelle), SAF-T. Matrice des pertes
  attendues unique (Fiscalité > IFRS) pour le tableau de bord et la clôture.
- Fait, engagements de dépense (attente 10, `eguitra_approval` 19.0.1.2.0) : engagement approuvé
  avant la commande (mêmes seuils que les pièces : finance, direction au-delà de 50 M), devis joint,
  consommation par les pièces d'achat qui ne refont pas le circuit dans la limite du reste à engager
  (tolérance 5 %, paramètre `eguitra_approval.commitment_tolerance_pct`) ; écran `/finance/engagements`.
  Engagement proposé à la saisie d'une pièce d'achat du fournisseur, colonnes « engagé » et
  « disponible » du suivi budgétaire, état « Engagements de dépense non soldés » au registre des
  rapports.
- Fait, décaissements (attente 10, nature « Décaissements de trésorerie », direction au-delà de
  100 M) : sorties de caisse et de banque saisies, imputation directe d'une ligne de relevé,
  règlement d'une échéance d'emprunt et virement interne restent en brouillon et passent au circuit
  au-delà du seuil ; comptabilisés à la dernière approbation (l'entrée d'un virement suit sa sortie).
- Fait, analytique et budget (fusion) : axes analytiques tenus par la finance, saisie multi-axes,
  imputations automatiques et imputation obligatoire, trésorerie (modes de paiement, types
  d'opération, justificatifs), état de rapprochement et soldes des relevés, budget par ligne
  budgétaire affecté aux activités et centres de coût, catégories de dépense, fiche tiers enrichie,
  litiges, plan comptable tenu par la finance. Transport (fusion) : produits paramétrables,
  manquants tolérés et excédentaires (déduction, créance chauffeur, 15 °C, capacité), taxes
  spécifiques au barème et état mensuel, rentabilité avec coûts comptabilisés et structure au km ;
  questions au client dans `docs/projet/cadrage-transport.md`.
- Fait, piste d'audit (attente 14) étendue à tous les modèles de gestion (finance, immobilier,
  AxisPro), avec test de couverture.
- Versions : `eguitra_finance` 19.0.1.5.0, `eguitra_approval` 19.0.1.2.0, `eguitra_transport`
  19.0.1.2.0, `eguitra_immobilier` 19.0.1.1.0, `eguitra_axispro` 19.0.1.2.1 ; mise à jour avec
  `-u` de ces modules puis redémarrage du noyau (module d'audit).
- Fait, vue consolidée (attente 2) : compte de résultat et bilan par société, éliminations des
  opérations entre sociétés du groupe, groupe (États > Consolidé du groupe). Les frais communs
  s'éliminent dès qu'ils sont refacturés ; leur clé de répartition attend la décision du client.
- Fait, validation de la reprise (offre 6.3) : valeurs du classeur de référence chargées depuis un
  fichier (jamais dans le dépôt), recalculées avec les définitions du classeur, « n/26 » et annexe du
  PV de bascule (Clôtures et contrôles).
- Tests : `infra/test.sh` installe puis teste dans un second processus (le module d'audit court-
  circuitait sinon les surcharges de create et write chargées après la pose de ses règles, comme le
  fait la production avant redémarrage) ; `module:Classe` lance une seule classe. 243 tests au vert
  sur les huit modules le 17 octobre ; recette mise à jour (sauvegarde de la recette prise avant).
- Fait, reprise du dossier du prototype (`scripts/reprise/`, à essayer sur la recette) :
  `dossier_json.py` convertit le dossier JSON du prototype (schéma 1) en fichiers de reprise selon
  l'imputation du moteur du prototype (à-nouveaux client et fournisseur éclatés par facture avec
  échéance et référence, ventes et achats avec TVA, trésorerie lettrée par référence et en devise,
  OD sauf dotations, immobilisations avec cumul au 31/12, emprunts et échéances payées, budget,
  rotations en m³, référentiels du transport) ; `reprise.py` crée désormais les comptes absents (nature
  du voisin), activités et centres de coût par code, journaux de banque et de caisse, catégories
  d'immobilisations, routes, chauffeurs, ensembles, emprunts (eguitra.loan en cours), fiches tiers
  enrichies (code, conditions, limite, non-assujetti, secteur, interlocuteur), lettre par référence,
  accepte devise, échéance et budget à préfixes multiples ou résiduel. `extraire_reference.py` lit
  les 26 valeurs de référence du prototype, `controle_reference.py` les recalcule sur les fichiers
  comme la plateforme les comptabilisera : 18 conformes ; les 8 autres (dotations, résultats,
  capitaux propres, totaux de balance et de bilan) ont une seule cause, la convention
  d'amortissement (prototype : mois entiers à compter du mois suivant l'acquisition ; plateforme :
  prorata au jour de la mise en service, l'écart de reprise des biens rattrapé sur la première
  dotation 2026). **Décision à prendre avec l'expert-comptable** : accepter ce rattrapage, ou porter
  l'écart de reprise en fin de plan (modification d'`eguitra_takeover`, mesurée par
  `--ecart-reprise=derniere` : ne resterait que le prorata du mois d'acquisition des biens acquis dans
  l'exercice). Troisième voie mesurée, permanence des méthodes (`dossier_json.py
  --convention=prototype`) : plan en méthode « nombre de dotations » du module, posée bien par bien,
  à compter du 1er du mois qui suit l'acquisition ; il ne reste que de l'arrondi (dotation mensuelle
  constante arrondie au franc, le prototype arrondit le cumul), au-delà toutefois de la tolérance de
  10 GNF du prototype ; non appliquée par `reprise.py` tant que la convention n'est pas décidée. Autres
  points : taux des emprunts absents du dossier (0 par défaut ; `--taux-implicites` reprend le taux
  déduit des échéances) ; à-nouveau des emprunts à vérifier avec le client (compte rendu de
  conversion, hors dépôt) ; ne pas importer les relevés bancaires de la période reprise (comptés deux
  fois) ; activité du transport nommée « Transport pétrolier » par le module (le dossier a la sienne).
  Fichiers produits et rapports hors dépôt.
- Fait, 17 octobre après-midi :
  - import des relevés ISO 20022 camt.053 (XML) à côté du CSV et du XLSX (soldes OPBD et CLBD,
    opérations en attente ignorées) ;
  - revue de code de la méthode AxisPro traitée (deux points élevés : classeur d'évaluation en échec
    avec des preuves datées et non datées, sommaire de la data room exposé aux formules ; sept moyens :
    sceau étendu et vérifié sur les colonnes affichées, portail sans les critères de la grille, import
    de grille strict, pièces antérieures à la décision figées, anomalie CAPEX, réimport du classeur,
    évaluation calculée une fois) ; huit tests, 49 tests AxisPro au vert ; écrans vérifiés dans le
    navigateur sur les réponses réelles de la recette (aperçu local, sans connexion à la recette) ;
    scores affichés sans arrondi au-dessus d'un seuil ;
  - activité analytique du transport paramétrable par société (Transport > Paramètres) ; relances
    étendues aux créances reprises (à-nouveaux et écritures de reprise) ; comptes 52x et 57x créés en
    trésorerie ;
  - vérification point par point de l'audit du prototype Finance (S2 à S20) : six écarts restants,
    confiés à un agent (export des rotations, export des flux mensuels, en-tête du registre,
    seuils codés en dur, part d'emprunt des types d'opération, droit de saisie libre des comptes) ;
  - dossier de conception (règles, vingt attentes), cahier de recette (73 scénarios), guide de la
    finance et note de réponse aux vingt attentes (`docs/projet/Reponse_aux_attentes.docx`) à jour ;
  - essai de la reprise du dossier réel sur une base jetable de la recette (`eguitra_reprise_essai`,
    simulation) : quatre anomalies bloquantes relevées et corrigées (comptes de l'ancien classeur sans
    racine à trois chiffres dans le plan de la localisation, d'où un à-nouveau déséquilibré) ;
    `extraire_reference.py` produit désormais le fichier chargé par la plateforme (codes et date
    d'arrêté) ; activité du transport et seuils de la direction repris de `parametres.json`.
  - fusion des écarts du prototype Finance (agent) : export des rotations (L/100 km), export des flux
    mensuels sur le calcul du tableau de bord, en-tête du registre des immobilisations, seuils à 0 sans
    jugement codé en dur (« seuil non fixé »), types d'opération à part d'emprunt (déblocage ;
    capital et intérêts hors échéancier), droit « Saisie libre des comptes » accordé d'office aux
    comptes actuels (finance, direction, administration) ; `eguitra_finance` 19.0.1.5.0 avec
    migration, `eguitra_transport` 19.0.1.2.0 ; 268 tests au vert sur les huit modules (203 pour api,
    finance, approval et transport, 65 pour les autres) ; recette mise à jour (`-u`, noyau redémarré).
  - **Reprise réelle essayée de bout en bout** sur la base jetable `eguitra_reprise_essai` (grappe de
    recette, données réelles du client ; fichiers dans `~/reprise-essai` du serveur, scripts
    `~/essai_complet.sh` et `~/validation_essai.py`) : 724 pièces, 206 lettrages, 24 immobilisations,
    4 emprunts (taux implicites), 383 rotations, budget, seuils et activité du transport ; dotations
    jusqu'au 15/08/2026 ; **18/26 dans la plateforme**, comme le contrôle hors ligne. Les 8 écarts ont
    une seule cause, la convention d'amortissement (décision 1 de la note de réponse aux attentes) ;
    bilan équilibré. Corrigé en route : mesures de la validation (créances et dettes sur 41 et 40,
    CA et achats TTC par journal, aucune tolérance sur les nombres, report à nouveau), report à
    nouveau du classeur repris au 121000, pièces d'achat au journal des achats, rotations non
    facturées validées. Écart de 2,5 Md GNF entre échéanciers et comptes d'emprunts : déblocage
    d'EMP-03 apparemment compté deux fois dans l'à-nouveau du classeur, à confirmer avec le client.
- Reste : décision sur la convention d'amortissement (puis 26/26 attendu, aux arrondis près) ; taux
  réels des emprunts et à-nouveau du 162 à confirmer ;
  décisions de droits signalées par l'agent transport (le parc modifie la fiche tiers d'un
  chauffeur et les coefficients à 15 °C ; la finance d'une société modifie un produit commun) ;
  choix comptables à valider avec l'expert-comptable (règlement d'échéance par le 401 du prêteur,
  factures à établir hors taxes, pas de provision de change, comptes 6588 et 4211 des manquants).

**Décisions du gérant, 16 octobre (suite de la vérification de l'organisation)** :
- Autres services de MB AxisPro (formation et coaching, conseil, audit d'évaluation des transporteurs,
  certification) : facturés depuis Finance ; modules dédiés plus tard. Fait : activités analytiques du
  cabinet créées à chaque mise à jour d'`eguitra_axispro` (Gestion de projets, Formation et coaching,
  Conseil, Audit d'évaluation des transporteurs, Certification), proposées à chaque ligne de facture ;
  les honoraires des dossiers AxisPro relèvent de « Gestion de projets ».
- Transport : créer un module de gestion du transport couvrant tout le pôle Transport & Logistique
  d'EGUITRA (miniers, pétroliers, conteneurs, personnel, location de véhicules, taxi). Hors offre
  (nouveau module). Cadrage et questions au client : `docs/projet/cadrage-transport.md`.
- Comptabilité (frais communs aux deux sociétés, refacturation) : le client reviendra vers nous.
- Adresse du portail des porteurs : question reformulée au gérant (domaine du cabinet ou
  nimovagroup.com).
- Accueil NIMOVA (session design, tuiles des modules) fusionné et déployé en recette, avec un
  correctif : sur axispro.*, sans cookie, l'accueil et la racine ouvrent AxisPro et non Finance.

**Fait le 16 octobre** : retouches du design NIMOVA fusionnées (accueil d'AxisPro en portefeuille, fiche dossier, comités, temps, pièces standard, bascule « Finance | AxisPro » en tête du menu, pages introuvable et d'erreur ; `docs/design/JOURNAL.md`) et déployées en recette avec le module AxisPro 19.0.1.1.0 ; guide de démonstration PowerPoint mis à jour (repères de l'écran NIMOVA, société dans la colonne de gauche, accueil d'AxisPro, portail avec le compte `porteur.demo`).

**Fait le 16 octobre, demandé par le gérant : AxisPro Suite en mode expert** (au-delà du chapitre 3.7 de l'offre), en recette.
- Fait côté noyau (`addons/eguitra_axispro`, version 19.0.1.1.0, migration de la piste d'audit) : moteur financier `engine.py` (comptes prévisionnels SYSCOHADA, BFR, échéanciers d'emprunts avec différé, impôt avec report des déficits, exonération et minimum, VAN, TRI projet et fonds propres, DSCR, LLCR, délai de récupération, point mort, plan de financement initial, alertes, sensibilités de -20 % à +20 %, trois scénarios, baisse supportable du prix et des volumes) ; modèles `axispro.plan` et lignes, registre des risques (probabilité × impact, criticité résiduelle), plan d'actions (écarts de la grille, conditions du comité à son verrouillage, traitement des risques ; compte rendu du porteur au portail, validation du cabinet), financements recherchés par financeur ; critères de la grille adossés à un indicateur (colonnes facultatives `indicateur`, `seuil`, `seuil_partiel`) avec statut suggéré ; indicateurs financiers figés dans l'instantané des comités et comparés ; tableau de bord du portefeuille (`/axispro/portfolio`) ; export XLSX du modèle ; rapport enrichi. Tests : `tests/test_expert.py`.
- Écrans (`apps/web/components/axispro/`) : onglets Modèle financier (hypothèses modifiables sur place, indicateurs, alertes, graphiques, comptes prévisionnels, plan de financement initial, sensibilités, scénarios, marges de sécurité, export XLSX), Risques (matrice et registre), Actions, Financements ; synthèse enrichie ; statut suggéré dans l'évaluation ; indicateurs financiers dans la comparaison des comités et dans le rapport ; pilotage du portefeuille sur l'accueil `/axispro` ; pages transverses Plan d'actions et Financements ; indicateurs réglables dans la grille ; actions du porteur au portail (compte rendu, validation du cabinet). Vérifiés dans le navigateur sur un aperçu local alimenté par les réponses réelles de la recette (grand écran et téléphone de 375 px, sans débordement), et sur la recette par l'API (toutes les routes, exports XLSX). Correction transversale : la largeur passée à un champ (`w-…`) remplace enfin le `w-full` de base (`ui.tsx`).
- Données de démonstration : `scripts/recette/donnees_demo_expert.py` (recette seulement, contrôle du libellé d'environnement) : briqueterie bancable (TRI 26,6 %, DSCR minimal 1,94), séchage de mangues avec alertes (trésorerie négative, DSCR en première année), risques, actions, démarches ; critères C007 et C008 de la grille de démonstration adossés à l'apport et au DSCR. Guides du cabinet et du porteur mis à jour.
- À faire : porter les routes du mode expert dans la maquette d'API du design (`docs/design/maquette-api`) si la session design doit retoucher ces écrans ; faire valider le mode expert par le cabinet sur la recette.
- Ensuite, demandé par le gérant : vérifier point par point l'organisation (deux sociétés distinctes du même groupe, même DG et même bâtiment ; finance commune mais comptabilités séparées ; AxisPro Suite et portail réservés à MB AxisPro ; d'autres applications à venir ; profils ouverts à tout ou à une seule application).

0. **Mis de côté le 15 octobre, à reprendre avec le gérant** : nouvelle identité du SIG, « NIMOVA », envoyée par le DG (« le fondamental reste », « l'outil doit être unique à nous ») et choix du nom de domaine (nimova.com, nimova.cloud ou nimovagroup.com). Message et fichiers : `docs/client/2026-10-15-identite-nimova/`.
1. Prérequis client à relancer (bloquants pour la reprise et la mise en production) : charte graphique et logos, classeur 2026 (dernière version), relevés bancaires 2026, plan de comptes et contact de l'expert-comptable, liste des utilisateurs par profil, grille AxisPro officielle (111 critères) et liste des pièces de la data room, accès aux noms de domaine.
2. Stockage objet hors site (second hébergeur, environ 100 Go) : créer le bucket, remplir `infra/backup.env`.
3. Noms de domaine : `nimova.gn` commandé le 21 octobre chez Afribone (DNS gérés par Afribone), en attente de finalisation. Ensuite : enregistrements A vers 178.33.206.212 pour finance, axispro, portail (ou le domaine du cabinet), recette et noyau ; renseigner FINANCE_DOMAIN, AXISPRO_DOMAIN, PORTAIL_DOMAIN, RECETTE_DOMAIN et CORE_DOMAIN dans `infra/.env` et recharger le proxy (déjà en service, ports 80 et 443 ouverts) ; rétablir la double authentification de la recette avant de l'ouvrir sous ce nom.
4. Reprise des données dès réception du classeur : remplir les modèles de `scripts/reprise/modeles/` (tiers, soldes d'ouverture, écritures, budget, rotations 2026), contrôler puis appliquer sur la recette ; immobilisations et emprunts par les écrans. Relevés bancaires 2026 par l'écran Trésorerie.
5. Validation du plan de comptes et des correspondances des états SYSCOHADA avec l'expert-comptable ; paramétrage des seuils d'approbation et d'alerte avec le DG.
6. Première connexion du gérant à la production (`m.kouyate`), puis création des comptes du client avec leurs sociétés ; jamais de données de démonstration en production.
7. Dossier de conception : relire `docs/projet/Dossier_de_conception.docx` (régénérer après modification du Markdown : `node docs/projet/dossier-de-conception.js`) et le faire signer.
8. Formation des référents (guides Word de `docs/guides/word/`) et recette avec `docs/projet/Cahier_de_recette.xlsx`.
9. Destinations des alertes de supervision (`ALERT_WEBHOOK_URL` ou `ALERT_NTFY_URL`) et serveur d'envoi de courriel (relances par courriel, comptes rendus) : à obtenir du client, puis `infra/mail-server.sh production`.
10. Annoncer aux porteurs les formats acceptés pour la data room (PDF, JPEG, PNG, DOCX, XLSX) : les anciens .doc et .xls, les ZIP et les fichiers à macros sont désormais refusés.
11. Avant la bascule : suivre `docs/projet/Plan_de_bascule.docx` (gel de la recette, reprise définitive, contrôles, annonce 48 heures à l'avance).

## 8. Points ouverts et risques

- Double authentification pour les agents du parc (Rotations) : maintenue, l'offre l'exige pour tous (chapitre 5.3) ; le renouvellement de session de 30 jours limite la gêne. Prévoir un téléphone par agent avec une application d'authentification.
- Les volumes 2026 cités dans l'offre (7 activités, 9 centres de coût, 383 rotations, etc.) proviennent de l'offre du 15 septembre, établie sur le classeur arrêté au 15 août ; à revérifier sur le classeur définitif avant la reprise.
- Les référents doivent être disponibles une demi-journée par jour ; toute absence se note au comité.
- Expert-comptable attendu en semaine 2 pour valider le plan de comptes.
- Charte graphique : les couleurs actuelles sont provisoires ; seules les variables de `apps/web/app/globals.css` changeront.
- Annuaire des tiers : les profils chantiers, immobilier, exploitation et cabinet choisissent et créent des tiers dans une liste commune aux deux sociétés (nom, NIF, téléphone, courriel, ville ; jamais les soldes). C'est le fonctionnement ordinaire du noyau (fiches de tiers partagées) ; à confirmer avec le DG au regard des « comptabilités séparées », sinon séparer les fiches par société.
- Référence de l'offre : la 37 a été attribuée par nous (la précédente portait -36 en pied de page et -01 en page de garde).
