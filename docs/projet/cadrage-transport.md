# Cadrage : module « Transport et logistique » d'EGUITRA GROUP

Décision du gérant (16 octobre 2026) : créer un module de gestion du transport couvrant toutes les
activités du pôle Transport & Logistique d'EGUITRA GROUP, au-delà des rotations d'hydrocarbures.
Hors du périmètre de l'offre OTF-EGUITRA-2026-37 (« nouveau module » : évolution à chiffrer, sauf
décision contraire du gérant).

## Ce qui existe

- Module `eguitra_transport` : ensembles routiers (citernes), chauffeurs, routes et tarifs, rotations
  d'hydrocarbures (chargement, livraison, volumes en m³, écarts), validation, facturation, rentabilité
  par ensemble, route, client et mois ; application Rotations (saisie hors réseau au parc).
- Axes analytiques : activité, ensemble routier, route.

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
