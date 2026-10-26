# Guide des testeurs de la plateforme NIMOVA

Vous allez essayer la plateforme avant sa mise en service et dire ce qui va, ce qui ne va pas et ce
qui manque. Vous travaillez sur la recette : une copie complète de la plateforme, avec des données
fictives (repérées « Démo »). Rien de ce que vous y faites ne touche la vraie comptabilité : vous
pouvez tout essayer, y compris les erreurs.

## 1. Se connecter

1. Ouvrez l'adresse de votre application (tableau ci-dessous), dans Chrome ou Edge sur ordinateur
   (Safari peut bloquer la session), dans Chrome sur téléphone.
2. Saisissez votre identifiant et le mot de passe commun de la recette, communiqué par E-VOLUTION
   XP, puis « Se connecter ».

La connexion se fait toujours dans une application : celle de l'adresse ouverte. L'adresse de la
recette, seule, ouvre la connexion à Finance, puis l'accueil NIMOVA, d'où l'on passe aux autres
applications du compte. Un compte qui n'a pas Finance (cabinet, RH, salarié, porteur) ouvre l'adresse
de son application ; sinon la connexion répond « Votre profil ne donne pas accès à cette
application. ».

| Application {30} | Adresse à ouvrir {34} | Comptes de test {36} |
|---|---|---|
| Finance, Transport, Analyse, RH (par l'accueil NIMOVA) | l'adresse de la recette | test.dg, test.daf, test.comptable, test.achats, test.exploitation, test.parc, test.chantiers, test.immobilier, test.admin |
| MB AxisPro Consulting (AxisPro Suite) | l'adresse de la recette suivie de /axispro | test.consultant, test.associe |
| Analyse, pour le cabinet | l'adresse de la recette suivie de /analyse | test.consultant, test.associe |
| RH et « Mon espace » | l'adresse de la recette suivie de /rh | test.rh, test.salarie |
| Rotations, au téléphone | l'adresse de la recette suivie de /mobile | test.exploitation, test.parc |
| Portail des porteurs de projets | l'adresse de la recette suivie de /portail | test.porteur, porteur.demo |

Sur la recette, le mot de passe est commun à tous les comptes et ne se modifie pas : une tentative de
changement est refusée, c'est normal. Votre compte de test reste personnel pendant la campagne : si
une autre personne doit tester, demandez-lui un compte.

Double authentification : pendant la période de test, elle est désactivée sur la recette. Elle sera
obligatoire sur la plateforme réelle : à la première connexion, vous installerez Google
Authenticator ou Microsoft Authenticator sur votre téléphone, scannerez le code affiché, puis
taperez à chaque connexion le code à 6 chiffres de l'application.

## 2. Deux sociétés, plusieurs applications

EGUITRA GROUP SARLU et MB AxisPro Consulting sont deux entreprises distinctes : chacune a sa
comptabilité, ses clients, ses factures. La plateforme les sert par applications :

| Application | Pour qui | Société |
|---|---|---|
| NIMOVA · Finance | Direction, finance, achats, métiers d'EGUITRA | Les deux, séparément : la société de travail se choisit en haut à droite |
| NIMOVA · Transport | Direction, finance, exploitation | EGUITRA GROUP SARLU seulement |
| NIMOVA · MB AxisPro Consulting | Direction, consultants du cabinet | MB AxisPro Consulting seulement |
| NIMOVA · Analyse | Direction, finance, cabinet | Selon la société de travail |
| NIMOVA · RH | Direction, ressources humaines ; « Mon espace » pour chaque salarié | Les deux, gestion commune |
| NIMOVA · Rotations | Exploitation, agents de parc | EGUITRA GROUP SARLU seulement |
| Portail des porteurs de projets | Clients du cabinet | MB AxisPro Consulting seulement |

Un compte ouvert à plusieurs applications passe de l'une à l'autre par le nom de l'espace, en haut à
gauche (NIMOVA, puis le nom du module), ou par l'accueil NIMOVA. Les modules métier d'EGUITRA (BTP,
immobilier) n'apparaissent que lorsque la société de travail est EGUITRA GROUP SARLU.

## 3. Votre compte et ce que vous testez

| Compte | Métier | Applications | Sociétés |
|---|---|---|---|
| test.dg | Direction générale | Finance, Transport, AxisPro (consultation), Analyse, RH | Les deux |
| test.daf | Responsable financier | Finance, Transport, Analyse | Les deux |
| test.comptable | Comptable | Finance, Transport, Analyse | Les deux |
| test.achats | Acheteur | Finance (achats) | Les deux |
| test.exploitation | Responsable exploitation transport | Finance, Transport, Rotations | EGUITRA GROUP |
| test.parc | Agent de parc | Rotations, Transport, Finance | EGUITRA GROUP |
| test.chantiers | Conducteur de travaux | Finance (BTP) | EGUITRA GROUP |
| test.immobilier | Gestionnaire immobilier | Finance (immobilier) | EGUITRA GROUP |
| test.consultant | Consultant du cabinet | AxisPro, Analyse | MB AxisPro Consulting |
| test.associe | Associé du cabinet (second regard) | AxisPro, Analyse | MB AxisPro Consulting |
| test.rh | Gestionnaire RH | RH | Les deux |
| test.salarie | Salarié | RH, « Mon espace » seul | EGUITRA GROUP |
| test.admin | Administrateur | Toutes | Les deux |
| test.porteur | Porteur de projet (client du cabinet) | Portail | MB AxisPro Consulting |

Pour chaque compte, voici ce qu'il faut essayer. Notez tout ce qui vous surprend, même un détail.

### Direction générale (test.dg)

- Tableau de bord : chiffre d'affaires, résultat, trésorerie, créances clients ; « Groupe consolidé »
  pour voir les deux sociétés réunies, puis une société seule.
- Rapport mensuel et Alertes : ce que vous attendez chaque mois de la finance y est-il ?
- À valider : approuver ou refuser une dépense qui vous revient (les grosses dépenses passent par la
  finance puis par la direction).
- AxisPro : l'accueil du portefeuille (dossiers par étape, financements, risques, rentabilité), puis
  la fiche d'un dossier. La direction consulte ; seuls les consultants modifient.

### Responsable financier (test.daf) et comptable (test.comptable)

- Ventes : créer une facture client, l'imprimer en PDF. Achats et dépenses : saisir une facture
  fournisseur.
- À valider : la dépense saisie par le comptable arrive chez le responsable financier ; personne
  n'approuve sa propre pièce. Essayez à deux : test.comptable saisit, test.daf approuve.
- Trésorerie : position des comptes, import d'un relevé, rapprochement.
- Relances clients, immobilisations, dette et financement, fiscalité (TVA), balance et états
  (bilan, compte de résultat au format SYSCOHADA, exports Excel), clôtures et contrôles.
- Changer de société (nom de la société, en haut à droite) : vérifiez que les chiffres, les factures et les journaux
  d'EGUITRA GROUP et de MB AxisPro Consulting restent bien séparés.

### Exploitation transport (test.exploitation) et agent de parc (test.parc)

- Rotations, sur le téléphone : ajouter l'adresse /mobile à l'écran d'accueil, saisir une rotation
  (camion, chauffeur, route, volumes), couper le réseau, en saisir une autre, rétablir le réseau :
  elles partent seules, sans doublon.
- Application NIMOVA · Transport (accueil NIMOVA, rayon Transport) : tableau de bord, rotations à
  valider (marge estimée à la saisie), rentabilité par camion, par route et par mois, flotte et
  chauffeurs, routes et tarifs. La facturation des rotations et les relevés des propriétaires
  reviennent à la finance.

### Chantiers (test.chantiers)

- Finance > Chantiers : la liste des chantiers, l'avancement, le montant facturé et les retenues de
  garantie ; enregistrer une situation d'avancement. La facturation revient à la finance.

### Immobilier (test.immobilier)

- Finance > Immobilier : biens et baux, loyers émis automatiquement chaque mois, quittance d'un loyer
  payé, impayés, fin de bail, création d'un bail.

### Consultant du cabinet (test.consultant)

- AxisPro : l'accueil du portefeuille ; un dossier de démonstration de bout en bout : évaluation des
  critères, modèle financier (modifier une hypothèse et voir la VAN, le TRI et le DSCR changer),
  risques, plan d'actions, financements recherchés, data room (déposer une pièce), comités, échanges
  avec le porteur, rapport, temps et facture d'honoraires.
- Grille d'évaluation : créer une nouvelle version en brouillon et ajuster un critère.
- Ouvrir un dossier fictif de votre choix et le mener jusqu'au comité.

### Administrateur (test.admin)

- Administration > Utilisateurs : créer un compte, lui donner un profil et une société ; vérifier
  qu'un profil d'EGUITRA ne peut pas être ouvert sur MB AxisPro Consulting seule, et inversement.
- Sociétés (identité imprimée sur les factures), seuils et taux, journal d'audit (qui a fait quoi).

### Porteur de projet (test.porteur)

- Portail : l'avancement de votre dossier, les pièces demandées (en déposer une), les actions que le
  cabinet attend de vous (« J'ai réalisé cette action »), les échanges avec votre consultant. Vous
  ne devez jamais voir le score détaillé ni les notes internes du cabinet.

## 4. Faire un retour

Notez chaque remarque dans la fiche de retours (classeur Excel remis avec ce guide), une ligne par
remarque :

- Compte et application, et l'adresse de l'écran (copiez-la depuis la barre d'adresse).
- Type : anomalie (quelque chose ne marche pas), amélioration (cela marche mais pourrait mieux
  faire), manque (une fonction attendue n'existe pas), question.
- Ce que vous avez fait, ce que vous attendiez, ce qui s'est passé.
- Gravité : bloquant (impossible de continuer), gênant, mineur.
- Une capture d'écran aide beaucoup : sur Windows, touches Windows + Maj + S, puis collez-la dans un
  courriel ou enregistrez-la ; indiquez son nom dans la fiche.

Envoyez la fiche à la direction en fin de semaine. Un point bloquant se signale tout de suite, par
téléphone ou par message.

## 5. Bon à savoir

- Les données sont fictives et peuvent être remises à zéro : n'y saisissez pas de vraies informations
  confidentielles (comptes bancaires, salaires nominatifs).
- La plateforme réelle (production) est séparée : rien de ce que vous faites ici n'y passe.
- Les écrans évoluent pendant la période de test : une remarque peut être corrigée d'un jour à
  l'autre.
