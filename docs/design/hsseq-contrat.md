# NIMOVA · HSSEQ : contrat d'API du lot 1

Contrat entre la session design et la session OTHER (noyau). Version du 25/10/2026, décisions du
noyau intégrées (§12).

- Source : spécification fonctionnelle HSSEQ de la Direction générale, version 1.0 du 24/10/2026
  (diffusion restreinte, non versée au dépôt). Les renvois « §4.2 », « §10 »… désignent ses sections.
- Types TypeScript : `apps/web/lib/hsseq-types.ts`. Libellés français, criticité et matrice :
  `apps/web/components/hsseq/commun.tsx`. Maquette : `docs/design/maquette-api/serveur.mjs`.
- Routes et clés en anglais snake_case, au style de `/transport/rotations` et de `/rh` ; libellés
  affichés en français, côté écran ; droits `can_edit`, `can_close`, `can_approve` sur chaque fiche.
- Les trois formulaires de terrain passent par l'application native NIMOVA Terrain, qui appelle les
  mêmes routes que le web : `client_uuid` sur chaque POST de l'appareil, `reported_at` (heure de
  saisie sur l'appareil) distinct de `synced_at` (posé par le serveur), photos en pièces jointes.

Périmètre du lot 1 (§12 de la spécification) : cockpit de base, événements et enquêtes, plan
d'actions, contrôles pré-départ et alcootest (citerne et benne), verrou V01 à V05, dérogations.
Registre des risques, écrans des habilitations, audits, motifs V06 à V09, rapport mensuel : lot 2.

## 1. Conventions

| Sujet | Règle |
|---|---|
| Base | `/api/v1/hsseq/...` au noyau ; le web passe par la passerelle `/api/odoo/hsseq/...` avec l'en-tête `X-Eguitra-App: hsseq`. |
| Clés et valeurs | Anglais snake_case, clés comme valeurs d'énumération (`status: "reported"`). Références `{ id, name }` ; listes `{ items, total_count, offset, limit, counts }` ; erreurs `{ error, message, fields }`. |
| Dates | `YYYY-MM-DD` ; horodatages ISO 8601 en UTC (`2026-10-15T06:42:00Z`). |
| Montants | GNF, entiers. |
| Listes | `offset` (0), `limit` (50 par défaut, 500 au plus), `sort` (`key` ou `-key`). `counts` porte sur toute la sélection filtrée, pas sur la page. |
| Société | Application de portée groupe (`entity: null`). Filtre `company_id` facultatif ; sans lui, toutes les sociétés du compte. |
| Saisie de terrain | `client_uuid` (idempotence : un `client_uuid` déjà reçu renvoie l'objet existant en 200, sans doublon), `reported_at`, `offline` ; le serveur pose `synced_at`. Pas d'envoi groupé au lot 1 : NIMOVA Terrain rejoue sa file d'attente par les routes unitaires. |
| Droits | Chaque fiche renvoie `rights: { can_edit, can_close, can_approve }` pour le compte connecté et `transitions`, les transitions qu'il peut lancer maintenant. L'écran n'affiche que ces commandes ; le noyau refuse le reste. |
| Journal | Création, modification, transition et lecture d'une donnée sensible journalisées (utilisateur, horodatage, valeur avant et après, §11). Une fiche close ne se rouvre que par le profil `hsseq`, avec motif. |
| Véhicules | `vehicle_kind` (`tanker` : citerne ; `tipper` : benne) et `site_id` viennent de Transport ; mêmes noms dans HSSEQ. |

### Erreurs

`error` porte le code précis, `message` est en français, `fields` nomme les champs en cause.

| `error` | Statut | Cas |
|---|---|---|
| `forbidden` | 403 | Profil, site ou propriété ne permettant pas l'opération. |
| `departure_blocked` | 422 | Départ refusé par le verrou (`POST /transport/rotations/{id}/depart`, §9). |
| `proof_required` | 422 | Clôture d'une action sans pièce de preuve (§9.2). |
| `actions_open` | 422 | Clôture d'un événement dont une action n'est ni close ni annulée (§9.2). |
| `not_waivable` | 422 | Dérogation demandée sur V01 ou V03 (§4.1). |
| `four_eyes` | 422 | Seconde validation d'une dérogation par la personne qui l'a demandée. |
| `verification_too_early` | 422 | Vérification d'efficacité avant J+90 (§9.2). |
| `approval_required` | 422 | Démarrage d'une action coûteuse non validée par la direction. |
| `root_cause_missing` | 422 | Passage aux actions sans cause racine. |
| `invalid_transition` | 422 | Transition non permise depuis le statut courant. |
| `reason_required` | 422 | Réouverture, annulation ou refus sans motif écrit. |
| `photo_missing` | 422 | Levée d'une non-conformité d'un point bloquant sans photo (§4, §5). |
| `incomplete_answers` | 422 | Point de la grille sans réponse (`fields` : identifiants des points). |
| `vehicle_kind_mismatch` | 422 | Grille citerne sur une benne, ou l'inverse. |
| `reason_not_open` | 422 | Dérogation sur un motif qui n'est pas ouvert pour la rotation. |
| `not_in_lot_1` | 422 | Activation d'un motif du lot 2 (V06 à V09), pas encore évalué. |
| `unsupported_type` | 415 | Pièce jointe hors des formats acceptés (contrôle de `eguitra_api/files.py`). |

Liste retenue en entier par le noyau.

## 2. Profils, droits et confidentialité

### Profils du lot 1 (§8)

| Profil | Qui | Ce qu'il fait dans HSSEQ |
|---|---|---|
| `hsseq` | Responsable HSSEQ | Classement, enquêtes, actions, grilles, seconde validation des dérogations, réouverture des fiches closes. Seul à lire le détail des alcootests. Ne demande pas de dérogation. |
| `conducteur` | Conducteur (compte du salarié RH) | NIMOVA Terrain seule : contrôle pré-départ, alcootest, déclaration ; lit ses propres déclarations, ses contrôles, ses habilitations (lot 2). |
| `exploitation` | Chef de parc (et responsable exploitation) | Déclare ; réalise les contrôles ; lève les non-conformités ; demande une dérogation (sa demande vaut première validation) ; lit les événements de son site et le cockpit. |
| `direction` | Directeur général | Lecture intégrale (alcootest en statut seul) ; validation des actions coûteuses ; lecture du journal ; reçoit les notifications de criticité élevée et de dérogation. |
| `rh` | Ressources humaines | Échéances des habilitations des personnes, en statut, sans détail médical. |
| `admin` | Administration | Lecture intégrale (alcootest en statut seul) ; paramétrage des grilles, des motifs du verrou et des sites. |

Les responsables maintenance et qualité n'ont pas de profil propre : tout compte interne désigné
responsable d'une action la lit et la met à jour (droits portés par la fiche). Le profil `auditeur`
(lecture seule bornée en périmètre et en durée) viendra au lot 2.

Menu : une entrée « Paramètres », réservée à `admin` et `hsseq`, regroupe les sites, les grilles de
contrôle et les motifs du verrou.

Sites (`eguitra.hsseq.site`) : nom, code, société, `default_vehicle_kind`, chefs de parc (comptes
`exploitation` rattachés). Un compte `exploitation` rattaché à des sites ne lit que leurs objets ; un
compte `conducteur` ne lit que ce qu'il a saisi. `me.site_ids` vide : tous les sites.

### Matrice des routes

L = lecture, E = écriture, « non » = refusé (403 `forbidden`). « propres » : ce que le compte a saisi
ou ce dont il est responsable ; « site » : borné aux sites du compte.

| Route | admin | direction | hsseq | exploitation | conducteur | rh |
|---|---|---|---|---|---|---|
| `GET /hsseq/referentials` | L | L | L | L | L | L |
| `GET /hsseq/cockpit` | L | L | L | L (site) | non | non |
| `GET /hsseq/deadlines` | L | L | L | L (site) | non | L (personnes) |
| Événements : liste, fiche | L | L | L | L (site, et propres) | L (propres) | non |
| Événements : déclaration | E | E | E | E | E | non |
| Événements : modification | non | non | E | E (propres, statut `reported`) | E (propres, statut `reported`) | non |
| Événements : transitions, enquête, coûts | non | non | E | non | non | non |
| Actions : liste, fiche | L | L | L | L (site, et propres) | non | non |
| Actions : création | non | non | E | non | non | non |
| Actions : mise à jour, démarrage, clôture | non | non | E | E (propres) | non | non |
| Actions : vérification d'efficacité | non | non | E | non | non | non |
| Actions : validation d'une action coûteuse | non | E | non | non | non | non |
| `/hsseq/checks/templates` | L, E | L | L, E | L | L | non |
| Contrôles : liste, fiche | L | L | L | L (site) | L (propres) | non |
| Contrôles : saisie | non | non | E | E | E | non |
| `/hsseq/checks/nonconformities` | L | L | L | L (site) | non | non |
| `POST /hsseq/checks/{id}/lift` | non | non | E | E (site) | non | non |
| Alcootests : saisie | non | non | E | E | E (pour lui-même) | non |
| Alcootests : lecture | statut | statut | détail | statut (site) | non | non |
| `POST /hsseq/lock/evaluate` | L | L | L | L | L (ses rotations) | non |
| `GET /hsseq/lock/departures` | L | L | L | L (site) | non | non |
| `/hsseq/lock/reasons` | L, E | L | L, E | L | non | non |
| `GET /hsseq/sites` | L | L | L | L | L | L |
| `POST /hsseq/sites`, `PATCH /hsseq/sites/{id}` | E | non | E | non | non | non |
| Dérogations : liste, fiche | L | L | L | L (site) | non | non |
| Dérogations : demande | non | non | non | E (site) | non | non |
| Dérogations : validation, refus | non | non | E | non | non | non |
| Dérogations : annulation | non | non | E | E (propres) | non | non |
| `/hsseq/attachments` | L | L | E | E | E (propres) | non |
| `GET /hsseq/log` | non | L | L | non | non | non |
| Rapport PDF, exports Excel | L | L | L | L (site) | non | non |

### Sens des droits par fiche

| Fiche | `can_edit` | `can_close` | `can_approve` |
|---|---|---|---|
| Événement | Corriger la fiche (`hsseq` avant clôture ; déclarant tant que le statut est `reported`) | Transition `close` permise maintenant | Classer, ouvrir ou conduire l'enquête (`hsseq`, avant clôture) |
| Action | Mettre à jour (responsable ou `hsseq`, action ni close ni annulée) | Transition `close` permise (preuve exigée à l'envoi) | Vérification d'efficacité échue (`hsseq`) ou validation d'une action coûteuse (`direction`) |
| Contrôle | Corriger une réponse (`hsseq`) | Lever au moins une non-conformité ouverte | Toujours faux au lot 1 : pas de contre-visa (objectif de moins de 4 minutes de saisie) |
| Non-conformité | Faux | Lever (chef de parc du site ou `hsseq`) | Faux |
| Dérogation | Corriger la justification (demandeur, avant la seconde validation) | Annuler (demandeur ou `hsseq`, avant expiration) | Donner la seconde validation (`hsseq`, autre que le demandeur) |

### Confidentialité (§9.4, §11)

- Alcootest : hors du profil `hsseq` (`admin` compris), on ne lit qu'un statut (`compliant`,
  `non_compliant`, `not_done`), le jour et la rotation ; ni taux, ni appareil, ni heure précise, ni
  auteur du test. La réponse porte `access: "status"` ou `access: "detail"`. Chaque lecture du détail
  est journalisée ; données chiffrées au repos. La réponse à une saisie suit la même règle, y compris
  pour qui a saisi.
- Motif V03 du verrou : `detail` nul hors du profil `hsseq`.
- Habilitations et aptitude médicale : portées par le salarié RH (`eguitra.rh.qualification`) ;
  aptitude en statut seul (`fit`, `unfit`, `review`) partout, aucun motif médical servi par HSSEQ.
- Le cockpit compte les alcootests positifs sans nom ni rotation (§10).
- Toute diffusion d'un événement aux conducteurs (alerte flash, retour d'expérience) est anonymisée :
  ni déclarant ni personnes en cause (§9.4). Au lot 1, un conducteur ne lit que ses déclarations.

## 3. Référentiels, criticité, échéances

### `GET /hsseq/referentials`

```json
{
  "sites": [{ "id": 1, "name": "Parc de Matoto", "code": "MAT", "company": { "id": 1, "name": "EGUITRA GROUP SARLU" },
              "default_vehicle_kind": "tanker", "yard_managers": [{ "id": 12, "name": "Mamadou Bah" }], "active": true }],
  "vehicles": [{ "id": 6, "name": "ER-06", "vehicle_kind": "tanker", "plate": "RC 6014 A", "site_id": 1, "driver_id": 6, "payload_tonnes": null }],
  "drivers": [{ "id": 6, "name": "Lamine Barry", "site_id": 1 }],
  "owners": [{ "id": 19, "name": "Alhassane Diakité" }],
  "criticality_thresholds": [{ "level": "significant", "min": 8, "max": 14, "investigation_days": 7, "method": "five_whys" }],
  "costly_action_threshold": 50000000,
  "me": { "profiles": ["exploitation"], "site_ids": [1], "employee_id": null, "driver_id": null }
}
```

Personnes : habilitations et aptitude sur le salarié RH, relié au chauffeur de Transport par
`employee.driver_id` et au compte par `employee.user_id` ; le compte `conducteur` est celui du
salarié (`me.employee_id`, `me.driver_id`).

### Sites : `/hsseq/sites`

- `GET /hsseq/sites` (tous les profils de l'application) → `HsseqSite[]` : `id`, `name`, `code`,
  `company`, `default_vehicle_kind`, `yard_managers`, `active`.
- `POST /hsseq/sites` et `PATCH /hsseq/sites/{id}` (`admin`, `hsseq`) : `{ name, code, company_id,
  default_vehicle_kind, yard_manager_ids, active }` ; un chef de parc est un compte `exploitation`.
  Réponse : le `HsseqSite`. Écran : « Paramètres », avec les grilles et les motifs du verrou.

### Criticité (§9.1)

`criticality = potential_severity × probability`, notes de 1 à 5 : pour un événement, la criticité
retenue est la potentielle. `actual_severity` (gravité réelle) est conservée pour les statistiques.

| `level` | Criticité | Effet automatique au classement |
|---|---|---|
| `low` | 1 à 3 | Enregistrement et suivi statistique ; clôture directe possible. |
| `moderate` | 4 à 7 | Analyse simple, échéance d'enquête à 15 jours. |
| `significant` | 8 à 14 | 5 Pourquoi sous 7 jours ; notification du Responsable HSSEQ et du responsable métier. |
| `high` | 15 à 25 | Arbre des causes sous 72 h ; notification immédiate du Directeur général ; information du donneur d'ordre sous 24 h ; immobilisation possible du véhicule (V09, lot 2). |

Seuils, délais et méthodes paramétrables (§11), servis par `criticality_thresholds`. Une action issue
d'un objet de criticité 8 ou plus exige une vérification d'efficacité à J+90 (§9.2). Notifications
dans l'application et par courriel (serveur de courrier de la plateforme) ; pas de SMS au lot 1.

### `GET /hsseq/deadlines`

Paramètres : `horizon` (jours, 30 par défaut), `kind` (`qualification`, `vehicle_document`), `site_id`,
`vehicle_kind`. Réponse `{ horizon_days, items: Deadline[] }`, échéances expirées comprises, date
croissante. Alertes à J-30 et J-7, puis motif V04, V05 ou V06 le jour de l'expiration (§9.3).
Sources : habilitations RH (`eguitra.rh.qualification`) pour les personnes ; documents du véhicule de
Transport (`eguitra.transport.vehicle.document`, `kind` ∈ `insurance`, `inspection`, `calibration`,
`tightness`, `expiry_date`) pour les véhicules. Profil `rh` : personnes seules.

```json
{ "kind": "vehicle_document", "document_kind": "inspection", "subject": { "type": "vehicle", "id": 8, "name": "ER-08" },
  "label": "Visite technique", "expires_on": "2026-10-12", "days_left": -3, "expired": true, "reason_code": "V05",
  "site": { "id": 1, "name": "Parc de Matoto" } }
```

## 4. Cockpit (§3, §10)

### `GET /hsseq/cockpit`

Paramètres : `period` (`month` par défaut, ou `12m`), `month` (`YYYY-MM`, mois courant par défaut),
`company_id`, `site_id`, `vehicle_kind`.

```json
{
  "period": { "type": "month", "month": "2026-10", "date_from": "2026-10-01", "date_to": "2026-10-15", "label": "octobre 2026", "frozen": false, "frozen_on": null },
  "filters": { "company_id": null, "site_id": null, "vehicle_kind": null },
  "referentials": { "companies": [{ "id": 1, "name": "EGUITRA GROUP SARLU" }], "sites": [{ "id": 1, "name": "Parc de Matoto" }] },
  "hours_basis": "presence",
  "indicators": [{
    "code": "frequency_rate", "label": "Taux de fréquence", "value": 8.61, "target": 5, "unit": "rate", "direction": "down", "met": false,
    "source": "Événements, RH", "formula": "Accidents du travail avec arrêt × 1 000 000 ÷ heures travaillées, 12 mois glissants",
    "series": [{ "month": "2025-11", "value": 4.12 }], "breakdown": null, "site_scoped": false,
    "note": "12 mois glissants ; heures de RH par société, sans filtre de site."
  }],
  "blocked_departures": { "date": "2026-10-15", "total": 10, "allowed": 5, "blocked": 5, "items": [] },
  "overdue_actions": { "total": 6, "items": [] },
  "deadlines": { "horizon_days": 30, "items": [] },
  "events": { "to_classify": 3, "overdue_investigations": 3, "high_open": 2 },
  "iso_maturity": null,
  "computed_at": "2026-10-15T06:00:00Z"
}
```

- `series` : douze points, le dernier étant le mois demandé.
- `site_scoped` : faux quand l'indicateur ignore le filtre de site. Les heures travaillées et les
  absences pour accident du travail viennent de RH au mois et par société, sans maille site : le taux
  de fréquence et le taux de gravité ne se filtrent pas par site, et l'écran le dit. `hours_basis`
  (`paid` ou `presence`) est le paramètre de la base des heures. Aucune saisie d'heures dans HSSEQ.
- `blocked_departures` : forme `Departures` (§9), `items` limité aux départs bloqués du jour.
- `overdue_actions.items` : `ActionLine`, retard décroissant, 8 au plus. `deadlines.items` : `Deadline`.
- Calcul quotidien depuis les données d'origine ; un mois est figé au 5 du mois suivant (`frozen`,
  `frozen_on`) ; chaque indicateur porte sa `source` (§10).
- `period=12m` : `value` agrège les douze mois (somme pour un nombre, rapport des sommes pour un taux).
- Indicateur sans objet pour le filtre (écart benne sur les citernes) : `value` nul, série de valeurs
  nulles. `iso_maturity` reste nul au lot 1 (audits au lot 2).

### Indicateurs (codes fixes)

| `code` | Indicateur (§10) | `unit` | `direction` | Cible proposée | Source |
|---|---|---|---|---|---|
| `frequency_rate` | Taux de fréquence (TF), 12 mois glissants, sans filtre de site | `rate` | down | ≤ 5,00 | Événements, RH |
| `severity_rate` | Taux de gravité (TG), 12 mois glissants, sans filtre de site | `rate` | down | ≤ 0,20 | Événements, RH |
| `road_accidents_per_mkm` | Accidents de la route par million de km, 12 mois glissants | `rate` | down | ≤ 1,50 | Événements, Transport |
| `reporting_ratio` | (Presqu'accidents + situations dangereuses) ÷ accidents, 12 mois glissants | `ratio` | up | ≥ 10,00 | Événements |
| `check_completion` | Contrôles pré-départ réalisés ÷ départs | `pct` | up | 100 % | NIMOVA Terrain, Transport |
| `check_compliance` | Contrôles sans point critique non conforme ÷ contrôles | `pct` | up | ≥ 95 % | NIMOVA Terrain |
| `breath_test_completion` | Alcootests réalisés ÷ départs | `pct` | up | 100 % | NIMOVA Terrain |
| `breath_test_positives` | Alcootests positifs, sans nom | `count` | down | 0 | NIMOVA Terrain |
| `waivers` | Dérogations au verrou ; `breakdown` par site et par motif | `count` | down | ≤ 2 par mois | Verrou |
| `actions_on_time` | Actions closes à l'échéance ÷ actions échues | `pct` | up | ≥ 90 % | Actions |
| `actions_effectiveness` | Actions efficaces à J+90 ÷ actions vérifiées | `pct` | up | ≥ 80 % | Actions |
| `qualifications_valid` | Conducteurs actifs sans habilitation expirée ÷ conducteurs actifs | `pct` | up | 100 % | Habilitations RH |
| `fuel_consumption` | Litres aux 100 km | `l_100km` | down | ≤ 44,0 | Transport |
| `co2_emissions` | kg de CO₂ par km (2,68 kg par litre de gazole) | `kg_co2_km` | down | ≤ 1,18 | Transport |
| `tanker_shortage` | Citerne : volume manquant ÷ volume livré | `per_mille` | down | ≤ 1,50 ‰ | Transport |
| `tipper_variance` | Benne : écart de tonnage ÷ tonnage chargé | `per_mille` | down | ≤ 5,00 ‰ | Transport |

Cibles paramétrables sans développement (§11) ; celles-ci sont une proposition de départ.

## 5. Événements (§3, §7, §9)

Cycle : `reported` (déclaré) → `classified` (classé) → `investigation` (enquête) → `actions` →
`closed` (clôturé).

| Transition | Depuis | Vers | Condition, effet |
|---|---|---|---|
| `classify` | `reported` | `classified` | Corps `EventClassification`. Calcule `criticality` et `level`, fixe `investigation_due` (72 h, 7 j ou 15 j), envoie les notifications du niveau. |
| `investigate` | `classified` | `investigation` | Corps facultatif `{ method, team_ids }` ; méthode par défaut selon le niveau. |
| `plan` | `investigation` | `actions` | Exige `root_cause`, sinon `root_cause_missing` ; l'enquête est conclue. |
| `close` | `classified` (niveau `low`, sans action) ou `actions` | `closed` | Toutes les actions closes ou annulées, sinon `actions_open`. |
| `reopen` | `closed` | `actions`, sinon `investigation` ou `classified` | Corps `{ reason }` obligatoire. |

### `GET /hsseq/events`

Paramètres : `status` (liste séparée par des virgules), `type`, `domain`, `level`, `site_id`,
`vehicle_kind`, `vehicle_id`, `rotation_id`, `date_from`, `date_to` (sur `occurred_at`),
`overdue_investigation=1`, `search` (référence, titre, lieu), `sort` (`-occurred_at` par défaut,
`criticality`, `reference`, `status`), `offset`, `limit`.

Réponse `Page<EventLine, EventCounts>` :

```json
{
  "items": [{
    "id": 12, "reference": "EVT/2026/0012", "title": "Citerne immobilisée de nuit sur la chaussée sans balisage",
    "type": "hazard", "domain": "safety", "status": "investigation", "occurred_at": "2026-09-24T21:40:00Z",
    "site": { "id": 1, "name": "Parc de Matoto" },
    "vehicle": { "id": 7, "name": "ER-07", "vehicle_kind": "tanker", "plate": "RC 5178 A" },
    "rotation": { "id": 1031, "name": "ROT/2026/00977", "date_loading": "2026-09-24", "route_name": "Conakry - Siguiri" },
    "actual_severity": 2, "potential_severity": 4, "probability": 3, "criticality": 12, "level": "significant",
    "reported_by": { "id": 12, "name": "Mamadou Bah" }, "open_actions": 0,
    "investigation_due": "2026-10-02", "investigation_overdue": true, "total_cost": 0
  }],
  "total_count": 22, "offset": 0, "limit": 50,
  "counts": {
    "by_status": { "reported": 3, "classified": 3, "investigation": 4, "actions": 6, "closed": 6 },
    "by_level": { "low": 2, "moderate": 7, "significant": 8, "high": 2, "unclassified": 3 },
    "overdue_investigations": 3
  }
}
```

Valeurs : `type` ∈ `work_accident`, `road_accident`, `near_miss`, `hazard` (situation dangereuse),
`spill`, `fire`, `security_breach`, `product_quality` (manquant, contamination), `property_damage` ;
`domain` ∈ `safety`, `health`, `security` (sûreté), `environment`, `quality`.

### `GET /hsseq/events/{id}`

`Event` : la ligne, plus `description`, `location`, `gps` (`lat`, `lon`, `accuracy_m`), `source`
(`web`, `terrain`), `client_uuid`, `reported_at`, `synced_at`, `offline`, `people` (personnes en
cause : `kind` `driver`, `employee` ou `third_party`, `id`, `name`, `role` `victim`, `driver`,
`witness`, `perpetrator` ou `third_party`, `days_off`), `lost_time`, `days_lost`,
`vehicle_immobilized`, `classified_at`, `classified_by`, `closed_at`, `closed_by`, `investigation`,
`actions` (`ActionLine`), `costs`, `attachments`, `notifications` envoyées (`channel` `app` ou
`email`), `deadlines` (`investigation_due`, `client_notice_due`, `client_notified_at`), `history`,
`transitions`, `rights`.

### `POST /hsseq/events`

Déclaration du web ou de NIMOVA Terrain, corps `EventReport` : `client_uuid`, `type`, `title`,
`description`, `occurred_at`, `reported_at`, `offline` obligatoires ; `domain` (déduit du type
sinon), `location`, `gps`, `site_id`, `rotation_id`, `vehicle_id`, `people`. Les photos suivent par
`/hsseq/attachments` (`model: "event"`). Réponse : l'`Event` créé, statut `reported`, notes nulles.
Le Responsable HSSEQ est notifié de toute déclaration.

### `PATCH /hsseq/events/{id}`

Champs de la déclaration ; pour `hsseq`, aussi les notes et l'arrêt de travail (criticité recalculée).

### `POST /hsseq/events/{id}/{transition}`

`transition` ∈ `classify`, `investigate`, `plan`, `close`, `reopen`, corps selon le tableau du cycle.

### `PUT /hsseq/events/{id}/investigation`

Corps `InvestigationInput` : `method` (`simple_analysis`, `five_whys`, `cause_tree`), `team_ids`,
`immediate_causes`, `whys` (cinq au plus), `tree` (faits : `id`, `label`, `parent_id`, `kind`
`unusual_fact` ou `permanent_fact`), `factors_5m` (`environment`, `equipment`, `method`, `manpower`,
`material` : milieu, matériel, méthode, main-d'œuvre, matière), `root_cause`, `conclusion`. Statut
`investigation` requis.

### Coûts (§6, exposés à Finance)

`POST /hsseq/events/{id}/costs` : `{ kind, label, amount, date, finance_move_id? }`, `kind` ∈ `claim`
(sinistre), `deductible` (franchise), `downtime` (immobilisation), `product_loss`, `repair`, `other`.
`DELETE /hsseq/events/{id}/costs/{cost_id}`.

Toutes les routes d'écriture d'un événement répondent par l'`Event` à jour.

### Rapport et exports (§11)

`GET /hsseq/events/{id}/report.pdf` : rapport d'enquête, rendu par le noyau comme la lettre de
relance. `GET /hsseq/events/export.xlsx` : registre, mêmes filtres que la liste. Le rapport mensuel
HSSEQ en PDF viendra au lot 2.

## 6. Plan d'actions (§3, §9.2)

`status` ∈ `todo`, `in_progress`, `to_verify`, `closed`, `cancelled`. Calculés : `overdue`,
`days_overdue`, `verification_required` (criticité d'origine de 8 ou plus), `verification_date`.
`origin` ∈ `event`, `audit`, `check`, `risk`, `review` ; `control_level` (hiérarchie des mesures) ∈
`elimination`, `substitution`, `engineering`, `administrative`, `ppe`.

| Transition | Qui | Effet, refus |
|---|---|---|
| `start` | responsable, `hsseq` | `todo` → `in_progress` ; `approval_required` pour une action coûteuse non validée. |
| `close` | responsable, `hsseq` | Exige au moins une pièce de preuve, sinon `proof_required`. Sans vérification requise : `closed`. Avec : `to_verify`, `verification_date` = réalisation + 90 jours. |
| `verify` | `hsseq` | Corps `{ effective, comment, new_due_date? }` ; `verification_too_early` avant la date. Efficace : `closed`. Inefficace : retour `in_progress`, `new_due_date` obligatoire. |
| `approve` | `direction` | Validation, avant le démarrage, d'une action dont `estimated_cost` atteint le seuil paramétré (`costly_action_threshold`, 50 000 000 GNF par défaut). |
| `cancel` | `hsseq` | Corps `{ reason }` obligatoire. |
| `reopen` | `hsseq` | Depuis `closed` ou `cancelled`, corps `{ reason }` ; retour `in_progress`. |

Relances du responsable à J-7, à J0 puis chaque semaine de retard ; escalade au Directeur général après
30 jours de retard (`reminders`, `kind` ∈ `d_minus_7`, `d0`, `weekly`, `escalation`).

- `GET /hsseq/actions` : `status`, `origin`, `owner_id`, `mine=1`, `overdue=1`, `site_id`, `due_before`,
  `event_id`, `search`, `sort` (`due_date` par défaut), `offset`, `limit` → `Page<ActionLine, ActionCounts>`
  (`by_status`, `overdue`, `verifications_due`).
- `GET /hsseq/actions/{id}` → `HsseqAction` : la ligne, plus `expected_evidence`, `evidence`
  (pièces), `estimated_cost`, `management_approval` (`required`, `approved_at`, `approved_by`),
  `created_at`, `created_by`, `done_at`, `verified_at`, `verified_by`, `verification_comment`,
  `closed_at`, `reminders`, `history`, `transitions`, `rights`.
- `POST /hsseq/actions` (`hsseq`) : `NewAction` (`origin`, `origin_id`, `description`, `control_level`,
  `owner_id`, `due_date`, `expected_evidence`, `estimated_cost`).
- `PATCH /hsseq/actions/{id}` : mêmes champs ; responsable et échéance réservés à `hsseq`.
- `POST /hsseq/actions/{id}/{transition}`. Les preuves sont des pièces jointes (`model: "action"`).
- `GET /hsseq/actions/export.xlsx`. Toutes les écritures répondent par la `HsseqAction` à jour.

## 7. Contrôles et non-conformités (§5)

Grilles paramétrables (ajout, retrait, ordre, caractère bloquant) par `hsseq` et `admin`, une par
nature et par type de véhicule. Au lot 1, pré-départ citerne et pré-départ benne, avec le paramétrage
initial du §5 : huit points critiques par type, cinq points communs non bloquants. Le point
« alcootest du conducteur négatif » est relié au formulaire d'alcootest (`linked_to: "breath_test"`) :
il ne se répond pas dans le contrôle et relève de V03. Cible : moins de 4 minutes de saisie
(`duration_s`), photo obligatoire sur toute non-conformité. Pas de contre-visa au lot 1.

### Grilles : `/hsseq/checks/templates`

- `GET /hsseq/checks/templates?vehicle_kind=&kind=&active=` → `CheckTemplate[]` : `id`, `name`, `kind`
  (`pre_departure`, `unloading`, `mine_site`), `vehicle_kind`, `version`, `active`, `items` (`id`,
  `label`, `blocking`, `sequence`, `linked_to`), `updated_at`, `updated_by`.
- `POST /hsseq/checks/templates` et `PATCH /hsseq/checks/templates/{id}` (`hsseq`, `admin`). Toute
  modification incrémente `version` ; un contrôle garde les libellés de sa version.

### Contrôles : `/hsseq/checks`

- `GET /hsseq/checks` : `date_from`, `date_to` (sur `reported_at`), `site_id`, `vehicle_kind`,
  `vehicle_id`, `rotation_id`, `driver_id`, `result` (`compliant`, `non_compliant`, `blocking`),
  `offset`, `limit` → `Page<CheckLine, CheckCounts>` (`by_result`, `departures`, `departures_checked`).
- `GET /hsseq/checks/{id}` → `Check` : réponses point par point (`answer` ∈ `ok`, `not_ok`, `na`,
  `comment`, `photos`), `signature`, `nonconformities`, `photos_missing` (vrai tant qu'une
  non-conformité du contrôle est sans photo), `rights`.
- `POST /hsseq/checks` : `NewCheck` (`client_uuid`, `template_id`, `vehicle_id`, `rotation_id`,
  `driver_id`, `reported_at`, `offline`, `duration_s`, `gps`, `answers` : `item_id`, `answer`,
  `comment`, `signature`). `result` : `blocking` dès qu'un point bloquant est `not_ok`,
  `non_compliant` (avec réserves) pour un point non bloquant, `compliant` sinon. Chaque réponse
  `not_ok` ouvre une non-conformité.
- Photos : le noyau accepte le contrôle sans ses photos, la pièce se déposant rattachée à une fiche
  (§11). NIMOVA Terrain envoie le contrôle, puis au moins une photo par non-conformité
  (`model: "nonconformity"`, `id` de la non-conformité). Chaque non-conformité porte
  `photos_missing` tant qu'aucune photo n'y est rattachée, et le contrôle aussi tant qu'il en reste
  une ; l'écran les signale. Une non-conformité bloquante compte pour V02 avec ou sans photo.

### Non-conformités

- `GET /hsseq/checks/nonconformities` : `status` (`open`, `lifted`), `blocking=1`, `site_id`,
  `vehicle_id`, `offset`, `limit` → `Page<Nonconformity>` (`counts` : `open`, `blocking_open`).
  Une non-conformité : `id`, `check`, `item` (`id`, `label`, `blocking`), `vehicle`, `rotation`,
  `site`, `found_at`, `comment`, `photos`, `photos_missing`, `status` (`open`, `lifted`), `lifted_at`, `lifted_by`,
  `lift_comment`, `lift_photos`, `action`, `rights`.
- `POST /hsseq/checks/{id}/lift` (`{id}` : le contrôle) : `{ nonconformity_id, comment,
  attachment_ids }`. Le chef de parc lève après correction ; la levée exige au moins une photo de la
  correction, déposée avant sur la non-conformité (`model: "nonconformity"`), sinon `photo_missing`. Lève V02 quand il
  ne reste aucune non-conformité bloquante ouverte sur le véhicule. Réponse : le `Check` à jour.

## 8. Alcootests : `/hsseq/breath-tests` (§4 V03, §9.4)

- `POST /hsseq/breath-tests` : `NewBreathTest` (`client_uuid`, `rotation_id`, `driver_id`, `performed`,
  `result` (`negative`, `positive`) si réalisé, `reading_mg_l`, `device`, `not_done_reason` sinon,
  `reported_at`, `offline`). Un conducteur ne saisit que pour lui-même. Un positif retire le conducteur
  de la rotation (`driver_removed`) : Transport doit en affecter un autre.
- `GET /hsseq/breath-tests` : `date`, `date_from`, `date_to`, `rotation_id`, `driver_id`, `status`,
  `site_id`, `offset`, `limit` → `Page<BreathTest>` (`counts` par statut).
- `GET /hsseq/breath-tests/{id}` → `BreathTest`.
- Réponses selon le profil : `BreathTestStatus` (`access: "status"` : `id`, `rotation`, `driver`,
  `date`, `status`) pour tous ; `BreathTestDetail` (`access: "detail"`, en plus `performed`, `result`,
  `reading_mg_l`, `device`, `not_done_reason`, `performed_by`, `driver_removed`, `client_uuid`,
  `reported_at`, `synced_at`, `offline`) pour `hsseq` seul.

## 9. Verrou de départ : `/hsseq/lock` (§4)

Évaluation côté serveur, sans contournement possible depuis un client (§4, §11). Côté Transport :
nouvel état `en_route` de la rotation, posé par `action_depart` (`POST /transport/rotations/{id}/depart`),
qui appelle l'évaluation dans la même transaction. Un refus répond 422 `departure_blocked` avec
`blockers` : `{ code, label, source, since, waivable, severity }`, `severity` valant `block` ou `warn`,
rien d'autre ; les motifs propres à Transport (T01) y figurent aussi, T01 en `block`. Au lot 1, motifs V01 à V05 ; V06 à
V09 sont déclarés au paramétrage mais inactifs.

### `POST /hsseq/lock/evaluate`

Entrée `{ "rotation_id": 1127 }`. Sortie `LockEvaluation` (§4.2 en anglais, plus `checked_at`) :

```json
{
  "rotation_id": 1127,
  "allowed": false,
  "reasons": [{
    "code": "V02", "label": "Point critique du contrôle pré-départ non conforme", "source": "NIMOVA Terrain",
    "since": "2026-10-15T06:05:00Z", "waivable": true, "detail": "Plaques et étiquettes de danger en place",
    "resolution": "Chef de parc après correction, photo obligatoire", "severity": "block", "waiver_id": null
  }],
  "active_waiver": null,
  "checked_at": "2026-10-15T07:31:12Z"
}
```

| Code | Ouvert quand (lot 1) |
|---|---|
| V01 | Aucun contrôle pré-départ enregistré pour la rotation. |
| V02 | Une non-conformité d'un point bloquant reste ouverte sur le véhicule, d'une rotation à l'autre. |
| V03 | Aucun alcootest du conducteur de la rotation, ou le dernier est non réalisé ou positif ; `detail` nul hors `hsseq`. |
| V04 | Habilitation obligatoire du salarié lié au chauffeur (`eguitra.rh.qualification`) absente ou expirée à la date de chargement, ou aptitude `unfit`. |
| V05 | Assurance (`insurance`) ou visite technique (`inspection`) du véhicule expirée à la date de chargement. |

`severity` : les motifs V01 à V09 sont toujours `block`. Un avertissement HSSEQ (par exemple une
habilitation absente avant la date de mise en service) arrive en `warn` : il est affiché et transmis
à Transport mais n'empêche pas le départ.

`allowed` est vrai quand aucun motif `block` n'est ouvert, ou quand chacun est couvert par une
dérogation active de la rotation (`waiver_id`). `active_waiver` : `id`, `approved_by` (demandeur puis
second valideur), `expires`, ou nul. `label`, `source` et `resolution` reprennent le tableau du §4 de
la spécification ; `detail` précise le cas. Chaque évaluation est journalisée.

### `GET /hsseq/lock/departures`

`date` (aujourd'hui par défaut), `site_id`, `vehicle_kind`, `blocked=1` → `Departures` (`date`,
`total`, `allowed`, `blocked`, `items` : `rotation`, `vehicle`, `driver`, `site`, `evaluation`).
Un départ du jour : rotation à charger ce jour-là, pas encore `en_route`.

### `/hsseq/lock/reasons`

`GET` → `ReasonSetting[]` (`code`, `label`, `source`, `resolution`, `vehicle_kinds`, `waivable`, `lot`,
`active`, `disabled_sites`). `PATCH` (`hsseq`, `admin`) : `{ code, active?, disabled_sites? }`,
activation par type de véhicule et par site (§4.2). Un motif du lot 2 ne s'active pas
(`not_in_lot_1`) ; V01 et V03 restent non dérogeables.

## 10. Dérogations : `/hsseq/waivers` (§4.1)

Une rotation, un motif, une justification écrite. Seul un chef de parc (`exploitation`, site de la
rotation) la demande, et sa demande vaut première validation ; la seconde est donnée par un compte
`hsseq`, forcément une autre personne (`four_eyes`). Le profil `hsseq` ne demande pas. Expire à la fin
de la rotation ; journalisée, notifiée au Directeur général à l'activation, comptée dans les
indicateurs. Jamais sur V01 ni V03 (`not_waivable`).

`status` : `pending_hsseq` (attente du Responsable HSSEQ) → `active` → `expired` ; ou `refused`,
`cancelled`.

- `GET /hsseq/waivers` : `status`, `rotation_id`, `site_id`, `reason_code`, `date_from`, `date_to`,
  `offset`, `limit` → `Page<Waiver>` (`counts` par statut).
- `GET /hsseq/waivers/{id}` → `Waiver` : `id`, `reference`, `rotation`, `vehicle`, `site`,
  `reason_code`, `reason_label`, `justification`, `requested_by`, `requested_at`, `approvals`
  (`level` 1 ou 2, `role` `yard_manager` ou `hsseq_manager`, `by`, `at` ; le niveau 1 est la demande),
  `status`, `expires`, `refusal_reason`, `management_notified_at`, `transitions`, `rights`.
- `POST /hsseq/waivers` (`exploitation`) : `{ rotation_id, reason_code, justification }`. Refus
  `not_waivable` (V01, V03), `reason_not_open`, 409 `conflict` (demande en cours ou active pour la
  même rotation et le même motif).
- `POST /hsseq/waivers/{id}/approve` (`hsseq`) : seconde validation ; `four_eyes` si le valideur est le
  demandeur. Statut `active`, `expires` = fin prévue de la rotation, notification du Directeur général
  (`management_notified_at`).
- `POST /hsseq/waivers/{id}/refuse` (`hsseq`) : `{ reason }` obligatoire.
- `POST /hsseq/waivers/{id}/cancel` : demandeur ou `hsseq`, avant expiration.
- Toutes répondent par le `Waiver` à jour.

## 11. Pièces jointes et journal

### `/hsseq/attachments`

- `POST /hsseq/attachments` (multipart) : `file`, `model` (`event`, `action`, `check`, `nonconformity`,
  `waiver`) et `id` de la fiche, obligatoires ; `caption`, `client_uuid` (idempotence) facultatifs. Les
  photos d'un contrôle se rattachent à ses non-conformités. Toute pièce est rattachée à une fiche HSSEQ dès le dépôt.
  Formats contrôlés par `eguitra_api/files.py` (JPEG, PNG, PDF ; signature du contenu), 8 Mo au plus ;
  photos compressées sur l'appareil. Réponse `Attachment` : `id`, `name`, `mimetype`, `size`,
  `is_photo`, `caption`, `created_at`, `created_by`, `url`.
- `GET /hsseq/attachments/{id}/download` : le fichier, aux droits de la fiche.
- `DELETE /hsseq/attachments/{id}` : auteur ou `hsseq`, tant que la fiche n'est pas close.

### `GET /hsseq/log`

`model` (`event`, `action`, `check`, `breath_test`, `waiver`), `id`, `date_from`, `date_to`, `offset`,
`limit` → `Page<HistoryEntry & { model, id }>` (`at`, `by`, `action`, `field`, `old_value`,
`new_value`). Lecture `hsseq` et `direction`. Comprend les lectures du détail des alcootests.

## 12. Décisions du noyau (25/10)

Décisions de la session OTHER sur les questions posées, reportées dans les sections ci-dessus.

1. Transport : état `en_route`, `action_depart`, `POST /transport/rotations/{id}/depart`. Refus en 422
   `departure_blocked` avec `blockers` (`code`, `label`, `source`, `since`, `waivable`, `severity`).
   Ni `on_road` ni `locked` (§9).
2. Sites : nouveau modèle `eguitra.hsseq.site` (nom, code, société, type de véhicule par défaut, chefs
   de parc = comptes `exploitation` rattachés) ; le véhicule reçoit `site_id`. Les deux sites de la
   maquette conviennent (§2, §3).
3. Transport : `vehicle_kind` (`tanker`, `tipper`), `payload_tonnes`, modèle
   `eguitra.transport.vehicle.document` (`kind` `insurance`, `inspection`, `calibration`, `tightness` ;
   `expiry_date`) (§1, §3, §9).
4. Personnes : habilitations et aptitude sur le salarié RH (`eguitra.rh.qualification`), relié au
   chauffeur par `employee.driver_id` et au compte par `employee.user_id` ; le compte `conducteur` est
   celui du salarié. Personnes d'un événement : `kind` `driver`, `employee`, `third_party` (§3, §5).
5. Heures et accidents : fournis par RH au mois et par société, sans maille site ; TF et TG ne se
   filtrent pas par site et l'écran le dit ; base des heures `paid` ou `presence` ; aucune saisie dans
   HSSEQ (§4).
6. `admin` paramètre grilles, motifs et sites ; il ne lit jamais le détail des alcootests (§2).
7. Dérogation : seul un chef de parc la demande et sa demande vaut première validation ; seconde par un
   compte `hsseq`, autre personne ; `hsseq` ne demande pas (§10).
8. Action coûteuse : seuil paramétré, 50 000 000 GNF par défaut ; validation de la direction avant le
   démarrage (§6).
9. Pas de contre-visa du contrôle au lot 1 : `can_approve` d'un contrôle toujours faux ; le chef de
   parc lève les non-conformités (§2, §7).
10. V02 : toute non-conformité bloquante encore ouverte sur le véhicule, d'une rotation à l'autre (§9).
11. Action inefficace à J+90 : retour `in_progress` avec nouvelle échéance (§6).
12. `error` porte le code précis (`departure_blocked`, `proof_required`, `actions_open`,
    `not_waivable`, `four_eyes`, `forbidden`…), message en français (§1).
13. Courriel par le serveur de courrier de la plateforme ; pas de SMS au lot 1 (option à chiffrer,
    fournisseur à choisir) (§3).
14. PDF rendus par le noyau, comme la lettre de relance : rapport d'enquête au lot 1, rapport mensuel
    au lot 2 (§5).
15. Noms retenus : `/hsseq/lock/departures`, `/hsseq/lock/reasons`, `/hsseq/attachments` (dépôt
    rattaché à une fiche, formats contrôlés par `eguitra_api/files.py`), `/hsseq/referentials`,
    `/hsseq/deadlines`, `/hsseq/checks/nonconformities`, `/hsseq/waivers/{id}/cancel`,
    `/hsseq/log?model&id` (lecture `hsseq` et `direction`). Pas de `/hsseq/sync` au lot 1 : les envois
    idempotents par `client_uuid` suffisent.

Horodatage : `reported_at` (saisie) et `synced_at` (posé par le serveur).

### Réponses aux derniers points (25/10)

1. `severity` vaut `block` ou `warn`, rien d'autre. Les motifs HSSEQ sont toujours `block` ; un
   avertissement HSSEQ (habilitation absente avant la date de mise en service) arrive en `warn` ; T01
   de Transport est `block` (§9).
2. Photos : le noyau accepte le contrôle sans ses photos ; chaque non-conformité porte `photos_missing`
   tant qu'aucune photo n'y est rattachée, et le contrôle aussi tant qu'il en reste une ; une
   non-conformité bloquante compte pour V02 avec ou sans photo ; la levée exige une photo
   (`photo_missing`) (§7).
3. Sites : `GET /hsseq/sites` pour tous les profils de l'application ; `POST /hsseq/sites` et
   `PATCH /hsseq/sites/{id}` pour `admin` et `hsseq` ; entrée de menu « Paramètres » réservée à
   `admin` et `hsseq` : sites, grilles et motifs du verrou (§2, §3).
4. Codes d'erreur : la liste du §1 est retenue en entier (§1).
