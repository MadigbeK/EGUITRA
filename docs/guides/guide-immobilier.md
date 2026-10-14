# Guide de la gestion immobilière

## Ce que fait la plateforme

Chaque bien a sa fiche (nature, surface, adresse, valeur d'acquisition et valeur actuelle) et son
axe analytique. Un bail en cours porte le locataire, le loyer et les charges par période, la
périodicité (mensuelle, trimestrielle ou annuelle), la prise d'effet, l'échéance et le dépôt de
garantie. Chaque nuit, la plateforme émet et valide les loyers échus, rattrapage compris : une
facture par échéance, datée de l'échéance, imputée au bien et à l'activité immobilière (compte 7073).
Les loyers impayés entrent dans les relances des clients.

## L'écran (EGUITRA Finance > Métiers > Immobilier)

- En tête : nombre de biens et taux d'occupation, loyers annuels, valeur du patrimoine, rendement
  brut, loyers impayés et baux arrivant à échéance sous trois mois.
- Trois onglets : « Biens et baux », « Loyers émis », « Impayés et relances ».

## Biens et baux

- « Nouveau bien » : désignation, nature, surface, adresse, valeur d'acquisition, valeur actuelle.
- « Louer » en face d'un bien libre : référence du bail, périodicité, locataire (choisi dans la
  liste des tiers, ou créé depuis le même champ), prise d'effet, échéance éventuelle, loyer HT et
  charges par période, dépôt de garantie, case « Bail soumis à la TVA » pour un bail commercial.
  « Signer et activer le bail » : les loyers échus depuis la prise d'effet sont émis la nuit suivante.
- « Fin de bail » en face d'un bien loué : indiquer la date de fin. Les loyers dus jusqu'à cette
  date sont émis, puis le bien redevient libre et n'est plus facturé. Un loyer déjà émis pour une
  période postérieure s'annule par un avoir, demandé à la finance.
- Un bien n'a qu'un bail en cours à la fois.

## Loyers émis et quittances

L'onglet « Loyers émis » liste les loyers avec leur règlement. Pour un loyer entièrement réglé,
le bouton « Quittance » ouvre la quittance de loyer, à imprimer et remettre au locataire. Aucune
quittance n'est délivrée pour un loyer non réglé ou réglé en partie.

« Émettre les loyers échus » (en haut de l'écran) lance tout de suite ce que la tâche de la nuit
ferait : utile après la saisie d'un bail avec une prise d'effet passée.

## Impayés et relances

L'onglet « Impayés et relances » liste les loyers échus non réglés : locataire, échéance, date
d'exigibilité, retard en jours, reste dû. Les relances (rappel, relance ferme, mise en demeure)
sont préparées par la finance dans « Relances clients ».
