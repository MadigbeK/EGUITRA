# État du projet EGUITRA, au 14 octobre 2026 (fin de la session de nuit)

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

### Architecture réalisée
- **Noyau** : Odoo 19 Community + PostgreSQL 16 (Docker Compose). N'écoute que sur 127.0.0.1 ; jamais exposé aux utilisateurs.
- **API métier dans le noyau** (`eguitra_api`) : routes `/api/v1/...` exécutées sous l'identité de l'utilisateur (droits et règles d'accès du noyau s'appliquent). Jetons opaques stockés hachés (accès 15 min, renouvellement 12 h, 30 jours pour Rotations), double authentification TOTP obligatoire pour tous, limitation des essais par identifiant et par adresse, journal des accès 12 mois, piste d'audit (`auditlog`). Mot de passe remis par l'administrateur : provisoire, à remplacer avant tout autre accès (contrôlé par l'API elle-même).
- **Une seule application Next.js** (`apps/web`) sert les quatre surfaces : `/finance`, `/axispro`, `/portail`, `/mobile`, chacune avec son thème (`data-app`). Raison : un seul déploiement, une seule passerelle de sécurité, des composants partagés ; les domaines (finance.*, axispro.*, portail.*) aiguillent vers la bonne surface. Remplace le découpage en quatre applications envisagé au cadrage.
- **Passerelle** : le navigateur ne voit jamais les jetons (cookies httpOnly) ; `/api/odoo/...` relaie vers l'API avec renouvellement automatique ; protection CSRF par Origin et Sec-Fetch-Site. Société de travail mémorisée par application ; AxisPro Suite et le portail travaillent par défaut dans la société du cabinet.
- **Rotations** : application web installable (manifeste, service worker), saisie hors réseau dans IndexedDB, envoi idempotent (`client_uuid`) dès le retour du réseau. Le tarif n'est pas saisi au parc : le noyau l'applique (tarif client, sinon tarif de la route).
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

## 5. Ce qui existe dans le dépôt

| Chemin | Contenu |
|---|---|
| `infra/` | `setup-vps.sh` (sécurisation), `compose.yaml`, `up.sh` (déploiement), `init-db.sh` (base et premier administrateur, essayé sur une base jetable), `test.sh` (tests sur base jetable), `monitor.sh` (supervision), `oca/` (modules OCA épinglés), `odoo/` (image et configuration), `backup/` (sauvegardes, restauration), `caddy/` (proxy TLS), `README.md` (exploitation). |
| `addons/eguitra_base` | Sociétés (groupe, cabinet), huit profils, sept axes analytiques, règles d'audit. |
| `addons/eguitra_api` | Cadre de l'API, authentification, double authentification, sessions, administration des utilisateurs, journaux. |
| `addons/eguitra_finance` | Tableau de bord dirigeant, rapport mensuel de gestion, ventes, relances clients, achats, trésorerie (import de relevés, rapprochement), tiers, écritures et virements internes, bilan, compte de résultat et tableau des flux SYSCOHADA, balance et grand livre, clôtures avec contrôles, fiscalité (TVA, export pour l'auditeur, IFRS), dette et DSCR, immobilisations (dotations automatiques, cessions), budget, alertes, 12 rapports exportables. |
| `addons/eguitra_approval` | Circuits d'approbation à plusieurs niveaux (pièces, paiements, OD), alertes de retard. |
| `addons/eguitra_transport` | Flotte, chauffeurs, routes et tarifs, rotations, facturation, rentabilité, synchronisation mobile. |
| `addons/eguitra_chantier` | Chantiers, situations d'avancement, facturation, retenues de garantie (4117) et leur libération. |
| `addons/eguitra_immobilier` | Biens, baux, loyers récurrents (module OCA `contract`), impayés, quittances. |
| `addons/eguitra_axispro` | Politique d'évaluation versionnée (grille importée), dossiers, évaluation par gate, score, éliminatoires, recommandation, écarts, data room, comités verrouillés et comparés, rapports, temps et honoraires, portail des porteurs. |
| `apps/web` | Les quatre surfaces web (33 écrans), la passerelle sécurisée, l'application Rotations hors ligne. |
| `scripts/dev/sync.sh` | Envoi du code sur le serveur de recette. |
| `scripts/recette/donnees_demo.py` | Données fictives « Démo » pour la recette (transport, achats, chantier, biens, AxisPro). |
| `scripts/reprise/` | Reprise contrôlée depuis des CSV (tiers, soldes d'ouverture, écritures de l'exercice avec lettrage, budget, rotations 2026), modèles de fichiers ; vérifiée sur une base jetable. |
| `docs/guides/` | Guides des utilisateurs par profil (direction, finance, exploitation et Rotations, cabinet, porteurs, administration). |
| `docs/projet/dossier-de-conception.md` | Projet de dossier de conception (liste définitive des composants, écarts, règles et valeurs de départ, cahier de recette des vingt attentes), à relire avant envoi. |
| `docs/` | Offre contractuelle, support de cadrage, ce fichier. |

Tests : 78 tests automatisés sur les huit modules (`infra/test.sh`), tous au vert le 14 octobre ; lint Python (`ruff.toml`) et TypeScript propres. Parcours vérifiés dans le navigateur sur la recette : connexion avec double authentification et mot de passe provisoire, AxisPro de bout en bout (grille, évaluation avec preuves, data room, comités, honoraires), portail du porteur, Rotations hors réseau puis synchronisation, rapport mensuel, tableau des flux, relances. Deux revues de sécurité automatiques ont été traitées (téléchargements servis en pièce jointe, redirection après connexion, adresse du client, relances bornées à la société).

## 6. La recette aujourd'hui

- Base `eguitra_recette` sur le VPS, huit modules installés, données de démonstration chargées (fictives, repérées « Démo » ; la grille AxisPro est une grille de démonstration de 10 critères).
- Accès : tunnel SSH (`ssh -N -L 3000:127.0.0.1:3000 eguitra-vps`), puis http://localhost:3000 (finance), /axispro, /portail, /mobile.
- Compte d'administration de recette `recette.admin` : mot de passe et clé de double authentification dans `infra/.env` du serveur (`RECETTE_ADMIN_PASSWORD`, `RECETTE_ADMIN_TOTP`, à saisir dans une application d'authentification), jamais dans le dépôt. Il dispose aussi des profils cabinet et exploitation pour les démonstrations.
- Compte porteur de démonstration `porteur.demo`, rattaché au dossier AX/2026/0002 : `RECETTE_PORTEUR_PASSWORD` (provisoire, à remplacer à la première connexion) et `RECETTE_PORTEUR_TOTP` dans le même fichier.
- Sauvegardes actives en local ; copie hors site en attente du stockage objet.

## 7. Prochaines étapes

1. Prérequis client à relancer (bloquants pour la reprise et la mise en production) : charte graphique et logos, classeur 2026 (dernière version), relevés bancaires 2026, plan de comptes et contact de l'expert-comptable, liste des utilisateurs par profil, grille AxisPro officielle (111 critères) et liste des pièces de la data room, accès aux noms de domaine.
2. Stockage objet hors site (second hébergeur, environ 100 Go) : créer le bucket, remplir `infra/backup.env`.
3. Noms de domaine : pointer finance.*, axispro.*, portail.* et le domaine technique vers le serveur, puis `docker compose --profile proxy up -d`.
4. Reprise des données dès réception du classeur : remplir les modèles de `scripts/reprise/modeles/` (tiers, soldes d'ouverture, écritures, budget, rotations 2026), contrôler puis appliquer sur la recette ; immobilisations et emprunts par les écrans. Relevés bancaires 2026 par l'écran Trésorerie.
5. Validation du plan de comptes et des correspondances des états SYSCOHADA avec l'expert-comptable ; paramétrage des seuils d'approbation et d'alerte avec le DG.
6. Base de production `eguitra` avec `infra/init-db.sh`, après la recette ; ne jamais y charger les données de démonstration. Un noyau sert une seule base (`dbfilter`) : décider entre un second service Odoo pour la recette et la bascule de `ODOO_DB`.
7. Dossier de conception : relire le projet `docs/projet/dossier-de-conception.md`, le mettre en forme (générateur de `docs/offre/`) et le faire signer.
8. Formation des référents (guides de `docs/guides/`) et recette fonctionnelle ligne à ligne des vingt attentes.
9. Destinations des alertes de supervision (`ALERT_WEBHOOK_URL` ou `ALERT_NTFY_URL`) et serveur d'envoi de courriel (relances par courriel, comptes rendus) : à obtenir du client.

## 8. Points ouverts et risques

- Double authentification pour les agents du parc (Rotations) : obligatoire pour tous aujourd'hui ; le renouvellement de session de 30 jours limite la gêne. À confirmer avec le DG (téléphones des agents, application d'authentification).
- Les volumes 2026 cités dans l'offre (7 activités, 9 centres de coût, 383 rotations, etc.) proviennent de l'offre du 15 septembre, établie sur le classeur arrêté au 15 août ; à revérifier sur le classeur définitif avant la reprise.
- Les référents doivent être disponibles une demi-journée par jour ; toute absence se note au comité.
- Expert-comptable attendu en semaine 2 pour valider le plan de comptes.
- Charte graphique : les couleurs actuelles sont provisoires ; seules les variables de `apps/web/app/globals.css` changeront.
- Référence de l'offre : la 37 a été attribuée par nous (la précédente portait -36 en pied de page et -01 en page de garde).
