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
| Une dépense à engager (commande, contrat) | Pilotage > Engagements de dépense | Engager avant de commander, devis joint : l'engagement approuvé couvre ensuite les factures du fournisseur. |
| Un achat ou une dépense | Comptabilité > Achats et dépenses | Joindre la pièce numérisée, puis « Soumettre » au circuit d'approbation. |
| Un encaissement ou un paiement | Comptabilité > Trésorerie | Rapprocher chaque ligne du relevé de sa facture : c'est ce qui solde la créance ou la dette. |
| Une échéance d'emprunt prélevée en banque | Comptabilité > Trésorerie, « Rapprocher » | L'échéance est proposée sur la ligne du relevé : capital et intérêts en contrepartie, la sortie n'est comptée qu'une fois. |
| Un virement entre deux comptes | Comptabilité > Trésorerie, « Virement interne » | Il passe par le compte de passage 585, qui doit être soldé. |
| Une rotation de camion | Métiers > Transport (ou Rotations au parc) | Une rotation par voyage : source unique de la facturation et de la rentabilité par camion et par route. |
| Un bien amortissable | Comptabilité > Immobilisations | Les dotations échues sont comptabilisées chaque nuit. |
| Un nouvel emprunt ou crédit-bail | Comptabilité > Dette et financement | Renseigner l'objet, le compte de dette, le compte d'intérêts et le journal, puis « Mettre en service ». |
| Le déblocage d'un emprunt | Comptabilité > Trésorerie, type « Déblocage d'emprunt » | Désigner le financement : l'entrée de banque crédite son compte de dette. |
| Une écriture diverse | Comptabilité > Journaux et OD | À-nouveaux et régularisations seulement ; droit « Saisie libre des comptes ». |
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
  les règles conformes. Un seuil laissé à 0 éteint sa règle : la plateforme le signale, et les
  questions du dirigeant, le tableau de bord, le rapport mensuel, l'écran Dette et le transport
  affichent alors la valeur sans la juger (« Seuil non fixé »), au lieu de la comparer à une valeur
  par défaut. Seule une trésorerie négative reste signalée en rouge. La « Marge du mois » du
  transport se juge contre la marge minimale fixée (30 % par défaut).
- Rapport mensuel de gestion : synthèse, lecture de la période rédigée (comparée au mois précédent
  et à l'an dernier), trésorerie et financement, clients et fournisseurs, transport, flux mensuels,
  alertes avec leurs actions.
- Activités et budget : résultat par axe analytique, budget et écarts, trésorerie mensuelle
  (encaissements, décaissements, cash net, solde, prévision à trois mois), BFR et délais.

## Ventes (Comptabilité > Ventes)

- « Nouvelle facture » : client, date, contrat ou bon de commande, devise, lignes (désignation,
  quantité, prix, TVA) et, sous chaque ligne, un compte par axe analytique (activité, centre de coût,
  chantier, ensemble routier, route, bien ; dossier pour MB AxisPro). Sans compte saisi, la ligne
  prend le compte de produit de l'activité ; choisir un autre compte demande le droit « Saisie libre
  des comptes ». Les axes laissés vides suivent les imputations automatiques. « Avoir » pour annuler
  tout ou partie d'une facture.
- Client non assujetti à la TVA (case de sa fiche) : ses factures sont émises en exonération.
- Litige : « Déclarer un litige » (motif obligatoire) sur la fiche de la facture ; elle passe en
  statut « Litige » (vue Litiges) et sort des relances jusqu'à « Lever le litige ».
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
- Export des rotations (XLSX ou CSV) : une colonne par frais (pneumatiques compris), puis
  kilométrage et ratios (distance, carburant, durée, chiffre d'affaires et coût au kilomètre, coût
  au litre, consommation aux 100 km).

## Relances clients (Comptabilité > Relances clients)

Calculées chaque nuit selon le retard : rappel (dès le premier jour), relance ferme (15 jours),
mise en demeure (30 jours). Ouvrir une relance pour voir la lettre, l'imprimer et la marquer
« remise par courrier », ou l'envoyer par courriel si un serveur d'envoi est paramétré. La mise en
demeure n'est jamais envoyée sans votre décision.

## Engagements de dépense (Pilotage > Engagements de dépense)

Avant toute commande ou tout contrat : « Nouvel engagement » (fournisseur, objet, montant, axes
analytiques, devis joint), puis « Soumettre ». L'engagement suit le circuit d'approbation (finance,
direction au-delà de 50 M GNF). Une fois approuvé, les factures du fournisseur rattachées à
l'engagement (il est proposé à la saisie) se comptabilisent sans refaire le circuit, tant qu'elles
restent dans le reste à engager (tolérance de 5 %). Le suivi budgétaire montre l'engagé et le
disponible de chaque ligne ; l'état « Engagements de dépense non soldés » est au registre des
rapports. Solder un engagement libère son reste.

## Achats et dépenses (Comptabilité > Achats et dépenses)

Saisir la pièce du fournisseur avec sa pièce jointe numérisée, puis « Soumettre » : elle part au
circuit d'approbation et se comptabilise une fois approuvée. Chaque ligne se saisit par catégorie de
dépense : la catégorie fixe le compte et la TVA (choisir un autre compte demande le droit « Saisie
libre des comptes » ; sans lui, la catégorie est obligatoire). Une catégorie dont le compte de tiers
n'est pas un compte fournisseur (salaires 422, cotisations 431, impôts 447) enregistre la dépense en
opération diverse ; une catégorie d'investissement crée l'immobilisation à la validation.

## Trésorerie (Comptabilité > Trésorerie)

- Position par compte et par devise.
- Nouvelle opération : type d'opération (il fixe le sens et la contrepartie ; un type client ou
  fournisseur laisse l'opération à rapprocher de la facture), mode de paiement, référence,
  justificatif et, avec un compte d'imputation, les axes analytiques. Choisir soi-même le compte
  d'imputation demande le droit « Saisie libre des comptes » ; sans lui, l'opération prend le compte
  de son type, ou reste à rapprocher.
- Financements : un type à part d'emprunt demande le financement concerné (Dette et financement,
  financement en service) et prend son compte. « Déblocage d'emprunt » : l'entrée de banque crédite
  le compte de dette ; c'est ainsi que le déblocage se comptabilise (plusieurs tranches possibles,
  dans la limite du montant emprunté). « Remboursement anticipé d'emprunt (capital) » et « Intérêts
  d'emprunt hors échéancier » : la sortie débite le compte de dette ou le compte de charges
  financières. Ces deux types ne règlent jamais une échéance de l'échéancier, qui se règle depuis la
  ligne du relevé (« Rapprocher ») ou par « Régler » : un montant égal à une échéance non réglée est
  refusé, l'échéance ne peut pas être comptée deux fois. Après un remboursement anticipé, l'écart
  avec l'échéancier est signalé à la clôture jusqu'à sa révision par la banque.
- Import du relevé bancaire : CSV ou XLSX avec date, libellé et montant (ou débit et crédit), ou
  relevé normalisé ISO 20022 camt.053 (XML) fourni par la banque. Les soldes initial et final sont lus
  dans le fichier (lignes « Solde initial », « Nouveau solde », colonne de solde, soldes d'ouverture
  et de clôture du camt.053) ou saisis : un relevé qui ne s'équilibre pas est refusé, sauf
  confirmation. Les opérations en attente d'un camt.053 ne sont pas importées.
- Sorties de caisse et de banque, règlement d'une échéance d'emprunt, virement interne : au-delà
  de 100 M GNF, l'opération reste en brouillon et part au circuit d'approbation (« À valider ») ;
  elle se comptabilise à la dernière approbation.
- Rapprochement : pour chaque ligne du relevé, la plateforme propose les factures et règlements en
  attente, et pour une sortie de banque les échéances d'emprunt ; valider la proposition, imputer
  selon un type d'opération (frais bancaires, déblocage d'emprunt reçu en banque…, avec le
  financement pour un type d'emprunt) ou, avec le droit « Saisie libre des comptes », imputer
  directement à un compte, avec ses axes. Une échéance déjà réglée directement en banque et retrouvée
  sur le relevé voit ce règlement direct extourné : la sortie n'est jamais comptée deux fois.
- État de rapprochement (bouton du même nom) : solde du relevé, opérations comptabilisées absentes
  du relevé, solde comptable, écart résiduel et son explication ; imprimable et exportable en Excel.
  À la clôture, le solde des relevés doit égaler le solde comptable.
- Virements entre comptes : passent par le compte de passage 585, qui doit être soldé.

## Tiers (Comptabilité > Tiers)

Fiches clients et fournisseurs : code, NIF, RCCM, secteur, contact, conditions de paiement (délai,
fin de mois) côté client et côté fournisseur, non-assujettissement à la TVA, retenues à la source par
défaut, limites de crédit, encours et historique. La vue « Balance âgée » donne, pour les clients
comme pour les fournisseurs, l'ancienneté par tranche avec le nombre de pièces, et l'encours de
chaque tiers avec son retard maximal et son statut : à jour, retard, contentieux (plus de 90 jours).

## Journaux et OD (Comptabilité > Journaux et OD)

Écritures d'opérations diverses guidées et équilibrées, imputées sur les axes analytiques (comptes
des classes 2, 6, 7 et 8) ; consultation des journaux. Chaque ligne d'une OD porte un compte choisi :
la saisie des OD est réservée au droit « Saisie libre des comptes » (sans lui, le bouton « Nouvelle
OD » est inactif et la plateforme refuse l'opération).

## Plan comptable (Comptabilité > Plan comptable)

Un compte se crée sous une racine existante du plan SYSCOHADA : sa nature et son lettrage suivent le
compte voisin. Un compte soldé se désactive (il ne se supprime jamais) ; « Imputation analytique
obligatoire » exige l'axe Activité sur ses écritures.

## Axes analytiques et imputations automatiques (Administration)

- Axes analytiques : activités (avec leur compte de produit) et centres de coût (rattachés à une
  activité) ; les axes des métiers naissent avec leur fiche. À la clôture, une ligne qui porte un
  centre de coût avec une autre activité que la sienne est signalée.
- Imputations automatiques : règles par préfixe de compte et par tiers (axes laissés vides à la
  saisie), axes obligatoires par préfixe, catégories de dépense, types d'opération de trésorerie
  (sens, compte de contrepartie ou part d'emprunt : déblocage, capital, intérêts), modes de paiement.
  Un essai montre l'imputation qu'appliqueraient les règles. « Proposer les types usuels » ajoute les
  types courants, dont les trois types des financements.
- Les comptes des catégories de dépense, des types d'opération et des financements deviennent ceux
  des pièces des autres utilisateurs : les fixer ou les changer demande le droit « Saisie libre des
  comptes ».

## Saisie libre des comptes (Administration > Utilisateurs)

Droit complémentaire aux profils, accordé d'office aux comptes finance, direction et administration
(rien ne change pour eux) et retirable compte par compte (case « Saisie libre des comptes » de la
fiche de l'utilisateur). Sans ce droit, l'utilisateur ne choisit plus de compte : la ligne prend le
compte de sa catégorie de dépense, du type d'opération, de l'activité (compte de produit) ou du
produit ; les opérations diverses, l'imputation directe à un compte au rapprochement et le
paramétrage des comptes lui sont refusés, avec un message qui l'explique. Les écrans masquent alors
le choix du compte.

## Budget (Pilotage > Activités et budget)

Lignes budgétaires : nature (produits, charges, investissements), comptes (préfixes), douze mois,
activité et centre de coût facultatifs, solde résiduel des charges non couvertes. Le réalisé se
compare au budget cumulé à fin de mois, avec un statut par ligne (dépassement, au-dessus,
sous-réalisation…), une synthèse et une lecture par activité ou par centre de coût. Le budget
s'importe et s'exporte en Excel.

## Immobilisations (Comptabilité > Immobilisations)

Registre, plans d'amortissement. Les dotations échues sont comptabilisées chaque nuit.
« Sortir de l'actif » : cession (prix et acquéreur, créance 485 et produit 82x) ou mise au rebut
(prix nul) ; la valeur nette comptable est portée en 81x. Le registre s'exporte en CSV ou XLSX, avec
l'en-tête des états : société, exercice, date d'arrêté (dotations comptabilisées à ce jour) et date
d'export.

## Dette et financement (Comptabilité > Dette et financement)

Emprunts et crédits-bails, objet du financement, échéanciers, service de la dette. L'écran compare
l'encours comptable (comptes 16 et 17) au capital restant dû des échéanciers : un écart signale un
déblocage ou une échéance non comptabilisé. Il donne aussi la dette nette, le gearing (dette sur
capitaux propres), la dette rapportée à l'EBE des douze derniers mois et le DSCR, jugé contre le
minimum fixé dans les seuils (sans minimum : « seuil non fixé »). Le déblocage se comptabilise depuis
la Trésorerie (type « Déblocage d'emprunt », voir plus haut), comme les remboursements anticipés et
les intérêts hors échéancier. « Régler » est réservé à la caisse et aux comptes sans relevé : une
échéance prélevée en banque se règle depuis la ligne du relevé.

## Clôtures et contrôles (Comptabilité > Clôtures et contrôles)

Clôture mensuelle : la plateforme exécute les contrôles (équilibres, compte de passage, relevés
rapprochés et soldes des relevés égaux au solde comptable, pièces en attente, encours de dette
conforme aux échéanciers, échéances rapprochées des relevés, centres de coût imputés avec leur
activité…). Une anomalie bloquante empêche la clôture. La clôture passe ensuite, chacune une seule
fois : les dotations aux amortissements du mois, la liquidation de la TVA (pièce « TVA-mm/aaaa »
datée de la fin du mois, TVA due au 4441 ou crédit reporté au 4451), les factures à établir des
rotations validées non facturées (pièce « FAE-mm/aaaa », extournée le premier jour du mois suivant)
et, si des comptes sont en devise, la réévaluation au cours de clôture. Elle verrouille enfin les
écritures et scelle la période : l'empreinte figure sur le procès-verbal de clôture, à imprimer et
conserver hors du système ; les contrôles d'intégrité la recalculent. La réouverture est réservée et
tracée dans le registre.

Validation de la reprise (même écran) : la valeur de référence de chaque indicateur du classeur est
chargée depuis le fichier fourni à la reprise ; la plateforme recalcule les 26 indicateurs
(équilibre, produits, charges, EBITDA, résultat, trésorerie, stocks, créances et dettes dont échues,
CA et achats TTC, transport, bilan, capitaux propres) et donne l'écart de chacun. Le résultat
« n/26 », horodaté, s'imprime en annexe du procès-verbal de bascule.

## Balance et états (Comptabilité > Balance et états)

Bilan, compte de résultat et tableau des flux de trésorerie SYSCOHADA ; balance, grand livre,
rapports paramétrables, passerelle IFRS et export d'audit (SAF-T), en CSV ou XLSX. Les flux mensuels
exportés sont ceux du tableau de bord (un seul calcul), arrêtés à la date d'arrêté, avec la colonne
« Contrôle » de chaque mois (à venir, sous le seuil de sécurité, cash net négatif, conforme). L'onglet
« Consolidé du groupe » donne le compte de résultat et le bilan de chaque société, les éliminations
des opérations entre sociétés du groupe (ventes et achats réciproques, créances et dettes, comptes
courants) et le total du groupe ; il demande un compte ouvert aux deux sociétés.

## Fiscalité (Comptabilité > Fiscalité)

TVA collectée et déductible par période, préparation des déclarations à partir des écritures,
historique des déclarations. Retenues à la source : taux et comptes paramétrables, appliqués à la
saisie d'une pièce d'achat (ou par défaut depuis la fiche du fournisseur) et repris dans la
déclaration du mois. IFRS : matrice des pertes attendues par ancienneté des créances (retraitement
hors des livres SYSCOHADA) et passerelle des retraitements.
