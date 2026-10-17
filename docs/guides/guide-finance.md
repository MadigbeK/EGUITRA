# Guide de la finance et de la comptabilité

## Principe

Chaque opération se saisit une fois, à la source : la plateforme déduit les comptes, la TVA et
l'imputation analytique. Les pièces d'achat passent par le circuit d'approbation selon les seuils ;
les écritures validées ne se modifient plus (on passe un avoir ou une écriture de correction).

## Ventes (Comptabilité > Ventes)

- « Nouvelle facture » : client, date, contrat ou bon de commande, devise, lignes (désignation,
  quantité, prix, TVA) et, sous chaque ligne, un compte par axe analytique (activité, centre de coût,
  chantier, ensemble routier, route, bien ; dossier pour MB AxisPro). Sans compte saisi, la ligne
  prend le compte de produit de l'activité. Les axes laissés vides suivent les imputations
  automatiques. « Avoir » pour annuler tout ou partie d'une facture.
- Client non assujetti à la TVA (case de sa fiche) : ses factures sont émises en exonération.
- Litige : « Déclarer un litige » (motif obligatoire) sur la fiche de la facture ; elle passe en
  statut « Litige » (vue Litiges) et sort des relances jusqu'à « Lever le litige ».
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
circuit d'approbation et se comptabilise une fois approuvée. Chaque ligne se saisit par catégorie de
dépense : la catégorie fixe le compte et la TVA. Une catégorie dont le compte de tiers n'est pas un
compte fournisseur (salaires 422, cotisations 431, impôts 447) enregistre la dépense en opération
diverse ; une catégorie d'investissement crée l'immobilisation à la validation.

## Trésorerie (Comptabilité > Trésorerie)

- Position par compte et par devise.
- Nouvelle opération : type d'opération (il fixe le sens et la contrepartie ; un type client ou
  fournisseur laisse l'opération à rapprocher de la facture), mode de paiement, référence,
  justificatif et, avec un compte d'imputation, les axes analytiques.
- Import du relevé bancaire (CSV ou XLSX avec date, libellé et montant, ou débit et crédit). Les
  soldes initial et final sont lus dans le fichier (lignes « Solde initial », « Nouveau solde », ou
  colonne de solde) ou saisis : un relevé qui ne s'équilibre pas est refusé, sauf confirmation.
- Rapprochement : pour chaque ligne du relevé, la plateforme propose les pièces correspondantes ;
  valider la proposition ou imputer directement à un compte, avec ses axes.
- État de rapprochement (bouton du même nom) : solde du relevé, opérations comptabilisées absentes
  du relevé, solde comptable, écart résiduel et son explication ; imprimable et exportable en Excel.
  À la clôture, le solde des relevés doit égaler le solde comptable.
- Virements entre comptes : passent par le compte de passage 585, qui doit être soldé.

## Tiers (Comptabilité > Tiers)

Fiches clients et fournisseurs : code, NIF, RCCM, secteur, contact, conditions de paiement (délai,
fin de mois) côté client et côté fournisseur, non-assujettissement à la TVA, limites de crédit,
encours et historique.

## Journaux et OD (Comptabilité > Journaux et OD)

Écritures d'opérations diverses guidées et équilibrées, imputées sur les axes analytiques (comptes
des classes 2, 6, 7 et 8) ; consultation des journaux.

## Plan comptable (Comptabilité > Plan comptable)

Un compte se crée sous une racine existante du plan SYSCOHADA : sa nature et son lettrage suivent le
compte voisin. Un compte soldé se désactive (il ne se supprime jamais) ; « Imputation analytique
obligatoire » exige l'axe Activité sur ses écritures.

## Axes analytiques et imputations automatiques (Administration)

- Axes analytiques : activités (avec leur compte de produit) et centres de coût (rattachés à une
  activité) ; les axes des métiers naissent avec leur fiche. À la clôture, une ligne qui porte un
  centre de coût avec une autre activité que la sienne est signalée.
- Imputations automatiques : règles par préfixe de compte et par tiers (axes laissés vides à la
  saisie), axes obligatoires par préfixe, catégories de dépense, types d'opération de trésorerie,
  modes de paiement. Un essai montre l'imputation qu'appliqueraient les règles.

## Budget (Pilotage > Activités et budget)

Lignes budgétaires : nature (produits, charges, investissements), comptes (préfixes), douze mois,
activité et centre de coût facultatifs, solde résiduel des charges non couvertes. Le réalisé se
compare au budget cumulé à fin de mois, avec un statut par ligne (dépassement, au-dessus,
sous-réalisation…), une synthèse et une lecture par activité ou par centre de coût. Le budget
s'importe et s'exporte en Excel.

## Immobilisations (Comptabilité > Immobilisations)

Registre, plans d'amortissement. Les dotations échues sont comptabilisées chaque nuit.
« Sortir de l'actif » : cession (prix et acquéreur, créance 485 et produit 82x) ou mise au rebut
(prix nul) ; la valeur nette comptable est portée en 81x.

## Dette et financement (Comptabilité > Dette et financement)

Emprunts et crédits-bails, échéanciers, comptabilisation des échéances, service de la dette.

## Clôtures et contrôles (Comptabilité > Clôtures et contrôles)

Clôture mensuelle : la plateforme exécute les contrôles (équilibres, compte de passage, relevés
rapprochés et soldes des relevés égaux au solde comptable, pièces en attente, centres de coût
imputés avec leur activité…). Une anomalie bloquante empêche la clôture ; une clôture verrouille
les écritures de la période. La réouverture est réservée et tracée dans le registre.

## Balance et états (Comptabilité > Balance et états)

Bilan, compte de résultat et tableau des flux de trésorerie SYSCOHADA ; balance, grand livre,
rapports paramétrables, passerelle IFRS et export d'audit, en CSV ou XLSX.

## Fiscalité (Comptabilité > Fiscalité)

TVA collectée et déductible par période, préparation des déclarations à partir des écritures.
