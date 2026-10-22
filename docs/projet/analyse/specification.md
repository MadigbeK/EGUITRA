# NIMOVA · Analyse : spécification

Demande du gérant (17 octobre 2026, carte blanche) : un module d'analyse de données de niveau
expert, « ultra premium », extrêmement utile, **différent selon la société sélectionnée** (EGUITRA
GROUP SARLU ou MB AxisPro), avec l'accent sur la pertinence des informations, le design et
des visuels d'exception. Ce document fixe l'architecture et le contrat entre le noyau et
l'application web ; les agents le suivent à la lettre (noms de routes, de clés et d'unités).

## 1. Principes

1. **Une décision par écran.** Chaque section répond à une question du dirigeant ; elle commence par
   la réponse (chiffre et verdict), puis montre l'évidence (graphique), puis le détail (table).
2. **Des faits, pas des tableaux de bord décoratifs.** Chaque indicateur porte sa définition, sa
   période, sa comparaison (N-1, budget, cible) et sa fiabilité (`confidence`, nombre de points).
3. **Intelligence explicable.** Les « constats » (insights) sont produits par des règles et des
   méthodes statistiques documentées (régression, lissage de Holt-Winters, score robuste, loi de
   Benford, Pareto, HHI, Monte-Carlo). Chaque constat dit pourquoi il apparaît, ce qu'il pèse en GNF
   quand c'est mesurable, et quoi faire ; jamais de boîte noire.
4. **Calcul au noyau, sous l'identité de l'utilisateur.** Le navigateur ne reçoit que des agrégats ;
   le cloisonnement par société est celui du reste de la plateforme. Python pur (bibliothèque
   standard : `statistics`, `math`, `random` à graine fixe) : aucune dépendance nouvelle au noyau.
5. **Lecture seule.** Le module n'écrit rien dans la comptabilité.
6. **Français, montants en GNF hors taxes sauf mention TTC**, dates ISO (AAAA-MM-JJ) dans l'API.

## 2. Architecture

- Module Odoo `addons/eguitra_analytics` (« EGUITRA - Analyse ») ; dépend de `eguitra_finance`,
  `eguitra_transport`, `eguitra_chantier`, `eguitra_immobilier`, `eguitra_axispro`.
  - `engine/` : méthodes statistiques pures, sans Odoo (testées seules).
    - `stats.py` : moyenne, médiane, quantiles, écart-type, MAD, score robuste
      (0,6745 × (x − médiane) / MAD), régression linéaire (pente, ordonnée, R², erreur type),
      corrélation, CAGR, variation, HHI, Gini et courbe de Lorenz, Pareto (part cumulée, rang 80 %).
    - `forecast.py` : lissage exponentiel simple et Holt (tendance), Holt-Winters additif (saisonnalité
      12 quand au moins 24 points, sinon Holt), intervalles par résidus, Monte-Carlo à graine fixe
      (probabilité d'atteindre une cible), détection de rupture CUSUM.
    - `benford.py` : premier chiffre (et deux premiers chiffres), khi-deux, MAD de Nigrini et niveau de
      conformité (« conformité proche », « acceptable », « marginale », « non-conformité »).
    - `insights.py` : structure d'un constat, score d'impact, tri, phrases françaises.
  - `models/groupe.py` : `eguitra.analytics.groupe` (AbstractModel), une méthode par section.
  - `models/cabinet.py` : `eguitra.analytics.cabinet` (AbstractModel), une méthode par section.
  - `controllers/analyse.py` : routes `/api/v1/analyse/...` (décorateur `api_route` d'`eguitra_api`).
  - `tests/` : `test_engine.py`, `test_groupe.py`, `test_cabinet.py`.
- Organisation (`addons/eguitra_api/organisation.py`, `apps/web/lib/config.ts`) : nouvelle
  application `analyse` (« NIMOVA · Analyse »), servant les deux sociétés ; profils `admin`,
  `direction`, `finance`, `cabinet`. Routes `/analyse/groupe/` réservées à EGUITRA GROUP,
  `/analyse/cabinet/` à MB AxisPro (MODULE_ENTITY) ; `/analyse/contexte` pour les deux.
- Droits des routes : groupe → `admin`, `direction`, `finance` ; cabinet → `admin`, `direction`,
  `cabinet` (et `finance` pour la section « Activité et honoraires »).
- Application web : espace `/analyse` (`apps/web/app/analyse/...`), navigation selon la société de
  travail : sections du groupe ou du cabinet ; le sélecteur de société de l'en-tête bascule de l'une
  à l'autre (un compte ouvert aux deux sociétés voit les deux mondes).

## 3. Paramètres communs

Toutes les routes de section acceptent :

- `date_to` (AAAA-MM-JJ, défaut : aujourd'hui) : date d'arrêté ;
- `period` : `ytd` (début d'exercice à date_to, défaut), `12m` (12 mois glissants), `q` (trimestre en
  cours), `m` (mois en cours), `custom` avec `date_from`.

Toutes les réponses de section ont l'enveloppe :

```json
{
  "entity": "groupe",
  "company": {"id": 1, "name": "EGUITRA GROUP SARLU", "currency": "GNF"},
  "period": {"code": "ytd", "date_from": "2026-01-01", "date_to": "2026-08-15", "label": "Exercice 2026 au 15/08/2026",
             "previous": {"date_from": "2025-01-01", "date_to": "2025-08-15"}},
  "generated_at": "2026-10-18T09:12:03Z",
  "quality": {"score": 92, "notes": ["3 écritures sans imputation analytique"]},
  "insights": [ /* constats de la section, voir 4 */ ],
  "...": "blocs propres à la section"
}
```

Séries mensuelles : `{"months": ["2026-01", ...], "series": [{"key": "revenue", "label": "Chiffre d'affaires", "unit": "gnf", "values": [..]}]}`.
Unités : `gnf`, `pct` (valeur en pourcentage, 12,5 = 12,5 %), `days`, `count`, `ratio`, `km`,
`liters`, `hours`, `score` (0-100).

KPI : `{"key", "label", "value", "unit", "previous", "target", "delta_pct", "trend": [12 valeurs],
"status": "good|warn|bad|neutral", "definition": "phrase", "inverse": false}` (`inverse` : une
baisse est favorable).

## 4. Constats (insights)

```json
{
  "id": "transport.route_marge_negative.RT-05",
  "domain": "transport",
  "severity": "critical|high|medium|info|positive",
  "title": "La route Conakry - Boké perd de l'argent",
  "narrative": "Sur les 12 derniers mois, 18 rotations ont dégagé une marge de -4,2 % ...",
  "metric": {"label": "Marge", "value": -4.2, "unit": "pct", "reference": 30.0, "reference_label": "Seuil"},
  "impact_gnf": 182000000,
  "confidence": 0.86,
  "method": "Marge par route, rotations validées ; seuil de marge paramétré",
  "evidence": {"type": "bars|series|scatter|table", "data": {}},
  "action": "Renégocier le tarif à 1 040 GNF/m³ (point mort) ou réaffecter les ensembles.",
  "link": "/analyse/transport?route=RT-05"
}
```

Score de tri : `impact_gnf` normalisé × gravité × confiance ; 6 constats au plus par section, 10 en
synthèse. Les constats `positive` mettent en valeur ce qui va bien (une synthèse n'est jamais que
négative).

## 5. EGUITRA GROUP (entité « groupe »)

### 5.1 `GET /analyse/groupe/synthese` — Cockpit du dirigeant
- `kpis` : chiffre d'affaires, EBE et taux d'EBE, résultat net, trésorerie nette, BFR en jours de CA,
  DSO, marge transport, couverture de la dette (DSCR), chacun avec N-1, budget ou cible, tendance
  12 mois.
- `health` : score de santé 0-100 et ses cinq axes (`liquidite`, `rentabilite`, `solvabilite`,
  `recouvrement`, `exploitation`), chacun `{score, label, value, unit, comment}` ; méthode : chaque
  ratio rapporté à des bornes documentées (par exemple liquidité : trésorerie / décaissements moyens
  mensuels, 0 mois = 0, 3 mois et plus = 100).
- `waterfall` : du chiffre d'affaires au résultat net de la période (`[{key, label, value, kind:
  "total|plus|minus"}]`) : CA, achats consommés, services extérieurs, impôts et taxes, personnel,
  autres, EBE (total), dotations, résultat financier, impôt, résultat net (total).
- `monthly` : CA, EBE, trésorerie fin de mois sur 24 mois.
- `activities` : par activité analytique, CA, marge, part, variation N-1.
- `insights` : les 10 meilleurs constats de toutes les sections.

### 5.2 `GET /analyse/groupe/rentabilite` — D'où vient la marge
- `by_activity` : séries mensuelles CA et marge par activité.
- `bridge` : pont d'EBE N-1 → N : contribution de chaque activité, puis effets volume, prix et
  mix pour le transport (volume = Δ m³ × tarif moyen N-1 ; prix = Δ tarif moyen × m³ N ; mix =
  reste), `[{key, label, value, kind}]`.
- `cost_structure` : régression des charges mensuelles sur le CA mensuel (24 mois au plus) :
  `fixed_monthly`, `variable_rate` (part variable), `r2`, `breakeven_monthly` (CA mensuel de point
  mort), `safety_margin_pct`, `operating_leverage` ; `points` (CA, charges) pour le nuage et la droite.
- `budget_variance` : lignes budgétaires, réalisé, budget, écart, probabilité de dépassement à fin
  d'année (projection linéaire + dispersion mensuelle).
- `metiers` : chantiers (par chantier : avancement, CA facturé, coûts, marge, indice de performance
  des coûts CPI = valeur acquise / coûts, marge prévue à terminaison) et immobilier (taux d'occupation,
  rendement brut, impayés, par bien).

### 5.3 `GET /analyse/groupe/tresorerie` — Liquidité et prévision à 13 semaines
- `position` : trésorerie par compte et par devise (contre-valeur GNF), total.
- `forecast` : 13 semaines à partir de date_to : `weeks: [{start, end, inflows, outflows, net,
  balance_p10, balance_p50, balance_p90}]` ; encaissements = créances ouvertes datées par le délai de
  paiement réel de chaque client (moyenne et dispersion de son historique, à défaut l'échéance +
  délai moyen global), décaissements = dettes fournisseurs à échéance, échéances d'emprunt, charges
  récurrentes (personnel, loyers : moyenne des 6 derniers mois) ; bandes par Monte-Carlo (1 000
  tirages, graine fixe) sur les délais clients.
- `runway` : semaines avant de passer sous le seuil de trésorerie minimale (p50 et p10), point bas.
- `cycle` : séries mensuelles DSO, DPO, DIO, cycle de conversion, BFR.
- `collections` : par client, montant ouvert, échu, délai moyen réel, encaissement attendu par
  semaine.

### 5.4 `GET /analyse/groupe/clients` — Valeur et risque du portefeuille clients
- `concentration` : `lorenz: [{x, y}]` (part cumulée clients → part cumulée CA), `gini`, `hhi`,
  `top_share` (premier client, cinq premiers), `pareto_count` (clients qui font 80 % du CA).
- `segments` : matrice valeur × comportement de paiement (quadrants « Stratégiques », « À
  sécuriser », « À développer », « À surveiller ») ; par client `{id, name, revenue, margin,
  growth_pct, avg_days_late, payment_score (0-100), open, overdue, ecl, segment}`.
- `behaviour` : par client, distribution des retards de paiement (histogramme), tendance
  (régression du retard dans le temps : « se dégrade », « s'améliore »).
- `trends` : CA mensuel des 10 premiers clients (petits multiples).

### 5.5 `GET /analyse/groupe/transport` — Rentabilité de la flotte et des routes
- `heatmap` : routes × mois, marge en % (et nombre de rotations par case).
- `trucks` : par ensemble routier : rotations, km, m³, CA, coûts directs, marge, CA/km, coût/km,
  L/100 km, jours d'activité, taux d'utilisation (jours en rotation / jours de la période), structure
  imputée, résultat net, rang.
- `fuel_anomalies` : rotations dont la consommation (L/100 km) s'écarte de la flotte (score robuste
  > 3,5) ou de l'historique de l'ensemble ; `[{rotation, date, truck, route, value, expected, score}]`.
- `pricing` : par route, tarif moyen pratiqué, coût complet au m³ à pleine charge, tarif de point
  mort, tarif pour la marge cible, écart → recommandation.
- `shortages` : manquants par chauffeur, route, produit (volume, valeur, part hors tolérance).
- `scatter` : rotations (km, marge, volume) pour le nuage.

### 5.6 `GET /analyse/groupe/depenses` — Dépenses, fournisseurs et contrôles
- `cube` : dépenses par catégorie × activité × mois (pour un treemap et des barres empilées).
- `suppliers` : concentration (Pareto) et dérive de prix par catégorie (montant moyen mensuel).
- `benford` : sur les factures fournisseurs de la période (et les écritures d'achat) : `digits: [{d,
  observed, expected}]`, `n`, `chi2`, `mad`, `conformity`, `suspicious` (chiffres en excès).
- `duplicates` : factures suspectes de doublon (même fournisseur, même montant à 1 % près, à moins
  de 30 jours, ou même référence) avec un score.
- `outliers` : montants inhabituels par catégorie (score robuste > 3,5).

### 5.7 `GET /analyse/groupe/previsions` — Atterrissage de l'exercice
- `revenue` et `ebe` : historique mensuel et prévision jusqu'à la fin de l'exercice
  (`[{month, actual, forecast, low, high}]`), méthode retenue et erreur moyenne (MAPE) en validation
  croisée glissante.
- `landing` : CA et EBE estimés de l'exercice, budget, probabilité d'atteindre le budget (Monte-Carlo).
- `sensitivities` : élasticités pour le simulateur côté écran : `{tariff, volume, fuel, payroll}` →
  effet sur l'EBE annuel d'une variation de 1 % (calculé sur la structure de coûts).

### 5.8 `GET /analyse/groupe/fiabilite` — Fiabilité des données
- `score` 0-100 et `checks: [{key, label, value, target, status, detail, link}]` : imputation
  analytique, relevés rapprochés, pièces sans justificatif, écritures passées tard (délai saisie),
  pièces en brouillon anciennes, comptes d'attente non soldés, tiers sans NIF, rotations non
  facturées anciennes.

## 6. MB AxisPro (entité « cabinet »)

### 6.1 `GET /analyse/cabinet/synthese` — Cockpit du cabinet
- `kpis` : dossiers actifs, besoin de financement total, pipeline pondéré (besoin × probabilité de
  bancabilité), score moyen Readiness, taux de passage de gate, durée médiane d'un gate, honoraires
  de la période, taux de réalisation (facturé / valeur du temps passé).
- `funnel` : par gate, nombre de dossiers, besoin de financement, investissement.
- `maturity` : nuage readiness × bankability (taille : besoin de financement, couleur :
  recommandation) avec les quadrants.
- `insights`.

### 6.2 `GET /analyse/cabinet/portefeuille` — Où en sont les projets
- `funnel` avec conversion entre gates et `time_in_gate: [{gate, median_days, p75_days, n}]`
  (journal des passages de gate) ; `bottleneck` (gate le plus lent rapporté au nombre de dossiers).
- `by_sector`, `by_location` : nombre, besoin, score moyen.
- `pipeline_value` : besoin pondéré par la probabilité de bancabilité ; probabilité = fonction
  logistique du score Bankability (50 → 0,2 ; 65 → 0,5 ; 80 → 0,8), nulle si knock-out actif.
- `forecast` : dossiers attendus aux gates APD et Bankability dans les 3 et 6 prochains mois (vitesse
  observée par gate).

### 6.3 `GET /analyse/cabinet/diagnostic` — Faiblesses systémiques des projets
- `domain_heatmap` : dossiers × domaines, score du domaine (0-100) et priorité.
- `top_gaps` : critères le plus souvent non disponibles ou incomplets dans le portefeuille, avec
  leur fréquence, la priorité moyenne et les dossiers concernés → thèmes de formation ou de
  prestations à proposer.
- `knockouts` : fréquence des knock-outs actifs par critère.
- `evidence` : couverture des preuves, preuves périmées, pièces dues manquantes et leur âge.
- `progression` : évolution des scores par dossier (instantanés des revues de comité et révisions).

### 6.4 `GET /analyse/cabinet/comites` — Qualité des décisions
- `decisions` : répartition des décisions par mois ; `agreement` : matrice recommandation de la
  méthode × décision du comité (taux d'accord) ; `forced_gates` (passages forcés) ; `time_to_decision`
  (ouverture → première décision, médiane) ; `score_at_decision` (distribution par décision).

### 6.5 `GET /analyse/cabinet/financements` — Financements recherchés
- `flows` : sankey secteur → type de financeur → état (`nodes`, `links` avec montants) ;
  `by_funder` : montants demandés, obtenus, taux de succès, ticket moyen, délai ; `pipeline` par état.

### 6.6 `GET /analyse/cabinet/activite` — Activité et honoraires (profils `cabinet`, `finance`, `direction`, `admin`)
- `time` : heures par consultant et par semaine (carte de chaleur), par dossier, par ligne de
  service (activités analytiques du cabinet).
- `realization` : valeur du temps (heures × taux), facturé, taux de réalisation par dossier et par
  consultant ; taux horaire effectif.
- `profitability` : par dossier, honoraires facturés, coût du temps (taux de revient paramétrable,
  défaut 40 % du taux de vente), marge.
- `revenue` : chiffre d'affaires mensuel par ligne de service (Gestion de projets, Formation et
  coaching, Conseil, Audit d'évaluation des transporteurs, Certification), créances clients.
- `forecast` : honoraires des 3 prochains mois (Holt) et carnet (temps non facturé).

### 6.7 `GET /analyse/cabinet/risques` — Risques et exécution
- `risk_matrix` : risques ouverts agrégés probabilité × impact (comptes par case, criticité) ;
  `actions` : ouvertes, en retard, vélocité (créées et terminées par semaine), délai médian ;
  `responsiveness` : délai médian de réponse des porteurs (pièce demandée → déposée).

## 7. `GET /analyse/contexte`
`{"entity": "groupe|cabinet", "company": {...}, "sections": [{"key": "synthese", "label": "...",
"icon": "...", "path": "/analyse/synthese"}], "fiscal_year": {"date_from", "date_to"},
"last_entry_date": "2026-08-15", "can_switch": true}`.

## 8. Application web

- Espace `/analyse` ; pages : `/analyse` (synthèse de la société de travail), puis une page par
  section (les mêmes chemins pour les deux sociétés quand c'est possible, sinon propres).
- En-tête de section : titre en question (« Où va la trésorerie ? »), réponse en une phrase, sélecteur
  de période, date d'arrêté, bouton « Exporter » (XLSX des données de la section, route
  `.../<section>.xlsx` facultative) et « Imprimer ».
- Kit de visualisation premium (`apps/web/components/analyse/charts/`), en SVG, sur les jetons de
  couleur NIMOVA (`globals.css`), thème clair et sombre, animations sobres respectant
  `prefers-reduced-motion`, info-bulles, légendes interactives, accessibilité (rôles, titres, tables
  de repli) : cascade (waterfall), carte de chaleur, Lorenz/Pareto, entonnoir, sankey, treemap, nuage
  à bulles avec quadrants, éventail de prévision (bandes p10-p90), radar de santé, barres de Benford,
  graphique à puces (bullet), petits multiples, jauge. Bibliothèques autorisées pour le calcul
  géométrique seulement : `d3-scale`, `d3-shape`, `d3-array`, `d3-hierarchy`, `d3-sankey` (rendu en
  React).
- Cartes de constats : gravité, titre, récit, métrique, impact, mini-graphique d'évidence, action,
  lien ; « Pourquoi ce constat ? » déplie la méthode.
- Simulateur (prévisions du groupe) : curseurs tarif, volume, carburant, masse salariale → EBE et
  résultat recalculés à l'écran à partir des élasticités.
- Maquette d'API du design (`docs/design/maquette-api/serveur.mjs`) : routes `/analyse/...` avec des
  données fictives cohérentes, pour développer et vérifier les écrans sans le noyau.
