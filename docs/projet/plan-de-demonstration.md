# Plan de démonstration de la plateforme, 16 octobre 2026

Première présentation du système au DG, sur la **recette** (données fictives repérées « Démo »).
Durée visée : 45 minutes, plus les questions. La production existe mais ne contient encore aucune
donnée : on ne la montre pas.

## Préparation, avant la réunion (15 minutes)

1. Ouvrir l'adresse publique de la recette, en HTTPS (transmise par E-VOLUTION XP), suivie de
   `/finance`. Elle fonctionne aussi sur un téléphone. À défaut, le tunnel
   `ssh -N -L 3100:127.0.0.1:3100 eguitra-vps` puis http://localhost:3100.
2. Dans Chrome ou Edge, ouvrir l'adresse de la recette et se connecter avec
   l'identifiant `emkouyate` et le mot de passe provisoire. Activer la double authentification avec
   le téléphone, puis choisir le mot de passe définitif. À faire maintenant, pas devant le DG.
3. Ouvrir à l'avance un onglet par étape : Tableau de bord, À valider, Transport, Immobilier,
   Clôtures et contrôles, puis AxisPro (`/axispro`).
4. Facultatif, pour montrer le portail : AxisPro, dossier « Unité de séchage de mangues (démo) »,
   carte « Accès du porteur au portail » : identifiant `porteur.mamou`, nom « Promoteur Mamou »,
   un mot de passe provisoire, « Ouvrir l'accès ». Dans une fenêtre de navigation privée, se
   connecter sur `/portail` avec ce compte, activer sa double authentification et changer le mot
   de passe.
5. Rotations : sur un téléphone, ouvrir l'adresse de la recette suivie de `/mobile` (et l'ajouter à
   l'écran d'accueil) ; sur l'ordinateur, touche F12 puis l'icône « téléphone » (Ctrl+Maj+M).

Chiffres attendus (EGUITRA GROUP, exercice 2026, fictifs) : chiffre d'affaires environ 3,66 Md GNF,
résultat environ 0,87 Md, trésorerie environ 0,99 Md, créances environ 1,26 Md dont 158 M échues.

## Déroulé

### 1. Ouverture (3 min)
- La note du DG demande un outil unique aux deux structures, pour centraliser, maîtriser et
  décider. Ce que vous montrez existe : une plateforme installée sur un serveur dédié, avec un
  environnement de production et un environnement de recette.
- Les chiffres de la démonstration sont fictifs. L'identité NIMOVA est en cours d'application à
  tous les écrans.

### 2. Connexion et sécurité (3 min)
- Identifiant, mot de passe, puis code du téléphone : obligatoire pour tous, porteurs compris.
- Chaque profil ne voit que son périmètre ; toutes les connexions sont journalisées. Personne ne
  travaille directement dans Odoo : c'est le moteur, invisible.

### 3. Deux sociétés, un seul compte (3 min)
- Sélecteur de société en haut de l'écran : EGUITRA GROUP SARLU, puis MB AxisPro.
  Deux comptabilités séparées : plans de comptes, journaux, numérotations.
- Sur le tableau de bord, « Groupe consolidé » réunit les deux pour la direction.

### 4. Tableau de bord du dirigeant (5 min)
- Chiffre d'affaires, résultat, trésorerie par compte, créances et leur ancienneté.
- Alertes : « Clôture en retard », septembre n'est pas encore clôturé (seuil de 10 jours). Les seuils
  se règlent dans Administration > Seuils et taux.
- Rapport mensuel de gestion : la synthèse à remettre à la direction chaque mois.

### 5. Approbation en direct (5 min)
- « À valider » : deux pièces d'achat saisies par le comptable. La première (17,7 M TTC) relève
  de la finance seule ; la seconde (85 M TTC) de la finance puis de la direction.
- Approuver la première : elle est comptabilisée aussitôt. Ouvrir la seconde : deux niveaux.
- Personne n'approuve sa propre pièce ; une pièce modifiée après accord repart au circuit.

### 6. Finance au quotidien (8 min)
- Ventes : une facture et son PDF (identité de la société, NIF, RCCM au pied).
- Trésorerie : position par compte, import d'un relevé, rapprochement assisté.
- Relances clients : rappel, relance ferme, mise en demeure, jamais envoyée sans décision.
- Immobilisations : deux biens amortis chaque mois sans intervention.
- Dette et financement : emprunt d'un milliard, échéancier, échéances réglées.
- Balance et états : bilan, compte de résultat et tableau des flux au format SYSCOHADA ; exports
  Excel. Fiscalité : TVA du mois, export pour l'auditeur.
- Clôtures et contrôles : contrôles avant clôture, verrouillage et chaînage des écritures,
  contrôles d'intégrité (une écriture modifiée hors de la plateforme serait signalée).

### 7. Transport (6 min)
- Rotations : 30 rotations sur quatre mois, validées au bureau, facturées par client.
- Rentabilité par ensemble routier, par route et par mois : la route Conakry - Labé ne dégage
  qu'environ 10 % de marge, contre plus de 60 % pour les autres.
- Écran du parc (Rotations, en mode téléphone) : saisir une rotation, couper le réseau (F12,
  onglet Réseau, « Hors connexion »), en saisir une autre, rétablir : elle part seule, sans doublon.

### 8. Chantiers et immobilier (4 min)
- Chantier : situation d'avancement, retenue de garantie de 5 % suivie jusqu'à sa libération.
- Immobilier : bail des bureaux de Kaloum, loyers émis et validés chaque nuit, quittance pour un
  loyer réglé, impayés, fin de bail.

### 9. AxisPro (6 min)
- Passer sur MB AxisPro. Grille d'évaluation : grille de démonstration de 10 critères ;
  la grille officielle de 111 critères s'importera depuis le classeur du cabinet.
- Dossier « Usine de briques compressées » : évaluation par étape, score, critères éliminatoires,
  pièces de la data room, comités verrouillés, rapport Excel, temps et honoraires.
- Portail du porteur (fenêtre privée, si préparé) : ses pièces à déposer, ses échanges, sans
  jamais voir les notes internes du cabinet.

### 10. Administration et sûreté (3 min)
- Utilisateurs, profils et sociétés de chaque compte ; identité des sociétés ; journal d'audit.
- Sauvegarde continue (15 minutes de données au plus), test de restauration chaque mois,
  supervision toutes les 5 minutes.

### 11. Suite et décisions (5 min)
- Identité NIMOVA : appliquée à tous les écrans avant la recette ; domaine nimovagroup.com à
  enregistrer au nom du client (nimova.com est déjà pris).
- Reprise de l'exercice 2026 dès réception du classeur et des relevés bancaires ; grille AxisPro
  officielle ; liste des utilisateurs ; validation du plan de comptes par l'expert-comptable.
- La note NIMOVA va au-delà du contrat (stocks et carburant, maintenance, ressources humaines,
  commandes et réceptions d'achat, devis) : à chiffrer séparément si le DG les veut.
- Calendrier : recette avec les référents, formation par profil, bascule en production.

## Si l'on vous demande

- « C'est Odoo ? » Odoo est le moteur comptable, invisible. L'interface, les règles et les écrans
  sont faits pour vous.
- « Et sans réseau au parc ? » Rotations fonctionne hors ligne et envoie tout au retour du réseau.
- « Nos données sont-elles en sécurité ? » Double authentification pour tous, sauvegarde continue,
  copie hors site chiffrée dès que le stockage est fourni.
- « Pourquoi pas encore NIMOVA à l'écran ? » L'identité est en cours d'application, tous écrans
  confondus, avant la recette.

## À éviter pendant la démonstration

- La production (vide) ; Safari ; « Clôturer le mois » ; toute suppression.
- Promettre les modules hors contrat sans chiffrage.
