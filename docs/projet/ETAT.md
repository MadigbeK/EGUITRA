# État du projet EGUITRA, au 14 octobre 2026 (fin d'après-midi)

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
  direction : tout ; finance : Finance ; cabinet : AxisPro ; exploitation : Finance et Rotations ;
  porteur : portail). Un profil propre à une société exige que le compte y soit ouvert (exploitation,
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
| `apps/web` | Les quatre surfaces web (33 écrans), la passerelle sécurisée, l'application Rotations hors ligne. |
| `scripts/dev/sync.sh` | Envoi du code sur le serveur de recette. |
| `scripts/recette/donnees_demo.py` | Données fictives « Démo » pour la recette (transport, achats, chantier, biens, AxisPro). |
| `scripts/reprise/` | Reprise contrôlée depuis des CSV (tiers, soldes d'ouverture, écritures de l'exercice avec lettrage, budget, rotations 2026), modèles de fichiers ; vérifiée sur une base jetable. |
| `docs/guides/` | Guides des utilisateurs par profil (direction, finance, exploitation, chantiers, immobilier, cabinet, porteur, administration) en Markdown et en Word (`word/`, générés par `build.js`). |
| `docs/projet/` | Dossier de conception (Markdown source et `Dossier_de_conception.docx` généré), cahier de recette (`Cahier_de_recette.xlsx`, 61 scénarios, généré par `cahier-de-recette.py`), plan de bascule vers la production (`Plan_de_bascule.docx`), accord de confidentialité (ajouté par une autre session), support de cadrage. |
| `docs/outils/md-docx.js` | Conversion Markdown vers Word aux couleurs du projet. |
| `docs/` | Offre contractuelle, support de cadrage, ce fichier. |

Tests : 100 tests automatisés sur les huit modules (`infra/test.sh`), tous au vert le 14 octobre à 15 h 50 ; lint Python (`ruff.toml`) et TypeScript propres, construction Next.js réussie. Parcours vérifiés dans le navigateur sur la recette : connexion avec double authentification et mot de passe provisoire, AxisPro de bout en bout (grille, évaluation avec preuves, data room, comités, honoraires), portail du porteur, Rotations hors réseau puis synchronisation, rapport mensuel, tableau des flux, relances ; après la troisième revue, connexion avec les cookies `__Host-`, politique de contenu sans violation, écrans finance et métiers.

Revues de sécurité : trois revues automatiques traitées. La troisième (14 octobre) a relevé et fait corriger : une lecture inter-sociétés dans AxisPro (pièces, revues, grilles du cabinet lisibles par un profil direction d'une autre société), des dépôts contrôlés sur le seul type annoncé, une approbation rejouable après remise en brouillon, le cloisonnement du téléphone dans Rotations, l'injection de formules dans les exports, un chemin « /./auth » de la passerelle, la déconnexion sans révocation, le blocage d'un compte par un tiers, les classeurs piégés, la piste d'audit d'un administrateur partiel, les cookies et la CSP. Compléments du même jour : écrans de fin de bail (les loyers dus sont soldés), de modification d'un bien (valorisation du patrimoine), d'annulation d'une situation de chantier, de création des comptes de banque et de caisse ; contrôles d'intégrité affichés avec recalcul réel des empreintes ; droit « Contact/Création » donné à la finance (la modification d'une fiche tiers échouait) ; guides des profils chantiers et immobilier (prévus par l'offre, manquants). Une relecture indépendante de ces correctifs a ensuite fait corriger : la formule de tableau « {=…} » encore écrite comme formule dans les exports XLSX (texte désormais écrit par `write_string`), l'adresse du client au changement de mot de passe, la déconnexion de Rotations hors réseau, et la piste d'audit des comptes multi-sociétés. En passant : le noyau ne voyait que l'adresse du conteneur web (20 échecs de connexion auraient bloqué tout le monde), le sélecteur de tiers échouait pour les profils chantiers, immobilier, exploitation et cabinet, et la tâche OCA des contrats restait active en production (corrigé par un appel rejoué à chaque mise à jour).

## 6. Les environnements aujourd'hui

- Accès : tunnel SSH `ssh -N -L 3000:127.0.0.1:3000 -L 3100:127.0.0.1:3100 eguitra-vps`, puis http://localhost:3000 (production) et http://localhost:3100 (recette), chemins /finance, /axispro, /portail, /mobile.

### Production
- Base `eguitra`, huit modules, deux sociétés, vide de données (en attente de la reprise). Version en service : 20261014-1548 (commit 4eef1e9) ; historique : `infra/release.sh --list`.
- Tâches de nuit actives : quittancement des loyers, dotations aux amortissements, relances des clients, purges (jetons, journaux d'accès, tentatives). La génération du module `contract` est désactivée.
- Identité des sociétés (adresse, NIF, RCCM, logo) à saisir dans Administration > Sociétés dès réception des informations du client : elles figurent en tête et au pied des factures.
- Super administrateur `emkouyate` (Madigbè Kouyaté, E-VOLUTION XP), créé le 15 octobre à la demande du gérant : tous les profils internes (administration, direction, finance, exploitation, chantiers, immobilier, cabinet), deux sociétés, mot de passe provisoire choisi par le gérant, à remplacer à la première connexion avec l'activation de la double authentification. Contrôlé le 16 octobre : compte actif, mot de passe définitif choisi, double authentification activée, aucun échec de connexion, noyau et applications de production en service.
- Administrateur `m.kouyate` (Madigbè Kouyaté), ouvert aux deux sociétés. Mot de passe provisoire dans `~/eguitra/infra/secrets/production-admin.txt` sur le serveur (lisible du seul utilisateur `deploy`) : à la première connexion, activer la double authentification puis choisir le mot de passe ; supprimer ensuite ce fichier.
- Restauration de la base de production vérifiée le 14 octobre (sauvegarde de 13 h 21).

### Recette
- Base `eguitra_recette` (grappe `db-recette`), huit modules installés, données de démonstration chargées (fictives, repérées « Démo » ; la grille AxisPro est une grille de démonstration de 10 critères).
- Compte d'administration de recette `recette.admin` : mot de passe et clé de double authentification dans `infra/.env` du serveur (`RECETTE_ADMIN_PASSWORD`, `RECETTE_ADMIN_TOTP`, à saisir dans une application d'authentification), jamais dans le dépôt. Il dispose aussi des profils cabinet et exploitation pour les démonstrations.
- Compte porteur de démonstration `porteur.demo` (« Démo - Porteur Briqueterie de Kindia »), rattaché au seul dossier AX/2026/0002, profil porteur, ouvert au portail uniquement (AxisPro Suite et Finance refusés, vérifié le 16 octobre) : mot de passe définitif `RECETTE_PORTEUR_PASSWORD` dans le même fichier ; double authentification remise à zéro le 16 octobre, à activer à la première connexion (code QR).
- Compte `emkouyate` présent aussi en recette (mot de passe provisoire, double authentification à activer).
- Comptes de test pour les utilisateurs réels (16 octobre) : test.dg (direction, deux sociétés), test.daf et test.comptable (finance, deux sociétés), test.exploitation et test.parc (exploitation, EGUITRA GROUP), test.chantiers, test.immobilier (EGUITRA GROUP), test.consultant (cabinet, MB AxisPro), test.admin (administration, deux sociétés), test.porteur (portail, dossier « Unité de séchage de mangues (démo) »). Créés par scripts/recette/comptes_test.py (recette seulement) ; mots de passe provisoires dans infra/secrets/comptes-test-recette.tsv du serveur (lisible du seul utilisateur deploy), double authentification à activer à la première connexion. Accès vérifiés : chaque compte n'ouvre que ses applications. Guide des testeurs (docs/projet/Guide_des_testeurs.docx) et fiche de retours (docs/projet/Fiche_de_retours.xlsx) remis au gérant.
- Double authentification désactivée sur la recette le 16 octobre, à la demande du gérant, pendant la période de test (paramètre `eguitra_api.mfa_required` = 0 de la base de recette ; noyau redémarré, les processus gardaient l'ancienne valeur en cache). La production la garde obligatoire. À rétablir en fin de tests : paramètre à 1, puis redémarrage de `odoo-recette`.
- Compte `comptable.demo` (profil finance, ouvert aux deux sociétés) pour montrer le multi-sociétés : `RECETTE_COMPTABLE_PASSWORD` et `RECETTE_COMPTABLE_TOTP`.
- Sauvegardes de la production actives en local ; copie hors site en attente du stockage objet.

## 7. Prochaines étapes

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
3. Noms de domaine : pointer finance.*, axispro.*, portail.* et le domaine technique vers le serveur, puis `docker compose --profile proxy up -d`.
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
