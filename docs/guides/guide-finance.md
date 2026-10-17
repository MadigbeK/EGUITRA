# Guide de la finance et de la comptabilité

## Principe

Chaque opération se saisit **une seule fois, à un seul endroit** : la plateforme déduit les comptes,
la TVA et l'imputation analytique, et tout le reste en découle par calcul (états, tableau de bord,
alertes, rapport mensuel). Si une information semble manquer quelque part, elle se saisit ailleurs :
ne la retapez jamais. Les pièces d'achat passent par le circuit d'approbation selon les seuils ; les
écritures validées ne se modifient plus (on passe un avoir ou une écriture de correction).

## Où saisir quoi

| Vous voulez enregistrer… | Écran | Point d'attention |
|---|---|---|
| Une facture de vente | Comptabilité > Ventes | Rotations, situations de chantier et loyers produisent leurs factures : ne pas les ressaisir. |
| Un achat ou une dépense | Comptabilité > Achats et dépenses | Joindre la pièce numérisée, puis « Soumettre » au circuit d'approbation. |
| Un encaissement ou un paiement | Comptabilité > Trésorerie | Rapprocher chaque ligne du relevé de sa facture : c'est ce qui solde la créance ou la dette. |
| Une échéance d'emprunt prélevée en banque | Comptabilité > Trésorerie, « Rapprocher » | L'échéance est proposée sur la ligne du relevé : capital et intérêts en contrepartie, la sortie n'est comptée qu'une fois. |
| Un virement entre deux comptes | Comptabilité > Trésorerie, « Virement interne » | Il passe par le compte de passage 585, qui doit être soldé. |
| Une rotation de camion | Métiers > Transport (ou Rotations au parc) | Une rotation par voyage : source unique de la facturation et de la rentabilité par camion et par route. |
| Un bien amortissable | Comptabilité > Immobilisations | Les dotations échues sont comptabilisées chaque nuit. |
| Un nouvel emprunt ou crédit-bail | Comptabilité > Dette et financement | Renseigner l'objet, le compte de dette, le compte d'intérêts et le journal ; comptabiliser le déblocage. |
| Une écriture diverse | Comptabilité > Journaux et OD | À-nouveaux et régularisations seulement. |
| Un budget | Pilotage > Activités et budget | Un montant par compte et par mois ; le réalisé se compare au budget cumulé. |

## Trois règles à ne jamais enfreindre

1. Une opération diverse ne reprend jamais ce qu'un autre écran porte déjà : une facture ressaisie
   en OD serait comptée deux fois.
2. Un virement interne passe par le compte de passage 585, soldé en permanence : un solde résiduel
   signale une saisie incomplète et bloque la clôture.
3. Aucun état ne se diffuse avec une alerte bloquante active : total des débits égal au total des
   crédits (affiché en haut de l'écran), actif égal au passif, compte de passage soldé.

## Rythme de travail

| Quand | Quoi |
|---|---|
| Au fil de l'eau | Ventes, achats, trésorerie, rotations : saisir le jour même évite les oublis de pièces justificatives. |
| Chaque semaine | Importer les relevés bancaires et rapprocher les lignes ; traiter les validations et les relances. |
| Chaque fin de mois | Vérifier les alertes et les contrôles (pastilles de la navigation), puis lancer la clôture ; imprimer le rapport mensuel. |
| Chaque trimestre | Actualiser les taux de change, revoir les seuils d'alerte avec la direction, contrôler les immobilisations totalement amorties. |
| Chaque année | Reprise des à-nouveaux, révision du budget, inventaire de la flotte et des stocks. |

## Pilotage (Pilotage > Tableau de bord, Alertes, Rapport mensuel)

- Tableau de bord du dirigeant, à toute date (« Arrêté au ») et pour la société ou le groupe :
  chiffre d'affaires face au budget, marges d'EBE et nette, délai de recouvrement (DSO) face à la
  cible, couverture de la dette (DSCR) face au minimum, trésorerie prévue en fin de mois, besoin en
  fonds de roulement, trésorerie de fin de mois avec le seuil de sécurité, les onze questions du
  dirigeant et ce qui demande une décision. Le bouton « Imprimer » produit un document diffusable.
- Alertes de gestion : chaque règle compare une valeur à un seuil, avec sa gravité (bloquante,
  critique, élevée, moyenne), son domaine et l'action recommandée. « Toutes les règles » montre aussi
  les règles conformes. Un seuil laissé à 0 éteint sa règle : la plateforme le signale.
- Rapport mensuel de gestion : synthèse, lecture de la période rédigée (comparée au mois précédent
  et à l'an dernier), trésorerie et financement, clients et fournisseurs, transport, flux mensuels,
  alertes avec leurs actions.
- Activités et budget : résultat par axe analytique, budget et écarts, trésorerie mensuelle
  (encaissements, décaissements, cash net, solde, prévision à trois mois), BFR et délais.

## Ventes (Comptabilité > Ventes)

- « Nouvelle facture » : client, date, lignes (désignation, quantité, prix, TVA), activité.
  « Avoir » pour annuler tout ou partie d'une facture.
- Les rotations de transport, les situations de chantier et les loyers génèrent leurs factures
  depuis leurs écrans : ne pas les ressaisir ici.
- Impression PDF de la facture, pièces jointes, suivi du reste à encaisser.

## Relances clients (Comptabilité > Relances clients)

Calculées chaque nuit selon le retard : rappel (dès le premier jour), relance ferme (15 jours),
mise en demeure (30 jours). Ouvrir une relance pour voir la lettre, l'imprimer et la marquer
« remise par courrier », ou l'envoyer par courriel si un serveur d'envoi est paramétré. La mise en
demeure n'est jamais envoyée sans votre décision.

## Achats et dépenses (Comptabilité > Achats et dépenses)

Saisir la pièce du fournisseur avec sa pièce jointe numérisée, puis « Soumettre » : elle part au
circuit d'approbation et se comptabilise une fois approuvée.

## Trésorerie (Comptabilité > Trésorerie)

- Position par compte et par devise.
- Import du relevé bancaire (CSV ou XLSX avec date, libellé et montant, ou débit et crédit).
- Rapprochement : pour chaque ligne du relevé, la plateforme propose les factures et règlements en
  attente, et pour une sortie de banque les échéances d'emprunt ; valider la proposition ou choisir
  la contrepartie. Une échéance déjà réglée directement en banque et retrouvée sur le relevé voit ce
  règlement direct extourné : la sortie n'est jamais comptée deux fois.
- Virements entre comptes : passent par le compte de passage 585, qui doit être soldé.

## Tiers (Comptabilité > Tiers)

Fiches clients et fournisseurs, limites de crédit, encours et historique. La vue « Balance âgée »
donne, pour les clients comme pour les fournisseurs, l'ancienneté par tranche avec le nombre de
pièces, et l'encours de chaque tiers avec son retard maximal et son statut : à jour, retard,
contentieux (plus de 90 jours).

## Journaux et OD (Comptabilité > Journaux et OD)

Écritures d'opérations diverses guidées et équilibrées ; consultation des journaux.

## Immobilisations (Comptabilité > Immobilisations)

Registre, plans d'amortissement. Les dotations échues sont comptabilisées chaque nuit.
« Sortir de l'actif » : cession (prix et acquéreur, créance 485 et produit 82x) ou mise au rebut
(prix nul) ; la valeur nette comptable est portée en 81x.

## Dette et financement (Comptabilité > Dette et financement)

Emprunts et crédits-bails, objet du financement, échéanciers, service de la dette. L'écran compare
l'encours comptable (comptes 16 et 17) au capital restant dû des échéanciers : un écart signale un
déblocage ou une échéance non comptabilisé. Il donne aussi la dette nette, le gearing (dette sur
capitaux propres), la dette rapportée à l'EBE des douze derniers mois et le DSCR. « Régler » est
réservé à la caisse et aux comptes sans relevé : une échéance prélevée en banque se règle depuis la
ligne du relevé.

## Clôtures et contrôles (Comptabilité > Clôtures et contrôles)

Clôture mensuelle : la plateforme exécute les contrôles (équilibres, compte de passage, relevés
rapprochés, pièces en attente, encours de dette conforme aux échéanciers, échéances rapprochées des
relevés…). Une anomalie bloquante empêche la clôture ; une clôture verrouille les écritures de la
période. La réouverture est réservée et tracée dans le registre.

## Balance et états (Comptabilité > Balance et états)

Bilan, compte de résultat et tableau des flux de trésorerie SYSCOHADA ; balance, grand livre,
rapports paramétrables, passerelle IFRS et export d'audit, en CSV ou XLSX.

## Fiscalité (Comptabilité > Fiscalité)

TVA collectée et déductible par période, préparation des déclarations à partir des écritures.
