# Plan de mise en production : EGUITRA Finance et AxisPro Suite

Document de travail du 14 octobre 2026, à arrêter en comité de pilotage. Il décrit comment la
plateforme remplace le classeur 2026 : conditions de feu vert, calendrier, déroulé technique du
jour J, contrôles, retour arrière et communication. L'environnement de production est déjà en
place (base créée, deux sociétés, administrateur) ; il reste vide jusqu'au jour J.

## 1. Conditions de feu vert (décision au comité de pilotage, la veille)

| Condition | Responsable | État |
|---|---|---|
| Cahier de recette : tous les scénarios OK ou en réserve acceptée | Référents et prestataire | |
| Plan de comptes et correspondances des états validés par l'expert-comptable | Responsable financier | |
| Reprise complète rejouée en recette, balances d'ouverture et de clôture égales à celles du classeur, pour chaque société | Responsable financier et prestataire | |
| Liste des utilisateurs validée : profils et sociétés de chacun | Direction générale | |
| Noms de domaine pointés vers le serveur, certificats TLS actifs | Prestataire | |
| Stockage hors site configuré, test de restauration réussi depuis la copie hors site | Prestataire | |
| Destinations des alertes de supervision configurées | Prestataire | |
| Référents formés sur leurs écrans, guides remis | Prestataire | |
| Seuils d'approbation et d'alerte arrêtés | Direction générale | |

## 2. Calendrier

| Moment | Action | Qui |
|---|---|---|
| J-5 | Reprise complète en recette avec le classeur à jour ; contrôles des balances par société | Prestataire, responsable financier |
| J-2 | Validation des balances, des tiers et des rotations ; liste des écarts traités | Responsable financier |
| J-1 | Comité de pilotage : feu vert ou report ; annonce aux utilisateurs | Direction générale |
| J-1, 18 h | Gel du classeur : plus aucune saisie ; dernière version transmise au prestataire | Responsable financier |
| J, matin | Reprise en production, contrôles, ouverture des comptes (section 3) | Prestataire, responsable financier |
| J, après-midi | Premières saisies réelles accompagnées, sur chaque profil | Référents, prestataire |
| J à J+20 | Accompagnement renforcé (offre, chapitre 6.4), point quotidien de 15 minutes | Prestataire |

## 3. Déroulé technique du jour J

1. Vérifier que la version validée en recette est en service : `infra/release.sh --list` ; sinon
   `infra/release.sh`.
2. Sauvegarde de base avant toute reprise : `docker compose exec backup base-backup.sh` ; noter l'heure.
3. Reprise, société par société, d'abord en contrôle puis en enregistrement :
   `REPRISE_SOCIETE=groupe scripts/reprise/reprise.sh production ~/reprise/groupe` puis la même
   commande avec `--appliquer` ; idem avec `REPRISE_SOCIETE=cabinet` et le dossier du cabinet.
4. Relevés bancaires 2026 par l'écran Trésorerie ; immobilisations et emprunts par leurs écrans.
5. Contrôles : balance par société comparée à celle du classeur au jour du gel ; bilan équilibré ;
   tableau des flux rapproché de la trésorerie ; nombre et chiffre d'affaires des rotations par mois.
6. Comptes utilisateurs : création par l'administrateur (profils et sociétés), remise des mots de
   passe provisoires en main propre ; chacun active sa double authentification à la première connexion.
7. Supervision renforcée la première semaine : journal `~/eguitra/logs/monitor.log`, alertes.

## 4. Retour arrière

- **Reprise incorrecte (avant ouverture des comptes)** : restaurer la base de production à l'heure
  notée à l'étape 2 (`infra/backup/README.md`), corriger les fichiers, rejouer la reprise. Aucun
  utilisateur n'a encore saisi : rien n'est perdu.
- **Anomalie bloquante après ouverture** : correction en recette puis mise en production d'une
  nouvelle version (`infra/release.sh`) ; si la correction tarde, retour à la version précédente
  (`infra/release.sh --rollback`). Les données saisies restent dans la base.
- **Abandon de la bascule** (décision du comité) : le classeur gelé reprend la main ; les saisies
  faites dans la plateforme depuis l'ouverture sont listées depuis le journal des pièces et reportées
  dans le classeur. Nouvelle date fixée en comité.

## 5. Communication aux utilisateurs

Message type, envoyé par la direction la veille :

« À partir de demain, la gestion financière du groupe et du cabinet se fait dans EGUITRA Finance et
AxisPro Suite. Votre identifiant et votre mot de passe provisoire vous sont remis en main propre ; à
la première connexion, installez une application d'authentification sur votre téléphone (Google
Authenticator ou Microsoft Authenticator) et suivez les indications à l'écran. Le classeur n'est
plus mis à jour après ce soir 18 h. L'équipe d'E-VOLUTION XP vous accompagne sur place et à distance
pendant quatre semaines. »
