# Guide des testeurs de la plateforme NIMOVA

Vous allez essayer la plateforme avant sa mise en service et dire ce qui va, ce qui ne va pas et ce
qui manque. Vous travaillez sur la recette : une copie complète de la plateforme, avec des données
fictives (repérées « Démo »). Rien de ce que vous y faites ne touche la vraie comptabilité : vous
pouvez tout essayer, y compris les erreurs.

## 1. Se connecter la première fois

1. Ouvrez l'adresse de la recette remise par la direction, dans Chrome ou Edge sur ordinateur (Safari
   peut bloquer la session), dans Chrome sur téléphone.
2. Saisissez votre identifiant et le mot de passe provisoire qui vous ont été remis, puis « Se
   connecter ».
3. Choisissez votre mot de passe définitif (10 caractères au moins), puis reconnectez-vous avec lui.

Votre compte est personnel : ne le prêtez pas ; si une autre personne doit tester, demandez-lui un
compte. Mot de passe oublié : demandez à l'administrateur de vous en redonner un provisoire.

Double authentification : pendant la période de test, elle est désactivée sur la recette. Elle sera
obligatoire sur la plateforme réelle : à la première connexion, vous installerez Google
Authenticator ou Microsoft Authenticator sur votre téléphone, scannerez le code affiché, puis
taperez à chaque connexion le code à 6 chiffres de l'application.

## 2. Deux sociétés, plusieurs applications

EGUITRA GROUP SARLU et MB AxisPro sont deux entreprises distinctes : chacune a sa
comptabilité, ses clients, ses factures. La plateforme les sert par applications :

| Application | Adresse (à la suite de celle de la recette) | Pour qui | Société |
|---|---|---|---|
| NIMOVA · Finance | /finance | Direction, finance, métiers d'EGUITRA | Les deux, séparément : la société de travail se choisit dans la colonne de gauche |
| NIMOVA · AxisPro | /axispro | Direction, consultants du cabinet | MB AxisPro seulement |
| Rotations | /mobile | Exploitation, agents de parc | EGUITRA GROUP seulement |
| Portail des porteurs de projets | /portail | Clients du cabinet | MB AxisPro seulement |

Les comptes ouverts à Finance et à AxisPro passent de l'une à l'autre par la bascule « Finance |
AxisPro », en haut de la colonne de gauche. Les modules métier d'EGUITRA (transport, chantiers,
immobilier) n'apparaissent que lorsque la société de travail est EGUITRA GROUP.

## 3. Votre compte et ce que vous testez

| Compte | Métier | Applications | Sociétés |
|---|---|---|---|
| test.dg | Direction générale | Finance, AxisPro (consultation) | Les deux |
| test.daf | Responsable financier | Finance | Les deux |
| test.comptable | Comptable | Finance | Les deux |
| test.exploitation | Responsable exploitation transport | Finance (transport), Rotations | EGUITRA GROUP |
| test.parc | Agent de parc | Rotations, Finance (transport) | EGUITRA GROUP |
| test.chantiers | Conducteur de travaux | Finance (chantiers) | EGUITRA GROUP |
| test.immobilier | Gestionnaire immobilier | Finance (immobilier) | EGUITRA GROUP |
| test.consultant | Consultant du cabinet | AxisPro | MB AxisPro |
| test.admin | Administrateur | Toutes | Les deux |
| test.porteur | Porteur de projet (client du cabinet) | Portail | MB AxisPro |

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
- Changer de société (colonne de gauche) : vérifiez que les chiffres, les factures et les journaux
  d'EGUITRA GROUP et de MB AxisPro restent bien séparés.

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
  qu'un profil d'EGUITRA ne peut pas être ouvert sur MB AxisPro seule, et inversement.
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
