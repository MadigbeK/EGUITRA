# Barème officiel du transport des hydrocarbures et indicateurs de flotte

25 octobre 2026. Documents remis au gérant par l'administration d'EGUITRA GROUP SARLU (gardés chez le
client, non copiés dans le dépôt) : l'arrêté A/2019/816/MH signé (PDF scanné), le tableur « Tarifs Zones
de Livraisons 2019 » de la SONAP et le modèle d'indicateurs « KPI Transport HSSE Petroleum ».

## 1. Le barème

Arrêté A/2019/816/MH du Ministère des Hydrocarbures, signé le 19 mars 2019, portant fixation de nouveaux
tarifs de transport du carburant en République de Guinée, applicable à compter du 1er avril 2019.
L'annexe a été établie par l'ONAP le 13 mars 2019 et approuvée le 14 mars. Tarifs en GNF par litre
transporté, par dépôt de chargement :

| Dépôt | Destinations |
|---|---|
| Conakry (dépôt SGP) | 116 |
| Kankan (dépôt SGP) | 51 |
| N'Zérékoré (dépôt SGP) | 19 |
| Kamsar (dépôt CBG) | 14 |

Les 200 lignes sont dans `addons/eguitra_transport/data/eguitra.transport.official.rate.csv`. La
référence (date d'effet, date de signature, autorité) est dans `data/official_scale.xml`.

### Vérification du tableur contre l'annexe signée

Les 200 tarifs ont été relus ligne à ligne sur l'annexe signée, qui fait foi. Le tableur de la SONAP
diffère sur sept tarifs ; le module prend ceux de l'annexe :

| Dépôt | N° | Destination | Tableur | Annexe signée |
|---|---|---|---|---|
| Conakry | 4 | Balandougouba | 1 253,14 | 1 252,14 |
| Conakry | 42 | Garafiri | 325,18 | 325,16 |
| Conakry | 44 | Gbenko | 1 205,72 | 1 205,70 |
| Conakry | 109 | Tougnifily | 313,45 | 213,45 |
| Kankan | 3 | Balato | 225,05 | 225,02 |
| Kankan | 27 | Komodou | 125,56 | 126,56 |
| Kankan | 36 | Mandiana | 137,34 | 131,37 |

La feuille « Distance » du tableur confirme l'annexe pour Tougnifily et pour Mandiana : ses distances y
sont dérivées des tarifs signés, pas de ceux de la feuille des tarifs. N'Zérékoré et Kamsar sont
conformes.

Noms : l'orthographe est celle de l'annexe (Balandougouba et non Balangougouba, Kondianakoro, Kaléta,
Kiniéran…). Les espaces avant les parenthèses sont rétablis et les majuscules corrigées.

Préfectures : celles de la feuille « Distance », écrites comme les préfectures de Guinée (Forécariah,
Kérouané, Boké…). Trente destinations n'en ont pas dans le tableur ; elles restent sans préfecture.

Distances : estimations du tableur, dérivées du tarif (environ tarif ÷ 1,05). Le module les signale
comme telles. Il garde les 170 distances cohérentes avec le tarif signé et écarte les deux qui ne le
sont pas :
- Kiniéro depuis Conakry : 647 km pour un tarif de 762,23 ;
- Kodiaran depuis Kankan : 125,1 km, valeur de Mandiana, pour un tarif de 92,69.

## 2. Ce que fait le module

- Référentiel « Barème officiel » (Transport > Référentiels) : destinations par dépôt, tarif par litre et
  par m³, distance estimée. Lecture pour les profils du Transport (administration, direction, finance,
  exploitation) ; modification réservée à la finance.
- Route : rattachement à une destination du barème, qui devient son tarif de référence. Le nom de la
  route suggère la destination (« Conakry - Siguiri » donne Siguiri depuis Conakry).
- Écarts : le tarif par défaut de la route, les tarifs des clients et le tarif des rotations ouvertes
  (au m³) sont comparés au tarif officiel × 1 000 L. Au-delà de l'écart toléré (Paramètres, 1 % par
  défaut), l'écart est signalé dans Routes et tarifs et par le contrôle « Tarifs proches du barème
  officiel ». Rien n'est bloqué.
- Nouvel arrêté : il se charge comme un nouveau barème, avec sa date d'effet. Une rotation prend la même
  destination dans le barème en vigueur à sa date de chargement ; les rotations passées gardent l'ancien
  tarif de référence.

## 3. Indicateurs du modèle du client

Le modèle est un gabarit vide. Sa feuille « Paramètres Objectifs » donne les objectifs et les seuils
d'alerte. Comparaison avec ce que le Transport et l'Analyse calculent déjà :

| Indicateur du modèle | Avant | Maintenant |
|---|---|---|
| Voyages réalisés, volume transporté, km, coût | Transport, Analyse | inchangé |
| Consommation L/100 km, carburant | Transport, Analyse (anomalies) | inchangé |
| Disponibilité de la flotte (objectif 90 %, alerte 85 %) | absent | Rentabilité : ensembles en service / flotte hors cédés, à ce jour |
| Utilisation de la flotte (85 %, 75 %) | Analyse, par ensemble | Rentabilité : jours en rotation / (flotte × jours de la période) |
| Taux de remplissage citerne (90 %, 80 %) | absent | Rentabilité : volume chargé / capacité des citernes |
| Respect délai livraison (95 %, 90 %) | absent | Rentabilité : retour (ou livraison) dans la durée standard de la route |
| Voyages annulés ou reportés | absent | Rentabilité : rotations annulées de la période |
| Âge de la flotte | absent | Rentabilité : âge moyen d'après l'année de fabrication |
| Taux de réalisation (planifiés / réalisés) | absent | non calculable : aucun planning des voyages |
| Temps d'attente au chargement et à la livraison, immobilisation (h) | absent | non calculable : aucune heure saisie |
| Maintenance préventive et corrective, coût, pannes | absent | non calculable : aucun suivi de maintenance |
| Accidents, incidents, near miss, déversements, OBC, GPS, IVMS, actions correctives, formations | absent | relève du futur module HSSEQ (session OTHER) |

Les objectifs et seuils du client sont repris tels quels (`FLEET_TARGETS`, models/analysis.py). Chaque
indicateur est jugé : favorable à l'objectif, en vigilance sous l'objectif, en alerte sous le seuil.

Pour la suite, ces données à saisir rendraient les autres indicateurs calculables :
- heures d'arrivée et de départ au dépôt et chez le client (temps d'attente) ;
- voyages planifiés ;
- interventions de maintenance.
