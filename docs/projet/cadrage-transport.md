# Cadrage : module « Transport et logistique » d'EGUITRA GROUP

Décision du gérant (16 octobre 2026) : créer un module de gestion du transport couvrant toutes les
activités du pôle Transport & Logistique d'EGUITRA GROUP, au-delà des rotations d'hydrocarbures.
Hors du périmètre de l'offre OTF-EGUITRA-2026-37 (« nouveau module » : évolution à chiffrer, sauf
décision contraire du gérant).

## Ce qui existe

- Module `eguitra_transport` : ensembles routiers (citernes), chauffeurs, routes et tarifs, produits
  transportés paramétrables, rotations d'hydrocarbures (chargement, livraison, volumes en m³,
  manquants tolérés et excédentaires, option des volumes à 15 °C, contrôle de la capacité), taxes
  spécifiques au barème, validation, facturation (déduction des manquants, taxes refacturées),
  créances sur les chauffeurs, rentabilité par ensemble, route, chauffeur, client et mois (coûts
  déclarés et comptabilisés, km, structure, résultat net) ; application Rotations (saisie hors réseau
  au parc).
- Axes analytiques : activité, ensemble routier, route.

## Logiciel utilisé aujourd'hui (vidéo du 13 octobre, analysée le 21 octobre)

EGUITRA pilote son transport d'hydrocarbures avec Datakö Fleet Manager, un service en ligne. Analyse
complète, comparaison avec `eguitra_transport`, reprise des données et 24 questions au client :
`docs/projet/analyse-systeme-transport-actuel.md`. Écarts principaux : camions gérés pour le compte de
propriétaires tiers (partage du résultat, relevé au propriétaire), commissions de partenaires,
coûts standard par route et gain estimé à la saisie, dossier de livraison (n° de tournée, bons de
commande), conformité des véhicules.

## Activités affichées par EGUITRA GROUP (site eguitragroup.com)

Produits miniers ; produits pétroliers ; conteneurs et transport du personnel ; location de
véhicules tout terrain ; taxi en milieu urbain et professionnel ; commerce de véhicules, citernes
et engins.

## Proposition de structure

Un module « Transport et logistique » qui généralise les rotations et partage la flotte :

1. Flotte commune : tous les véhicules (citernes, bennes, porte-conteneurs, bus, tout-terrain,
   taxis), chauffeurs, documents (assurance, visite technique) et leurs échéances.
2. Missions de transport de marchandises : une mission par voyage, avec le type de charge
   (hydrocarbures en m³, minerai en tonnes, conteneurs à l'unité), le client, la route, le tarif,
   les quantités chargées et livrées, les écarts ; validation et facturation, comme les rotations.
3. Transport du personnel : contrats clients (circuit, véhicule, forfait mensuel ou par trajet),
   facturation périodique.
4. Location de véhicules : contrats (véhicule, période, tarif jour ou mois, avec ou sans
   chauffeur, caution), état de départ et de retour, facturation.
5. Taxi : recettes journalières par véhicule et par chauffeur (versement), dépenses courantes.
6. Rentabilité par véhicule, activité, client et route ; tableau de bord du pôle.

Le carburant et l'entretien (note du DG) se rattachent naturellement à la flotte commune : à
décider avec ce module ou dans un module « Parc » distinct.

## Questions au client

1. Quelles activités entrent dans le module, et dans quel ordre de priorité ?
2. Pour chaque activité : unité de facturation, tarifs (par client, par route, par période) et
   pièces émises (bons de livraison, lettres de voiture, contrats).
3. Saisie : par les chauffeurs sur téléphone (comme Rotations), par le parc ou par le bureau ?
4. Carburant et entretien : dans ce module ou à part ?
5. Volumes : nombre de véhicules par activité, de missions par mois.

Pièces à fournir : grilles tarifaires, exemples de bons et de factures, contrats de location et de
transport du personnel, liste de la flotte.

## Transport pétrolier : volumes, taxes et rentabilité (attente du courrier du responsable financier)

Le courrier demande le « suivi des coûts et de la rentabilité par trajet/véhicule pour l'activité
transport pétrolier, incluant la gestion des volumes et des taxes spécifiques ». La plateforme le
couvre (module `eguitra_transport` 19.0.1.1.0) ; les valeurs ci-dessous sont paramétrables dans
Finance > Transport > Paramètres et doivent venir du client. Valeurs livrées par défaut, à
confirmer : tolérance de manquant 0,5 % du volume chargé, manquant hors tolérance « constat
seulement », pas de correction à 15 °C, aucun prix de valorisation, aucune taxe au barème.

### Manquants et volumes

6. Tolérances contractuelles de manquant : quel pourcentage du volume chargé, par client (et par
   produit ou par route s'il y a lieu) ? Les contrats ou cahiers des charges des distributeurs sont
   à fournir.
7. Au-delà de la tolérance, qui supporte le manquant : le client le déduit-il de notre facture, le
   réclame-t-il par une note de débit, est-il retenu au chauffeur (sur salaire, sur frais de
   mission) ? Les chauffeurs sont-ils salariés (compte 421) ou prestataires ?
8. Base de valorisation du manquant : prix de cession du dépôt, prix à la pompe, prix fixé au
   contrat ? Hors taxes ou toutes taxes ? Le prix change-t-il en cours d'année (date d'effet) ?
9. La déduction sur notre facture porte-t-elle la TVA ? Sur quel compte la comptabiliser (6588,
   réduction du chiffre d'affaires) ?
10. Les manquants se constatent-ils sur les volumes ambiants ou ramenés à 15 °C ? Les bons du dépôt
    (SGP ou autre) donnent-ils les températures, la masse volumique et le coefficient de correction ?
    Un exemple de bon de chargement et de livraison est à fournir.
11. La facturation du transport se fait-elle sur le volume livré, le volume chargé, ou le volume à
    15 °C ?
12. Capacité des citernes : jauge officielle de chaque compartiment (certificats de jaugeage) ?

### Taxes spécifiques

13. Liste des taxes et redevances payées par rotation : nature (taxe de roulage, taxes communales ou
    préfectorales, pesage, laissez-passer, redevances pétrolières, douane), base (par m³ livré ou
    chargé, en % du montant facturé, forfait par voyage), taux, routes et produits concernés, date
    d'effet des taux en vigueur.
14. Lesquelles sont refacturées aux clients, avec ou sans TVA, et sur quelle ligne de la facture ?
15. Comment sont-elles payées et justifiées (caisse du chauffeur, virement, quittance) ? Sur quels
    comptes de charge l'expert-comptable veut-il les voir (64x, 63x) ?
16. Le classeur 2026 porte-t-il un total des taxes par rotation (repris comme forfait) ou le détail
    par taxe ?

### Rentabilité

17. Les factures de carburant, de pneumatiques et d'entretien peuvent-elles être imputées par
    ensemble routier (et par route) dès la saisie ? C'est la condition des « coûts comptabilisés »
    par véhicule.
18. Kilométrage : aller-retour standard et durée de chaque route ; relevé du compteur par rotation
    souhaité ?
19. Charges de structure : la répartition au km parcouru convient-elle, ou une autre clé (rotations,
    volume, chiffre d'affaires) ? Quelles charges du siège imputer au transport ?
20. Fiches d'immobilisation des tracteurs et citernes (valeur, date de mise en service, durée) pour
    rattacher les dotations à chaque ensemble.
