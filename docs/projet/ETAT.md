# État du projet EGUITRA, au 14 octobre 2026

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
| 14 oct. 2026 | VPS livré, installé et sécurisé. Poursuite du travail en session locale. |

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

### Odoo 19.0
Vérifié sur GitHub le 13 octobre 2026 : branches 16.0 à 20.0 publiées. Disponibilité des treize modules OCA retenus :

| Module | 17.0 | 18.0 | 19.0 | 20.0 |
|---|---|---|---|---|
| account_reconcile_oca, account_statement_import_file | oui | oui | oui | non |
| account_asset_management | oui | oui | oui | non |
| mis_builder, mis_builder_budget | oui | oui | oui | oui |
| account_financial_report | oui | oui | oui | non |
| base_tier_validation, purchase_tier_validation, account_move_tier_validation | oui | oui | non | non |
| auditlog | oui | oui | oui | non |
| contract | oui | oui | oui | non |
| currency_rate_update | oui | oui | oui | non |
| dms | oui | oui | oui | non |

Choix : 19.0, maintenue jusqu'à la sortie de la 22 (vers l'automne 2028), contre l'automne 2027 pour la 18.0. Coût : les trois modules d'approbation manquent. Plan : tenter le portage de `base_tier_validation` (3 557 lignes Python sur 18.0, dépend seulement de `mail`) en deux jours maximum ; sinon écrire un moteur d'approbation spécifique (niveaux par montant et par nature, approbateurs par profil, sur commandes, factures fournisseurs et paiements, journal des décisions). Les deux modules de glu (64 et 316 lignes) se réécrivent. La corbeille d'approbation visible par les utilisateurs est dans notre application, pas dans Odoo.
Porte de sortie : si en fin de semaine 1 les dix autres modules OCA ne s'installent pas proprement sur 19.0 ou si le moteur d'approbation n'est pas en place, basculer sur 18.0 avant toute reprise de données. Décision à inscrire au compte rendu du comité de fin de semaine 1 et dans le dossier de conception.
Localisations présentes dans Odoo 19 Community : `l10n_syscohada`, `l10n_gn`.

### Serveur
- Commandé : VPS-3 2027 (6 vCore, 12 Go, 100 Go NVMe), OVHcloud Gravelines (France), engagement 12 mois, Ubuntu 26.04 LTS, option de sauvegarde automatique de l'hébergeur activée (gratuite). Le VPS-4 était indisponible dans tous les centres de données.
- Écart avec l'offre : 100 Go de disque au lieu de 160. À traiter : ajouter un disque de 100 Go si l'hébergeur le propose ; sinon inscrire la configuration réelle dans le dossier de conception avec engagement d'ajouter du disque sans surcoût au besoin. Processeur et mémoire sont supérieurs à l'offre (4 vCPU, 8 Go).
- Sécurisé le 14 octobre 2026 par `infra/setup-vps.sh`, vérifié après redémarrage : utilisateur `deploy`, SSH par clé uniquement, root interdit, pare-feu (22, 80, 443), fail2ban, mises à jour de sécurité automatiques sans redémarrage automatique, Docker et Compose du dépôt officiel, swap 4 Go, fuseau Africa/Conakry. Adresse et accès : chez le gérant, hors dépôt.
- Attention : Docker contourne le pare-feu pour les ports publiés. Dans le compose, ne publier que 80 et 443 (proxy) ; PostgreSQL et Odoo restent sur le réseau interne.
- Reste à faire côté hébergement : espace de stockage objet chez un second hébergeur pour les sauvegardes hors site (environ 100 Go) ; pointer les deux noms de domaine (type finance.eguitragroup.com, axispro.mbaxisproconsulting.com) vers l'adresse IP.
- Ubuntu 26.04 LTS retenu plutôt que 24.04 : maintenu jusqu'en avril 2031 ; le dépôt officiel Docker publie déjà ses paquets pour 26.04 (vérifié).

### Architecture cible
- Conteneurs : PostgreSQL 16, Odoo 19 (production et recette, deux bases dans le même cluster), proxy TLS avec certificats automatiques, applications web EGUITRA Finance et AxisPro Suite, portail, outil de sauvegarde continue.
- API métier : modules Odoo spécifiques exposant une API sécurisée (jeton + double authentification) ; l'interface web d'Odoo n'est jamais exposée aux utilisateurs.
- Application mobile : application web progressive, hors ligne, file de synchronisation des rotations.
- Charge mémoire estimée en régime normal : 7 à 8 Go.

## 5. Ce qui existe dans le dépôt

- `docs/offre/` : offre contractuelle (Word et Markdown), générateur, courriers, PDF envoyé le 15 septembre.
- `docs/projet/Reunion_de_cadrage.docx` : support de la réunion de cadrage de 20 minutes (et son script).
- Aucun code applicatif pour l'instant.

## 6. Prochaines étapes, semaine 1

- [ ] Compléter la section 2 : acompte, T0, date contractuelle, référents, jour du comité de pilotage.
- [x] Sécuriser le VPS : utilisateur non root, clé SSH, pare-feu (22, 80, 443), mises à jour automatiques, Docker (14 octobre).
- [ ] Structure du dépôt : `infra/` (compose, proxy, sauvegardes), `addons/` (modules Odoo spécifiques et OCA épinglés), `apps/finance-web`, `apps/axispro-web`, `apps/portail`, `apps/mobile`, `scripts/reprise/`.
- [ ] Monter Odoo 19 + PostgreSQL + les dix modules OCA en recette ; lancer leurs tests.
- [ ] Moteur d'approbation : portage de base_tier_validation, deux jours maximum, sinon moteur spécifique.
- [ ] Arrêter la liste définitive des modules (engagement de l'offre) et rédiger le dossier de conception à faire signer.
- [ ] Collecter les prérequis : charte graphique et logos, classeur 2026 (dernière version), relevés bancaires 2026, modèles de déclarations fiscales, plan de comptes et contact de l'expert-comptable, liste des utilisateurs par profil, grille AxisPro et pièces de la data room, accès aux noms de domaine.
- [ ] Déposer `logo.png` (logo officiel) dans `docs/offre/` ; le rendu provisoire est utilisé tant qu'il manque.

## 7. Points ouverts et risques

- Les volumes 2026 cités dans l'offre (7 activités, 9 centres de coût, 383 rotations, etc.) proviennent de l'offre du 15 septembre, établie sur le classeur arrêté au 15 août ; à revérifier sur le classeur définitif avant la reprise.
- Les référents doivent être disponibles une demi-journée par jour ; toute absence se note au comité.
- Expert-comptable attendu en semaine 2 pour valider le plan de comptes.
- Référence de l'offre : la 37 a été attribuée par nous (la précédente portait -36 en pied de page et -01 en page de garde).
