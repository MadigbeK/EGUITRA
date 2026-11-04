# Audit complet du système EGUITRA, 4 novembre 2026

Audit demandé par le gérant le 3 novembre 2026 au soir (« fais un audit complet de tout le système »).
Production en service : version 20261103-2238, seize modules à jour, application web Next.js 16.

## 1. Verdict

Le système est sain : aucune faille critique exploitable aujourd'hui, sauvegardes locales à jour et
restaurations réussies, aucune erreur au noyau sur 24 heures, lint, typage et dépendances propres.

Les risques qui comptent sont ailleurs :

1. **Contrat et organisation** : T0 non fixé, aucun compte rendu de comité (les retards du client ne
   sont donc pas opposables), ajouts hors offre en production sans avenant écrit, double
   authentification suspendue, copie hors site absente.
2. **Exploitation** : une mise en production interrompue laisserait la production arrêtée ; la
   recette et la production partagent le même réseau Docker ; les alertes ne partent nulle part ; le
   noyau Linux attend un redémarrage depuis le 3 novembre (correctifs de sécurité).
3. **Code** : une redirection ouverte après connexion et un engagement de dépense consommable deux
   fois, corrigés dans cette session ; une série de défauts moyens et bas listés au chapitre 4.

## 2. Méthode

- Contrôles en lecture sur le serveur : système, pare-feu, SSH, conteneurs, versions, sauvegardes,
  archivage des journaux de la base, certificats, en-têtes HTTP, base de production et de recette,
  journaux du noyau, tâches planifiées, comptes.
- Cinq relectures indépendantes du code, chacune vérifiée dans le code : sécurité du noyau Python
  (16 modules, environ 85 000 lignes), application web (environ 110 000 lignes), scripts
  d'exploitation (`infra/`), logique financière (finance, approbations, achats, transport, chantiers,
  immobilier, paie), conformité à l'offre OTF-EGUITRA-2026-37.
- Outils : `ruff check addons scripts` (aucune remarque), `npx tsc --noEmit` (aucune erreur),
  `npm audit --omit=dev` (0 vulnérabilité sur 65 dépendances), série complète des tests du
  3 novembre (1 119 tests, un échec corrigé, relance ciblée 202 sur 202).
- Non couvert faute de temps : relecture de sécurité ligne à ligne de `eguitra_transport`,
  `eguitra_analytics`, `eguitra_chantier` et de la majorité de `eguitra_finance` (la logique financière
  de ces modules a été relue) ; application native NIMOVA Terrain (`apps/terrain`, APK non construit).

## 3. État du serveur (4 novembre, 0 h 35)

| Point | Mesure | Appréciation |
|---|---|---|
| Ressources | 6 vCore, 12 Go (8,3 Go disponibles), charge 0,3 | Large |
| Disque | 96 Go ; 57 % occupé, ramené à 28 % (cache de construction Docker purgé, 30 Go) | Corrigé ; purge à chaque mise en production (A-11) |
| Noyau Linux | 7.0.0-28 en service, 7.0.0-42 installé | **Redémarrage à faire** (correctifs de sécurité) |
| Paquets | 28 en attente ; mises à jour de sécurité automatiques actives | Normal |
| Pare-feu, SSH | 22, 80, 443 seuls ; clé seule, root interdit ; fail2ban (751 bannissements) | Bon |
| Conteneurs | 9 en service, tous sains | Bon |
| Sauvegardes | base 22 h 38, journaux archivés en continu (dernier à 0 h 40), pièces jointes 0 h 30, recette 1 h 30 | Bon en local |
| Restaurations | test mensuel réussi le 01/11, restauration à un instant donné le 25/10 | Bon |
| Copie hors site | non configurée (`RCLONE_REMOTE` vide) | **Écart contractuel** |
| Alertes | aucune destination (`ALERT_NTFY_URL`, `ALERT_WEBHOOK_URL`, `HEARTBEAT_URL` vides) | **La supervision ne prévient personne** |
| Courriel | aucun serveur d'envoi (`SMTP_HOST`) | Relances et confirmations ne partent pas |
| Certificats | valides jusqu'au 14 et 19 janvier 2027, renouvellement automatique | Bon |
| En-têtes | HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy | Bon |
| Base de production | 99 Mo, aucune écriture comptable, aucun dossier, aucun compte ni donnée de test | Conforme (en attente de la reprise) |
| Comptes | 9 comptes internes actifs, 7 encore au mot de passe provisoire, 6 jamais connectés | Prise en main du client non commencée |
| Double authentification | désactivée (production et recette), 1 compte l'a activée | Écart décidé par le gérant |
| Journaux du noyau | aucune erreur sur 24 heures (production et recette) | Bon |
| Tâches planifiées | 48 actives, aucune en échec | Bon |
| Piste d'audit | 203 règles actives, 446 entrées en production | Bon |
| Lecture IA des business plans | bibliothèque installée, clé absente : fonction masquée | Inactive jusqu'à la clé |
| Domaine | adresses provisoires sslip.io ; `nimovagroup.com` non résolu | En attente |
| Dépôt de code | 130 commits locaux non poussés | **Risque de perte** ; copie de secours posée sur le serveur (`~/sauvegardes-depot/`) |

## 4. Constats

Gravité : C critique, H haute, M moyenne, B basse. État : **corrigé** (dans cette session, en
production avec la version indiquée au chapitre 6), **à faire** (prestataire), **décision** (gérant ou
client).

### 4.1 Exploitation (`infra/`)

| N° | Gr. | Constat | Fichier | État |
|---|---|---|---|---|
| A-1 | C | Une mise en production interrompue (coupure SSH pendant la mise à jour des modules, échec de construction) laisse la production arrêtée : `docker compose stop` fait que les conteneurs ne redémarrent plus, même après un redémarrage du serveur ; rien n'est consigné. | `infra/release.sh:124-143` | à faire |
| A-2 | H | Si la base ne répond pas au moment de la mise en production, le script croit qu'il n'y a « pas encore de base » : il bascule le code sans sauvegarde ni mise à jour des modules et annonce la version en service ; au redémarrage suivant, le nouveau code tourne sur un schéma non migré. | `infra/release.sh:30-33, 120, 158-161` | à faire |
| A-3 | H | Retour arrière incomplet : l'ancien code revient sur une base à moitié migrée ; un échec du contrôle de santé sort sans retour arrière ; les versions en échec comptent dans les cinq gardées. | `infra/release.sh` | à faire |
| A-4 | H | Procédure de restauration réelle : copie de l'instance de contrôle encore en marche, fichier d'historique de la nouvelle ligne temporelle jamais archivé, aucune sauvegarde de base relancée après la restauration. | `infra/backup/README.md:83-93` | à faire |
| A-5 | H | Copie hors site (quand elle existera) : l'envoi nocturne n'est pas surveillé, rien ne vérifie la copie distante, la clé peut supprimer (un intrus effacerait aussi la copie). | `infra/backup/offsite.sh`, `check.sh` | à faire avec A-15 |
| A-6 | H | Recette et production partagent le même réseau Docker : une exécution de code en recette atteint la base et le noyau de production. Contredit la séparation des environnements. | `infra/compose.yaml` | à faire (intervention annoncée) |
| A-7 | M | La chaîne nocturne de sauvegarde bloque l'archivage des journaux (objectif de 15 minutes dépassé chaque nuit) ; la sauvegarde nocturne saute si une tâche chevauche 1 h 30. | `infra/backup/scheduler.sh` | à faire |
| A-8 | M | Pièces jointes : source absente non signalée, suppressions recopiées en 15 minutes, test de restauration sans contrôle des pièces jointes. | `infra/backup/files-backup.sh` | à faire |
| A-9 | M | Alertes : JSON du webhook cassé quand deux problèmes coexistent, alerte répétée toutes les 5 minutes, pas d'alerte si le test trimestriel n'a jamais réussi. | `infra/monitor.sh` | à faire |
| A-10 | M | `sync.sh` remplace en production `compose.yaml`, le Caddyfile et les scripts de sauvegarde hors de toute mise en production ; les fichiers supprimés en local restent sur le serveur. | `scripts/dev/sync.sh` | à faire |
| A-11 | M | Croissance du disque non bornée (cache de construction, restes de restauration, exports). | `infra/release.sh` | **corrigé** pour le cache et les images sans étiquette (purge à chaque mise en production) ; restes de restauration et exports à faire |
| A-12 | M | La copie des secrets faite par `domaines.sh` partirait chez le client dans l'export de réversibilité. | `infra/export-reversibilite.sh:45-48` | **corrigé** (aucun `.env*` sauf l'exemple ; copie rangée dans `secrets/`) |
| A-13 | M | `init-db.sh production` lancé par erreur peut effacer la base si `eguitra_base` n'est pas « installé » ; le rôle applicatif garde le droit de créer une base. | `infra/init-db.sh:114-124`, `up.sh:54-56` | à faire |
| A-14 | M | Perte totale du serveur : `.env` hors du coffre, pièces jointes non téléchargées par la restauration hors site ; reprise sous 4 heures ni outillée ni testée. | `infra/backup/README.md:94-96` | à faire avec A-15 |
| A-15 | — | Stockage hors site non souscrit. | `infra/backup.env` | **décision du gérant** (souscription, voir chapitre 6) |
| A-16 à A-19 | B | `.env` lu par le shell (une valeur non citée devient une commande) ; secrets visibles dans `ps` et jetons dans le journal du proxy ; deux sauvegardes de base simultanées ; arrêt de PostgreSQL au bout de 10 s ; supervision sans verrou ni délai. | divers | à faire |

### 4.2 Logique financière

| N° | Gr. | Constat | Fichier | État |
|---|---|---|---|---|
| F-1 | H | Un engagement de 100 M GNF peut être consommé deux fois : un bon de commande de 100 M et une facture directe de 100 M passent tous deux sans circuit (chaque contrôle ne compte que sa propre famille de pièces). | `eguitra_approval/models/commitment.py:157`, `eguitra_commerce/models/purchase_order.py:276` | **corrigé** |
| F-2 | M | Les quatre yeux n'écartent que le créateur de la pièce : un comptable qui porte une pièce de 10 à 45 M peut ensuite l'approuver lui-même si un autre la soumet. | `eguitra_approval/models/approval.py:183` | à faire |
| F-3 | M | Tolérance de quantité appliquée deux fois (réception puis facture) : 121 unités facturées sur 100 commandées avec 10 % de tolérance. Inactif tant que la tolérance vaut 0. | `eguitra_commerce/models/account_move.py:67` | **corrigé** |
| F-4 | B | Les retenues de garantie libérées ne sont jamais relancées. | `eguitra_finance/models/reminder.py:89-95` | à faire |
| F-5 | B | Factures à établir du transport passées en entier au 7061 (taxes refacturées et manquants compris). | `eguitra_transport/models/period_close.py:37-46` | à faire |
| F-6 | B | Un tarif officiel nul provoque une division par zéro (erreur 500 sur l'écran du barème). | `eguitra_transport/models/official_rate.py:116` | **corrigé** |
| F-7 | B | Soldes de trésorerie par journal non filtrés par société (compte partagé entre sociétés). | `eguitra_finance/models/finance_metrics.py:204-209` | **corrigé** |
| F-8 | B | Le résultat peut être affecté deux fois (deux OD d'affectation en brouillon puis validées). | `eguitra_finance/models/year_close.py:259-342` | à faire |

Relu sans constat : seuils et concurrence des approbations, empreintes des pièces, clôtures
mensuelles et annuelle, correspondance SYSCOHADA du bilan et du compte de résultat, tableau des flux,
emprunts et DSCR, chantiers et retenues, quittancement, facturation des rotations, budgets de voyage,
paie, relances, budget, virements internes, rapprochement à trois voies, acomptes, immobilisations, TVA.

### 4.3 Sécurité du noyau (API)

Aucune faille critique ni haute. Pas d'injection SQL, pas de SSRF, pas d'`eval`, signature WhatsApp
vérifiée, en-têtes de société et d'application seulement restrictifs.

| N° | Gr. | Constat | Fichier | État |
|---|---|---|---|---|
| S-1 | M | Jetons des liens publics (agenda iCal, invitations, satisfaction, rendez-vous) écrits en clair dans le journal du proxy. | `infra/caddy/Caddyfile:19-24` | à faire |
| S-2 | M | Lecture IA du business plan : appel synchrone jusqu'à 180 s, sans quota ; quatre appels simultanés occupent les quatre processus du noyau et chaque appel est facturé. | `eguitra_axispro/controllers/axispro.py:445-470`, `lecture_ia.py` | **corrigé** |
| S-3 | B | Jeton de satisfaction conservé 12 mois dans le journal des accès de l'API. | `eguitra_api/controllers/framework.py:193` | à faire |
| S-4 | B | Prise de rendez-vous publique : courriel « officiel » vers une adresse quelconque avec un nom choisi par l'appelant (plafonné). | `eguitra_agenda/models/booking.py:273-307` | à faire |
| S-5 | B | WhatsApp entrant sans plafond par expéditeur (le courriel en a un). | `eguitra_service_client/models/whatsapp_gateway.py` | à faire |
| S-6 | B | L'accès au portail d'un dossier accepte n'importe quel compte externe et le réactive. | `eguitra_axispro/controllers/axispro.py:514-543` | **corrigé** |
| S-7 | B | Rapprochement du promoteur lu par l'IA avec des jokers `%` et `_` non échappés. | `eguitra_axispro/controllers/axispro.py:467` | **corrigé** |
| S-8 | B | Business plan transmis en entier à Anthropic, sans trace du consentement du promoteur. | `lecture_ia.py` | **décision** (accord du cabinet et des porteurs avant de poser la clé) |
| S-9 | B | Confiance dans l'en-tête `Authentication-Results` des courriels entrants (latent : réglage vide). | `eguitra_service_client/courriel.py:142` | à faire avant d'activer le réglage |
| S-10 | B | Photo du salarié : décodage jusqu'à 40 millions de pixels. | `eguitra_rh/photo.py:25` | **corrigé** |

### 4.4 Application web

`tsc` sans erreur, `npm audit` à 0. Passerelle, CSRF, cookies, jetons, XSS et surfaces publiques relus
sans constat.

| N° | Gr. | Constat | Fichier | État |
|---|---|---|---|---|
| W-1 | H | Redirection ouverte après connexion : `/login?next=/.//site-pirate` envoie l'utilisateur fraîchement connecté vers un autre site (hameçonnage « session expirée »). | `apps/web/app/login/page.tsx:22-30` | **corrigé** |
| W-2 | M | Rotations sur téléphone partagé : après une session expirée sans déconnexion, l'écran d'un autre compte peut être servi et les saisies en attente partir sous la session du suivant. | `apps/web/public/mobile-sw.js:79-91`, `components/mobile/RotationsApp.tsx` | à faire |
| W-3 | M | Les déconnexions (Finance, accueil, portail, espace client, veille) partent vers la page de connexion même si la déconnexion a échoué : sur un poste partagé, le suivant entre sans mot de passe. | `components/shell/AppShell.tsx:116` et 5 autres | **corrigé** |
| W-4 | M | Lettre de voiture : « 12,5 » devient 125 dans le poids des colis. | `components/transport/documents/Operation.tsx:475-476` | **corrigé** |
| W-5 | M | Capacité d'un engin : « 33 000 » devient 0 sans message. | `components/transport/documents/Engins.tsx:81-82` | **corrigé** |
| W-6 | M | Nouveau dossier AxisPro : l'échec du dépôt du business plan dans la data room est passé sous silence. | `app/axispro/page.tsx:538` | **corrigé** |
| W-7 | M | Téléchargements de pièces sans message d'échec (service client, agenda, HSSEQ, RH, transport). | 6 fichiers | à faire |
| W-8 | M | Service client : la réponse type reste sélectionnée même si son chargement échoue. | `app/service-client/dossiers/[id]/page.tsx:118-130` | **corrigé** |
| W-9 | M | Réglages Achats et ventes : un champ vidé vaut 0 (règle des trois devis désactivée), numérotation non entière acceptée. | `app/finance/admin/commerce/page.tsx:49-59` | **corrigé** |
| W-10 | M | Coupure réseau affichée « Action impossible. » au lieu de « vérifiez la connexion ». | `lib/envoi.ts:10` | **corrigé** |
| W-11 à W-15 | B | Liens internes acceptant `//hôte` (aucun vecteur actuel) ; précache du service worker avec `..` ; `mailto:` non encodé et numéros WhatsApp mal contrôlés dans les relances ; rendez-vous public sans champ piège ; webhook WhatsApp borné sur `content-length` seulement. | divers | liens internes, service worker et `mailto` **corrigés** ; numéros WhatsApp, champ piège et webhook à faire |

## 5. Conformité à l'offre OTF-EGUITRA-2026-37

Fonctions : les vingt attentes sont couvertes par le code (quatorze livrées, six partielles faute de
données, de courriel ou de validation du client). AxisPro Suite, portail et Rotations sont livrés.

Écarts, du plus risqué au moins risqué pour le prestataire :

| Écart | Conséquence | Qui agit |
|---|---|---|
| T0 non fixé, aucun compte rendu de comité, registre des prérequis non contresigné | Les retards du client ne sont pas opposables : pénalités de 0,1 % par jour (plafond 2 500 000 GNF) | Gérant |
| Reprise 2026 et balances validées non faites | Condition de la mise en production (chapitre 6.3) | Client (classeur, relevés, expert-comptable), puis prestataire |
| Copie hors site absente | Chapitre 5.2 non tenu en cas de perte du serveur | Gérant (souscription), puis prestataire |
| Double authentification désactivée | Écart aux chapitres 5.3 et à l'attente 15 ; scénario de recette n° 15 en échec | Gérant, avant toute donnée réelle |
| Disque de 96 Go au lieu de 160 | Écart aux chapitres 5.1 et 7.3 | Prestataire (disque) ou accord écrit du client |
| Domaine définitif, serveur de courriel, destinations d'alerte | Relances par courriel inopérantes ; support en 2 heures fragile | Gérant et client, puis prestataire |
| Dossier de conception non signé et périmé ; formation non tenue ; PV non signés | Recette contestable | Prestataire, puis client |
| Ajouts hors offre en production sans avenant (RH et paie, HSSEQ, NIMOVA Terrain, Achats et ventes, Agenda, Discussions, Service client, Analyse, portail enrichi, mode expert AxisPro, lecture IA, Transport étendu) | Le client peut les tenir pour dus, garantis et couverts par la maintenance « sans limite » | Gérant (avenant écrit, et constat au comité) |
| Lecture IA (Anthropic) et WhatsApp (Meta) non prévus par l'article 5 de l'accord de confidentialité ; base d'essai de reprise avec données réelles encore sur la recette | Manquement à la confidentialité | Gérant (accord écrit), prestataire (effacer la base d'essai après accord) |
| Guides antérieurs aux évolutions du 27/10 au 03/11 | Formation et recette sur des guides incomplets | Prestataire |

## 6. Ce qui a été fait pendant l'audit

- Disque du serveur : cache de construction Docker purgé (30 Go libérés, 57 % → 28 %).
- Dossier des grilles du client sur le serveur : droits ramenés au seul compte d'exploitation.
- Copie de secours du dépôt (130 commits non poussés) sur le serveur, vérifiée :
  `~/sauvegardes-depot/eguitra-depot-20261104.bundle`.
- Poste du gérant : sortie de construction de l'application web supprimée (608 Mo, recréée à la
  prochaine construction).
- Corrections de code marquées **corrigé** au chapitre 4 : voir `ETAT.md` pour la version mise en
  production.

## 7. À faire par le gérant

1. **Pousser la branche** `claude/bold-shannon-gpg2hv` (130 commits non poussés).
2. **Redémarrer le serveur** (noyau Linux 7.0.0-42, correctifs de sécurité) : la session n'a pas
   l'autorisation de le faire. Commande : `ssh eguitra-vps 'sudo systemctl reboot'`, de préférence la
   nuit ; tout redémarre seul (vérifié dans la configuration).
3. Souscrire le stockage hors site (Backblaze B2 ou équivalent, clé sans droit de suppression) et
   donner les destinations d'alerte (ntfy sur le téléphone du gérant : deux minutes).
4. Fixer T0, tenir le premier comité de pilotage, faire contresigner le registre des prérequis.
5. Avenant écrit pour les ajouts hors offre.
6. Rétablir la double authentification avant toute donnée réelle.
7. Accord écrit du cabinet et des porteurs avant de poser la clé de l'IA ; même chose pour WhatsApp.
8. Libérer de la place sur le disque C: du poste (plein à 100 %).
