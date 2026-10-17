# Guide de la finance et de la comptabilité

## Principe

Chaque opération se saisit une fois, à la source : la plateforme déduit les comptes, la TVA et
l'imputation analytique. Les pièces d'achat passent par le circuit d'approbation selon les seuils ;
les écritures validées ne se modifient plus (on passe un avoir ou une écriture de correction).

## Ventes (Comptabilité > Ventes)

- « Nouvelle facture » : client, date, lignes (désignation, quantité, prix, TVA), activité.
  « Avoir » pour annuler tout ou partie d'une facture.
- Les rotations de transport, les situations de chantier et les loyers génèrent leurs factures
  depuis leurs écrans : ne pas les ressaisir ici.
- Impression PDF de la facture, pièces jointes, suivi du reste à encaisser.

## Transport : paramètres, manquants et taxes (Métiers > Transport)

- Paramètres : tolérance de manquant par défaut (en % du volume chargé) et traitement du manquant
  hors tolérance (constat, déduction sur la facture du client, créance sur le chauffeur, ou les
  deux), comptes des manquants et des créances sur chauffeurs, option des manquants à 15 °C ;
  conditions propres à un client ou à un tarif ; produits transportés (masse volumique, prix du m³
  qui valorise les manquants) ; barème des taxes spécifiques (nature, base, taux, produits, routes,
  période, compte de charge, refacturation avec ou sans TVA).
- À la facturation : la déduction du manquant et les taxes refacturées s'ajoutent à la facture du
  client ; la créance sur un chauffeur devient une opération diverse en brouillon, à valider dans
  Journaux et OD (un chauffeur sans fiche tiers est signalé dans les contrôles).
- Taxes spécifiques : état mensuel par nature, rapproché des montants comptabilisés sur les comptes
  du barème, export XLSX.
- Rentabilité : imputer les achats de la flotte (carburant, pneumatiques, entretien) sur
  l'activité Transport pétrolier et sur l'ensemble routier, pour que les coûts comptabilisés
  répondent aux coûts déclarés sur les rotations ; rattacher chaque ensemble à son immobilisation.

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
- Rapprochement : pour chaque ligne du relevé, la plateforme propose les pièces correspondantes ;
  valider la proposition ou choisir la contrepartie.
- Virements entre comptes : passent par le compte de passage 585, qui doit être soldé.

## Tiers (Comptabilité > Tiers)

Fiches clients et fournisseurs, limites de crédit, encours et historique.

## Journaux et OD (Comptabilité > Journaux et OD)

Écritures d'opérations diverses guidées et équilibrées ; consultation des journaux.

## Immobilisations (Comptabilité > Immobilisations)

Registre, plans d'amortissement. Les dotations échues sont comptabilisées chaque nuit.
« Sortir de l'actif » : cession (prix et acquéreur, créance 485 et produit 82x) ou mise au rebut
(prix nul) ; la valeur nette comptable est portée en 81x.

## Dette et financement (Comptabilité > Dette et financement)

Emprunts et crédits-bails, échéanciers, comptabilisation des échéances, service de la dette.

## Clôtures et contrôles (Comptabilité > Clôtures et contrôles)

Clôture mensuelle : la plateforme exécute les contrôles (équilibres, compte de passage, relevés
rapprochés, pièces en attente…). Une anomalie bloquante empêche la clôture ; une clôture verrouille
les écritures de la période. La réouverture est réservée et tracée dans le registre.

## Balance et états (Comptabilité > Balance et états)

Bilan, compte de résultat et tableau des flux de trésorerie SYSCOHADA ; balance, grand livre,
rapports paramétrables, passerelle IFRS et export d'audit, en CSV ou XLSX.

## Fiscalité (Comptabilité > Fiscalité)

TVA collectée et déductible par période, préparation des déclarations à partir des écritures.
