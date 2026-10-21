# Le logiciel de transport utilisé aujourd'hui par EGUITRA GROUP : analyse et comparaison

Source : vidéo de présentation du logiciel reçue le 21 octobre 2026 (enregistrement du 13 octobre,
43 minutes, commentée oralement pendant la première minute seulement). Elle a été analysée image par
image (435 images distinctes), écran par écran, et les formules ont été vérifiées en rapprochant les
chiffres affichés d'un écran à l'autre.

Ce document ne contient aucune donnée du client : ni montant, ni nom de personne, de client ou de
propriétaire, ni immatriculation, ni taux de commission. La vidéo, les images, la transcription et les
notes détaillées restent hors du dépôt.

## 1. En bref

- Le logiciel est **Datakö Fleet Manager** (version 1.0), un service en ligne de l'éditeur Datakö
  (formule « Business » : modules Transport, ERP, Assistant IA, Alertes, WhatsApp). EGUITRA l'utilise
  pour le transport d'hydrocarbures : 5 camions-citernes, 8 conducteurs, un dépôt de départ, 13 routes,
  environ 45 rotations numérotées en 2026, un historique de six mois (mai à octobre 2026).
- C'est un outil de **pilotage de flotte**, pas un outil de gestion : le chiffre d'affaires et les
  coûts y sont **théoriques** (tarif de la route, forfaits de route, carburant au prix officiel du
  mois), il n'émet pas de facture, il ne tient pas de comptabilité, et l'encaissement se coche à la
  main, livraison par livraison.
- Il apporte trois choses que notre module transport ne fait pas encore : les **camions gérés pour
  le compte de propriétaires tiers** (partage du résultat, relevé mensuel au propriétaire), les
  **commissions** versées à un partenaire en pourcentage du chiffre d'affaires, et un **dossier de
  livraison** (n° de BL, n° de tournée du client, bons de commande) avec un état « complet ou
  incomplet ».
- Notre plateforme va plus loin sur tout le reste : facture réelle (une par client, plusieurs
  rotations), comptabilité et créances, coûts réels comptabilisés à côté des coûts déclarés, tolérance
  de manquant et valorisation au prix du produit, volumes à 15 °C, taxes spécifiques au barème,
  créance sur le chauffeur, saisie hors réseau au parc, analyses statistiques.
- Pour la reprise, l'export Excel de Datakö est insuffisant (21 colonnes, tarif arrondi, dates en
  texte, ni conducteur ni coûts ni encaissements) : il faut demander à Datakö un export complet.
- Écart de volume à expliquer : l'offre cite 383 rotations en 2026 (classeur arrêté au 15 août) ;
  Datakö n'en numérote qu'une quarantaine. La source de la reprise doit être tranchée.

## 2. Le logiciel

- Application web hébergée par l'éditeur, thème sombre, en français (quelques libellés restés en
  anglais : mois de l'écran « Répartition acteurs », types « owned » et « managed »).
- Rôles : administrateur (tout), opérateur (saisit les rotations), lecteur (consultation). Équipe de
  5 comptes actifs sur 7 autorisés. Un accès séparé est prévu pour les propriétaires de camions.
- Le compteur « 5 / 5 véhicules » de la flotte ressemble à une limite de la formule : la flotte réelle
  est peut-être plus grande que celle saisie.
- Menus :
  - Opérations : Vue d'ensemble, Nouvelle rotation, Livraisons, Flotte, Clients ;
  - Performance : Gains, Profit par camion, Cashflow ;
  - Investissement : Simulation transport, Répartition acteurs ;
  - Configuration : Acteurs, Routes, Tarifs de transport, Charges fixes, Conducteurs, Équipe,
    WhatsApp, Entreprise (dont l'identité visuelle des documents PDF).
- Un sélecteur de période (mois, trimestre, six mois, tout) filtre tous les écrans ; un guide rapide
  intégré explique chaque écran.
- Fragilités constatées : une erreur au premier chargement des routes ; des chiffres qui ne
  respectent pas la période choisie (classement des clients cumulé) ; un résumé des commissions qui
  additionne des taux de véhicules différents.

## 3. Comment il fonctionne

### 3.1 Rotation et livraison

Une rotation (un voyage) est une livraison : même numéro (`TR-AAAA-NNNN`, préfixe paramétrable).

1. **Saisie** (« Nouvelle rotation ») : camion-citerne, date de chargement (elle fixe la période
   d'analyse), tracteur s'il diffère de celui de la citerne, site de livraison en texte libre
   (plusieurs sites séparés par des virgules), client (prérempli avec le client par défaut),
   conducteur facultatif, produit (gasoil, essence, mazout ; citerne mixte possible), dépôt,
   destination (le tarif et la distance en découlent), volume chargé en litres. Le « gain estimé »
   s'affiche avant l'enregistrement.
2. **En cours** : la livraison peut être validée (double coche) ou annulée (avec un motif).
3. **Livrée** : saisie du volume livré et de la date ; le manquant en découle. La validation est
   tracée (auteur, date, motif « Validation livraison », source « Application web »).
4. **Facturation** : un simple état « À facturer » puis « Facturée » ; aucune facture n'est produite
   dans la vidéo, aucune livraison n'est « Facturée ».
5. **Encaissement** : par livraison, état « En attente », date et référence (chèque, virement)
   saisies dans la fiche ; un seuil de jours paramétrable déclenche les retards de paiement.
6. **Dossier de livraison** : n° de BL, n° de tournée du client, bons de commande (plusieurs) ; état
   « Incomplet » tant qu'une pièce manque (toutes les livraisons de la vidéo sont incomplètes : le n° de
   BL n'est jamais saisi).

La fiche d'une livraison regroupe : chiffre d'affaires, coûts de la livraison, trajet et produit,
impact du manquant, camion et client, encaissement, traçabilité, historique (rotation créée,
chargement effectué, livraison finalisée), dossier, et une « zone sensible » pour supprimer la
livraison (suppression logique : un filtre montre les livraisons supprimées). La date de chargement
ne se corrige que par une action dédiée.

Validation par le client : chaque client a un « mode de validation des livraisons » (par l'opérateur
seul, ou par l'opérateur et le destinataire). Le moyen de confirmation du destinataire n'est pas
montré ; l'export prévoit une colonne « Confirmation destinataire », vide.

### 3.2 Chiffre d'affaires et manquant

- Tarif en **GNF par litre**, par couple dépôt et destination : un barème national préchargé par
  l'éditeur (« tarifs de péréquation ») et, au besoin, un tarif contractuel, éventuellement propre à
  un client. Tous les tarifs contractuels vus sont égaux au barème national.
- **Chiffre d'affaires = volume livré × tarif**. Pour une rotation en cours : volume chargé × tarif
  (provisoire).
- **Manquant = volume chargé − volume livré**, sans tolérance. Sa seule conséquence est le fret perdu
  (manquant × tarif de transport), affiché comme « impact du manquant » et totalisé en « gain perdu ».
  Ni valorisation au prix du produit, ni créance sur le chauffeur, ni correction à 15 °C.

### 3.3 Coûts : des forfaits, pas des dépenses

- **Coûts variables d'une livraison** = carburant + prime chauffeur + péages, tous tirés des
  paramètres de la route (frais de chargement prévus, toujours à zéro).
- **Carburant** = consommation forfaitaire de la route (en litres) × prix à la pompe publié chaque
  mois (structure des prix des produits pétroliers), appliqué automatiquement. Le carburant d'une
  rotation passée est donc recalculé à chaque changement de prix. Les consommations par route sont
  saisies à la main et hétérogènes (de 0,26 à 2,1 litre par km ; distances manquantes sur 5 routes).
- **Charges fixes** : un écran mensuel de charges « mutualisées », réparties à parts égales sur les
  camions en exploitation (vide en octobre) ; et, par véhicule, des charges mensuelles (entretien
  forfaitaire, géolocalisation, caméra, assurance, vignettes, visite technique), souvent un coût
  annuel divisé par 12.
- **Marge d'exploitation** d'un véhicule = chiffre d'affaires − coûts variables − charges fixes du
  véhicule. Classement : rentable au-dessus de 5 %, faible entre 0 et 5 %, déficitaire en dessous.

### 3.4 Propriétaires, commissions et « cash réel »

C'est le cœur du logiciel et ce qui le distingue.

- Les véhicules sont **propres** (à EGUITRA), **gérés** (à un propriétaire tiers, exploités par
  EGUITRA) ou **partenaires** (aucun aujourd'hui).
- Les **acteurs** sont les propriétaires, les banques, les investisseurs et les autres bénéficiaires.
  Des **règles de répartition** fixent, par véhicule ou par type de véhicule, des commissions en
  pourcentage du chiffre d'affaires brut.
- Pour chaque véhicule et chaque mois : résultat à répartir = marge d'exploitation ; les commissions
  sont dues même si la marge est négative ; le propriétaire reçoit le **résiduel**, même négatif.
  Aujourd'hui : un partenaire perçoit une commission sur un camion propre ; EGUITRA retient une part
  du chiffre d'affaires des camions gérés ; les propriétaires des deux camions gérés supportent seuls
  les charges fixes de leur camion quand il ne roule pas.
- **Bilan propriétaire** : relevé PDF de deux pages par camion géré et par période (activité, revenus,
  charges variables et fixes, compte d'exploitation, répartition propriétaire et exploitant,
  historique des rotations), ou export Excel ; envoi par courriel au propriétaire prévu.
- **Cash réel d'EGUITRA** = marge de ses camions propres − commissions qu'elle verse (− crédit-bail
  en cours). Les pertes des camions gérés ne le réduisent pas.
- **Crédit-bail** : contrat (banque, mensualité, durée, début), progression du remboursement, alerte
  sur le gain de trésorerie à la fin des mensualités. Le seul contrat saisi (36 mois) est terminé.

### 3.5 Simulation et tableaux de bord

- **Simulation transport** : tarif au litre, volume par livraison, livraisons par mois, charges fixes
  et variables, investissement, mensualité de crédit-bail, commissions ; il calcule le résultat net du
  propriétaire, le retour sur investissement en mois et le **point mort en nombre de livraisons**, avec
  la courbe du résultat selon le nombre de livraisons. Rien n'est enregistré.
- Tableaux : vue d'ensemble (chiffre d'affaires, marge, flotte active, livraisons, crédit-bail, cash
  net réel), gains par rotation (jour, mois, moyenne, gain perdu sur les manquants), profit par camion,
  cashflow (commissions, coûts, résultat des propriétaires, décomposition carburant, charges fixes,
  entretien, remboursement de prêt), performance par client (chiffre d'affaires, impayés).
- **WhatsApp** : le directeur général reçoit des indicateurs à la demande (gains du jour, de la
  semaine, état de la flotte) ; le chef logistique valide ou annule les livraisons en cours par
  message. Un seul numéro est inscrit.
- **Assistant IA** : 20 questions par jour.

### 3.6 Exports

- Livraisons : classeur Excel d'une feuille, 21 colonnes (dossier, date de chargement, client,
  camion, n° de rotation, n° de BL, n° de tournée, produit, dépôt, ville, site, quantités chargée,
  livrée et manquante, chiffre d'affaires, tarif, statut, confirmation du destinataire, date de
  livraison, encaissement, motif d'annulation). Défauts : dates en texte (« 10 oct. 2026 »), tarif
  arrondi au franc (les décimales du tarif sont perdues), aucun conducteur, aucun coût, aucune marge,
  aucun tracteur, aucun bon de commande, ni date ni référence d'encaissement, ni état de facturation.
- Flotte, gains, profit par camion : bouton « Exporter » (contenu non montré).
- Bilan propriétaire : PDF et Excel.

## 4. Comparaison avec NIMOVA Transport (`eguitra_transport`)

| Fonction | Datakö | NIMOVA aujourd'hui | Suite à donner |
|---|---|---|---|
| Unité de volume | litre | m³ (trois décimales, soit le litre) | Conversion à la reprise ; afficher aussi les litres à la saisie si le parc le souhaite |
| Tarif | GNF/L par dépôt et destination, barème national et tarif contractuel | GNF/m³ par route, tarif par client et par produit | Équivalent (× 1 000) ; reprendre les tarifs à deux décimales depuis l'écran des tarifs, pas depuis l'export |
| Chiffre d'affaires | livré × tarif | livré (à défaut chargé) × tarif | Identique |
| Manquant | fret perdu, sans tolérance | tolérance, excédent valorisé au prix du produit, déduit de la facture ou réclamé au chauffeur, ou constat seulement ; volumes à 15 °C en option | Régler NIMOVA sur « constat seulement » reproduit Datakö ; la pratique réelle reste à confirmer (questions 1 à 3) |
| Coûts | forfaits de route, carburant au prix du mois | coûts déclarés sur la rotation, coûts réels comptabilisés par ensemble et par route, écart entre les deux | Ajouter des **coûts standard par route** pour le gain estimé à la saisie (voir 5.2) |
| Taxes spécifiques | aucune (péages seulement) | barème, assiette, refacturation | Avantage NIMOVA |
| Charges fixes | saisies par mois, parts égales | comptabilité imputée par ensemble, répartition des charges de structure | Avantage NIMOVA (charges réelles) ; prévoir la vue mensuelle par véhicule |
| Camions de tiers, commissions, relevé propriétaire | oui | non | **Écart principal** (voir 5.1) |
| Facture | état coché, pas de pièce | facture réelle par client, plusieurs rotations, taxes refacturées, manquants déduits | Avantage NIMOVA |
| Encaissement | coché par livraison | règlements et lettrage comptables, relances, délais réels | Avantage NIMOVA ; montrer l'état de paiement sur chaque rotation |
| Dossier de livraison | n° de BL, n° de tournée, bons de commande, état complet | bon de livraison seul | Ajouter n° de tournée, bons de commande, pièces jointes et état (voir 5.3) |
| Validation par le destinataire | prévue, non utilisée | non | À décider (portail client ou code de confirmation) |
| Conformité des véhicules | drapeau « Non conforme » | permis du chauffeur seulement | Documents et échéances du véhicule (voir 5.4) |
| Tracteur et citerne | citerne de référence, tracteur modifiable par rotation | ensemble routier (tracteur et citerne) | Permettre un autre tracteur sur une rotation |
| Saisie | bureau, WhatsApp | bureau, application Rotations hors réseau | Avantage NIMOVA ; WhatsApp à discuter |
| Crédit-bail | suivi simple | emprunts et crédits-bails comptables, échéancier, rapprochement bancaire | Avantage NIMOVA |
| Simulateur | investissement par camion, point mort en livraisons | simulateur de l'atterrissage, tarif de point mort par route (Analyse) | Ajouter la simulation d'investissement d'un camion (voir 5.5) |
| Analyses | tableaux mensuels | NIMOVA · Analyse (prévisions, constats, contrôles) | Avantage NIMOVA |
| Numérotation | `TR-AAAA-NNNN` | `ROT/AAAA/NNNNN` | Garder le numéro Datakö en référence des rotations reprises |
| Traçabilité | création, modification, motif | journal d'audit du noyau | Équivalent |

## 5. Écarts à combler

Proposition par ordre de priorité. Le cadrage du module « Transport et logistique » (16 octobre) est
hors du périmètre de l'offre sauf décision du gérant ; les points 5.1 à 5.3 relèvent en revanche du
« suivi des coûts et de la rentabilité par trajet et par véhicule » demandé par le responsable
financier et entrent dans l'esprit de l'offre.

### 5.1 Camions gérés pour le compte de tiers (priorité haute)

- Propriétaire sur l'ensemble routier : EGUITRA ou un tiers (fiche de tiers).
- Règles de répartition datées, par véhicule ou par catégorie : bénéficiaire, base (chiffre d'affaires
  brut, marge), taux ; le propriétaire reçoit le résiduel.
- Relevé mensuel au propriétaire (PDF et Excel, envoi par courriel), à partir des coûts **réels**
  imputés au véhicule, et non de forfaits.
- Comptabilité, à valider avec l'expert-comptable : le chiffre d'affaires d'un camion géré est-il
  celui d'EGUITRA (mandataire ou commissionnaire) ? La part du propriétaire devient une dette envers
  lui (compte de tiers), réglée par la trésorerie ; un résiduel négatif devient une créance.
- Commissions des partenaires : charge à payer, au taux de la règle, sur la période.

### 5.2 Coûts standard par route et gain estimé (priorité haute)

- Sur la route : consommation de référence (litres par voyage aller-retour), prime du chauffeur,
  péages, frais de chargement ; prix du carburant par mois (prix officiel, ou prix d'achat réel).
- À la saisie de la rotation : gain estimé immédiat. Le carburant standard est **figé** sur la
  rotation (pas de recalcul rétroactif, contrairement à Datakö).
- Dans la rentabilité : standard, déclaré et comptabilisé côte à côte ; une consommation anormale
  devient un constat d'Analyse.

### 5.3 Dossier de livraison (priorité moyenne)

- N° de tournée du client, bons de commande multiples, pièces jointes (BL signé, bon de chargement).
- État « complet » calculé selon les pièces exigées par client ; facturation bloquée ou signalée tant
  que le dossier est incomplet (au choix du client).

### 5.4 Documents et conformité des véhicules (priorité moyenne)

- Assurance, visite technique, vignette, jaugeage, autorisation de transport : dates d'échéance,
  pièces, alertes avant expiration ; état « conforme » de l'ensemble routier. Prévu dans la « flotte
  commune » du cadrage.

### 5.5 Simulation d'investissement (priorité basse)

- Dans Analyse, écran Flotte et routes : un camion de plus (prix, financement, tarif, volume,
  rotations par mois, commissions) donne le résultat mensuel, le retour sur investissement et le point
  mort en nombre de rotations, à partir des coûts réels observés de la flotte.

### 5.6 Hors du transport pétrolier, à discuter

- Indicateurs et validation par WhatsApp : faisable par une passerelle de messagerie (coût d'envoi,
  numéro professionnel) ; à mettre en regard de l'application Rotations et des notifications.
- Accès des propriétaires à leurs relevés : un espace du portail, en lecture seule.

## 6. Reprise des données

Sources, par ordre de préférence :

1. **Export complet demandé à Datakö** (toutes les tables : rotations, livraisons, tarifs à deux
   décimales, routes, conducteurs, véhicules, acteurs, règles, charges, encaissements). Le service
   repose sur une base de données hébergée : l'export est techniquement simple ; le contrat
   d'abonnement doit le prévoir.
2. À défaut, l'export Excel des livraisons, période par période, complété par l'écran des tarifs
   (décimales) et la saisie manuelle des conducteurs, des coûts de route et des encaissements.
3. Le classeur 2026 pour la période antérieure à mai 2026, en veillant à ne pas compter deux fois la
   période commune.

Correspondances :

| Datakö | NIMOVA | Traitement |
|---|---|---|
| Camion-citerne + tracteur | Ensemble routier (citerne, tracteur) | Une fiche par ensemble ; propriétaire à renseigner (5.1) |
| Conducteur | Chauffeur | Compléter téléphone, permis et validité (deux téléphones sur huit seulement) |
| Dépôt → destination, ville | Route (départ, arrivée) | Une route par destination ; ville en référence ; corriger les distances manquantes et à 12 décimales |
| Tarif (GNF/L) | Tarif par m³ du client | × 1 000 ; deux décimales du tarif conservées |
| Site de livraison (texte libre) | Observation, puis référentiel de sites | Normaliser les graphies (« SIGLE/Ville », « SIGLE Ville ») |
| Qté chargée et livrée (L) | Volume chargé et livré (m³) | ÷ 1 000 |
| Produit | Produit transporté | Gasoil seul dans la vidéo |
| N° de rotation `TR-…` | Référence d'origine de la rotation | Conserver pour les rapprochements |
| N° de BL, n° de tournée, bons de commande | Bon de livraison (+ 5.3) | Le n° de BL est vide partout |
| Livré, en cours, annulé | Validée, saisie, annulée | Les « supprimées » ne se reprennent pas |
| À facturer, facturée | Validée, facturée | La facture réelle est émise ailleurs : rapprocher avec la comptabilité reprise |
| Encaissement | Règlement comptable | Ne pas reprendre l'état coché ; le solde client vient de la comptabilité |
| Carburant, prime, péages (forfaits) | Coûts déclarés de la rotation | Reprendre la valeur **historique** si l'export la donne, sinon recalculer au prix du mois de la rotation, pas au prix du jour |
| Charges fixes par véhicule | Comptabilité (achats imputés au véhicule) | Ne pas reprendre comme coût : ce sont des estimations |

Contrôles après reprise : nombre de rotations et volumes par mois identiques à Datakö ; chiffre
d'affaires recalculé à moins d'un franc par rotation (écarts dus à l'arrondi du tarif dans l'export) ;
manquants identiques ; rotations sans client (deux sur quatre en octobre) traitées une à une.

## 7. Paramétrage de NIMOVA déduit de la vidéo (à confirmer)

- Règle du manquant : « constat seulement », facturation sur le livré (pratique actuelle observée).
  La tolérance n'a alors aucun effet financier : la laisser à 0,5 % pour classer les manquants.
- Volumes ambiants (pas de correction à 15 °C dans la pratique actuelle).
- Pas de taxe au barème tant que la liste des taxes n'est pas fournie.
- Activité analytique « Transport » sur les rotations ; une route par destination desservie.

## 8. Questions au client

Regroupées et dédoublonnées ; elles complètent celles de `cadrage-transport.md`.

**Manquants et facturation**

1. Le client déduit-il seulement le fret du volume non livré (comme le calcule Datakö), ou aussi la
   valeur du produit au-delà d'une tolérance ? Une retenue est-elle faite au chauffeur ?
2. Quelle date fait foi pour le mois : chargement ou livraison ? (Datakö dit chargement mais montre
   en octobre des rotations chargées en septembre.)
3. Où et comment les factures sont-elles émises aujourd'hui (logiciel, Excel, comptabilité) : une
   facture par rotation, ou un relevé par client et par mois ? Le n° de tournée et les bons de
   commande sont-ils exigés pour facturer ?
4. Un règlement du client couvre-t-il plusieurs rotations ? Y a-t-il des paiements partiels ?
5. Le barème national (« tarifs de péréquation ») : source, date d'effet, mise à jour ? Existe-t-il de
   vrais tarifs négociés par client ? Les deux décimales du tarif au litre sont-elles contractuelles ?
6. Quelles pièces rendent un dossier de livraison « complet » ? Le n° de BL est-il celui du dépôt ou
   du client ?

**Camions gérés, partenaires et commissions**

7. Combien de camions appartiennent à des tiers, aujourd'hui et demain ? Quel contrat avec chaque
   propriétaire (part retenue par EGUITRA, base de calcul, charges à sa charge) ?
8. Comment le propriétaire est-il payé (reversement mensuel, relevé) ? Comment un résiduel négatif
   est-il réglé (remboursement, report sur le mois suivant) ?
9. Le partenaire commissionné sur un camion propre : nature (apporteur d'affaires, associé,
   financeur), base contractuelle, véhicules concernés, mode de règlement ? Facture-t-il sa
   commission ?
10. Que recouvre la catégorie « Partenaires » (sous-traitants dont les camions roulent pour EGUITRA) ?
11. L'expert-comptable : le chiffre d'affaires des camions gérés est-il celui d'EGUITRA ou celui du
    propriétaire (EGUITRA ne facturant alors que sa commission) ?

**Coûts et flotte**

12. Les forfaits de route (consommation, prime chauffeur, péages) : base aller simple ou aller-retour ?
    Qui les a fixés ? Les dépenses réelles de carburant, de primes et de péages sont-elles suivies
    ailleurs ?
13. EGUITRA achète-t-il le carburant au prix officiel ou à un prix négocié ?
14. Les charges fixes par véhicule (assurance, vignettes, géolocalisation, caméra, visite technique,
    entretien forfaitaire) sont-elles des budgets ou des dépenses réelles ? L'entretien réel est-il
    suivi quelque part ?
15. « Non conforme » sur les cinq véhicules : de quelle conformité s'agit-il ? Les échéances des
    documents sont-elles connues ?
16. La flotte compte-t-elle d'autres véhicules que les cinq saisis (limite de la formule) ?
17. Les tracteurs changent-ils souvent de citerne ?
18. D'autres financements (crédit-bail, emprunts) sont-ils en cours ou prévus ?

**Usage et reprise**

19. Qui saisit les rotations aujourd'hui, et qui valide les livraisons ? Le WhatsApp est-il utilisé
    (validation par le chef logistique, indicateurs du DG) et souhaité dans NIMOVA ?
20. La validation par le destinataire est-elle souhaitée ? Par quel moyen (portail, code, signature) ?
21. Depuis quand Datakö est-il utilisé, et sur quels camions ? Pourquoi environ 45 rotations en 2026
    dans Datakö contre 383 dans le classeur cité par l'offre ? Quelle source fait foi pour la reprise ?
22. EGUITRA peut-il obtenir de Datakö un export complet des données, et à quelle date l'abonnement
    prend-il fin ? Le module « Distribution » de Datakö (RCCM et NIF y sont tenus) est-il aussi
    utilisé ?
23. Deux rotations d'octobre n'ont pas de client rattaché : erreur de saisie à corriger avant reprise ?
24. Autres produits transportés que le gasoil (essence, mazout, jet) ?

## 9. Glossaire

| Datakö | NIMOVA |
|---|---|
| Rotation, livraison | Rotation |
| Camion-citerne (+ tracteur) | Ensemble routier |
| Conducteur | Chauffeur |
| Dépôt origine → destination | Route |
| Tarif national, tarif contractuel (GNF/L) | Tarif de la route, tarif du client (GNF/m³) |
| Manquant, écart livraison | Manquant (toléré, excédentaire) |
| Paramètre de route (carburant, prime, péages) | Coûts déclarés (et coûts standard, 5.2) |
| Charges fixes véhicule | Coûts comptabilisés de l'ensemble |
| Propre, géré, partenaire | Propriétaire de l'ensemble (5.1) |
| Acteur, règle de répartition, commission, résiduel | Bénéficiaire, règle de répartition (5.1) |
| Bilan propriétaire | Relevé du propriétaire (5.1) |
| Dossier de livraison | Pièces de la rotation (5.3) |
| À facturer, facturée | Validée, facturée |
| Encaissement | Règlement, lettrage |
| Cash net réel | Trésorerie (Finance), prévision (Analyse) |
| Simulation transport | Simulateur (Analyse, 5.5) |
