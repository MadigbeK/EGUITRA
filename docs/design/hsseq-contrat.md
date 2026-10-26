# NIMOVA · HSSEQ : contrat d'API du lot 1

Contrat entre la session design et la session OTHER (noyau). Version du 26/10/2026 : décisions du
noyau intégrées (§12), puis sections alignées sur le code du noyau (`addons/eguitra_hsseq`, branche
`hsseq`) ; les écarts sont résumés au §13, les propositions des écrans au §14, et le lot 2, servi par
le noyau et figé à `hsseq@98da669`, au §15.

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
d'actions, contrôles avant départ et alcootest (citerne et benne), verrou V01 à V05, dérogations.
Registre des risques, écrans des habilitations, audits, motifs V06 à V09, rapport mensuel : lot 2.

## 1. Conventions

| Sujet | Règle |
|---|---|
| Base | `/api/v1/hsseq/...` au noyau ; le web passe par la passerelle `/api/odoo/hsseq/...` avec l'en-tête `X-Eguitra-App: hsseq`. |
| Clés et valeurs | Anglais snake_case, clés comme valeurs d'énumération (`status: "reported"`). Références `{ id, name }` ; listes `{ items, total_count, offset, limit, counts }` ; erreurs `{ error, message, fields }`. |
| Dates | `YYYY-MM-DD` ; horodatages ISO 8601 en UTC (`2026-10-15T06:42:00Z`) ; en entrée, un décalage horaire est accepté. |
| Montants | GNF. |
| Listes | `offset` (0), `limit` (50 par défaut, 500 au plus), `sort` (`key` ou `-key`, clés propres à chaque liste ; une clé inconnue répond 400 `invalid_parameter`). `counts` porte sur toute la sélection filtrée, pas sur la page. Les filtres de statut, de type, de domaine, de niveau et de résultat acceptent une liste séparée par des virgules. |
| Société | Application de portée groupe (`entity: null`). Filtre `company_id` facultatif ; sans lui, toutes les sociétés du compte ; une société hors du compte répond 403. |
| Saisie de terrain | `client_uuid` (idempotence : un `client_uuid` déjà reçu renvoie l'objet existant en 200, sans doublon, à son auteur ; venu d'un autre compte, 409 `conflict`), `reported_at` (maintenant par défaut, refusé au-delà de cinq minutes dans le futur), `offline` ; le serveur pose `synced_at`. Position à plat : `latitude`, `longitude`, `gps_accuracy` (mètres), sur les événements et les contrôles. L'en-tête `X-Eguitra-App: terrain` donne la source `terrain` d'une déclaration. Pas d'envoi groupé au lot 1. |
| Photos avant la fiche | Une pièce se dépose sans fiche (`POST /hsseq/attachments` sans `model`), puis la fiche la cite par `attachment_ids` ; seul son déposant la cite, une seule fois (§11). |
| Droits | Chaque fiche renvoie `rights: { can_edit, can_close, can_approve }` pour le compte connecté et `transitions`, les transitions qu'il peut lancer maintenant. L'écran n'affiche que ces commandes ; le noyau refuse le reste. |
| Journal | Création, modification, transition, notification et lecture d'une donnée sensible journalisées (utilisateur, horodatage, valeur avant et après, note, §11). Une fiche close ne se rouvre que par le profil `hsseq`, avec motif. |
| Véhicules | `vehicle_kind` (`tanker` : citerne ; `tipper` : benne) vient de Transport ; le site d'un ensemble se fixe par les sites (`vehicle_ids`, §3). |

### Erreurs

`error` porte le code précis, `message` est en français, `fields` nomme les champs en cause.

| `error` | Statut | Cas |
|---|---|---|
| `missing_fields` | 400 | Champ obligatoire absent ou vide (`fields`). |
| `invalid_parameter` | 400 | Valeur illisible ou hors liste : identifiant, date, nombre, tri, position, version de grille, photo d'une autre fiche citée à la levée (`fields`). |
| `invalid_json` | 400 | Corps illisible. |
| `forbidden` | 403 | Profil, site, société ou propriété ne permettant pas l'opération. |
| `not_found` | 404 | Fiche absente ou hors du périmètre du compte (sans révéler son existence), transition inconnue. |
| `conflict` | 409 | `client_uuid` déjà reçu d'un autre compte ; dérogation déjà demandée ou active pour la rotation et le motif ; pièce citée déjà rattachée à une autre fiche. |
| `too_large` | 413 | Pièce jointe de plus de 8 Mo. |
| `unsupported_type` | 415 | Pièce ou signature hors des formats acceptés (contrôle de `eguitra_api/files.py`). |
| `business_rule` | 422 | Règle de gestion sans code propre : grille inconnue ou retirée, ensemble qui n'est pas celui de la rotation, responsable d'action hors de la société, chef de parc qui n'est pas un compte Exploitation, caractère dérogeable d'un motif, seuils de criticité, 30 pièces au plus par fiche, départ d'une rotation qui n'est pas saisie. |
| `departure_blocked` | 422 | Départ refusé par le verrou (`POST /transport/rotations/{id}/depart`, §9). |
| `validation_blocked` | 422 | Validation d'une rotation soumise au verrou avant son départ « en route » (motif H01 de Transport, §9). |
| `proof_required` | 422 | Clôture d'une action sans pièce de preuve (§9.2). |
| `actions_open` | 422 | Clôture d'un événement dont une action n'est ni close ni annulée (§9.2). |
| `not_waivable` | 422 | Dérogation demandée sur V01 ou V03 (§4.1). |
| `four_eyes` | 422 | Seconde validation ou refus d'une dérogation par la personne qui l'a demandée. |
| `verification_too_early` | 422 | Vérification d'efficacité avant la date (§9.2). |
| `approval_required` | 422 | Démarrage d'une action coûteuse non validée par la direction. |
| `root_cause_missing` | 422 | Passage aux actions sans cause racine. |
| `invalid_transition` | 422 | Transition non permise depuis le statut courant ; écriture sur une fiche close. |
| `reason_required` | 422 | Réouverture, annulation, refus ou demande de dérogation sans motif écrit. |
| `photo_missing` | 422 | Levée d'une non-conformité sans photo de la correction (§4, §5). |
| `incomplete_answers` | 422 | Point de la grille sans réponse (`fields` : identifiants des points). |
| `vehicle_kind_mismatch` | 422 | Grille citerne sur une benne, ou l'inverse. |
| `reason_not_open` | 422 | Dérogation sur un motif qui n'est pas ouvert pour la rotation. |
| `not_in_lot_1` | 422 | Activation d'un motif du lot 2 (V06 à V09), pas encore évalué. |

## 2. Profils, droits et confidentialité

### Profils du lot 1 (§8)

| Profil | Qui | Ce qu'il fait dans HSSEQ |
|---|---|---|
| `hsseq` | Responsable HSSEQ | Classement, enquêtes, actions, grilles, réglages, seconde validation des dérogations, réouverture des fiches closes, annulation d'un alcootest saisi par erreur. Seul à lire le détail des alcootests. Ne demande pas de dérogation. |
| `conducteur` | Conducteur (compte du salarié RH) | NIMOVA Terrain seule : contrôle avant départ, alcootest, déclaration ; lit ses propres déclarations, ses contrôles, son espace (`/hsseq/me`). |
| `exploitation` | Chef de parc (et responsable exploitation) | Déclare ; réalise les contrôles ; lève les non-conformités ; demande une dérogation (sa demande vaut première validation) ; fait partir une rotation ; lit les événements de son site et le cockpit. |
| `direction` | Directeur général | Lecture intégrale (alcootest en statut seul) ; validation des actions coûteuses ; lecture du journal ; reçoit les notifications de criticité élevée, de dérogation et d'escalade. |
| `rh` | Ressources humaines | Échéances des habilitations des personnes, en statut, sans détail médical. |
| `admin` | Administration | Paramétrage des grilles, des motifs du verrou, des sites et des réglages. Le profil admin implique direction dans le noyau : il en a les droits (lecture intégrale, lecture du journal, validation d'une action coûteuse), mais jamais le détail d'un alcootest. |

Les responsables maintenance et qualité n'ont pas de profil propre : tout compte interne désigné
responsable d'une action la lit et la met à jour (droits portés par la fiche). Le profil `auditeur`
(lecture seule bornée en périmètre et en durée) viendra au lot 2.

Menu : une entrée « Paramètres », réservée à `admin` et `hsseq`, regroupe les sites, les grilles de
contrôle, les motifs du verrou et les réglages de la société.

Sites (`eguitra.hsseq.site`) : nom, code (unique dans la société), société, `default_vehicle_kind`,
chefs de parc (comptes `exploitation` rattachés), ensembles rattachés. Un compte `exploitation`
rattaché à des sites ne lit que leurs objets (un objet sans site reste visible) ; un compte
`conducteur` ne lit que ce qu'il a saisi ou ce qui le concerne. `me.site_ids` vide : tous les sites.

### Matrice des routes

L = lecture, E = écriture, « non » = refusé (403 `forbidden`). « propres » : ce que le compte a saisi
ou ce dont il est responsable ; « site » : borné aux sites du compte. La colonne admin vaut aussi par
le profil direction qu'il implique.

| Route | admin | direction | hsseq | exploitation | conducteur | rh |
|---|---|---|---|---|---|---|
| `GET /hsseq/referentials`, `GET /hsseq/sites` | L | L | L | L | L | L |
| `GET /hsseq/me`, `/hsseq/notifications` | L | L | L | L | L | L |
| `GET` et `PATCH /hsseq/settings` | L, E | non | L, E | non | non | non |
| `GET /hsseq/cockpit` | L | L | L | L (site) | non | non |
| `GET /hsseq/deadlines` | L | L | L | L (site) | non | L (personnes) |
| Événements : liste, fiche | L | L | L | L (site, et propres) | L (propres) | non |
| Événements : déclaration | E | E | E | E | E | non |
| Événements : modification | non | non | E | E (propres, statut `reported`) | E (propres, statut `reported`) | non |
| Événements : transitions, enquête, coûts | non | non | E | non | non | non |
| Actions : liste, fiche | L | L | L | L (site, et propres) | L (propres) | L (propres) |
| Actions : création | non | non | E | non | non | non |
| Actions : mise à jour, démarrage, clôture | E (propres) | E (propres) | E | E (propres) | non | E (propres) |
| Actions : vérification, annulation, réouverture | non | non | E | non | non | non |
| Actions : validation d'une action coûteuse | E | E | non | non | non | non |
| `/hsseq/checks/templates` | L, E | L | L, E | L | L | non |
| Contrôles : liste, fiche | L | L | L | L (site) | L (propres) | non |
| Contrôles : saisie | non | non | E | E (site) | E (ses ensembles) | non |
| `/hsseq/checks/nonconformities` | L | L | L | L (site) | non | non |
| `POST /hsseq/checks/{id}/lift` | non | non | E | E (site) | non | non |
| Alcootests : saisie | non | non | E | E (site) | E (pour lui-même) | non |
| Alcootests : lecture | statut | statut | détail | statut (site) | fait (propres) | non |
| `POST /hsseq/breath-tests/{id}/cancel` | non | non | E | non | non | non |
| `POST /hsseq/lock/evaluate` | L | L | L | L (site) | L (ses rotations) | non |
| `GET /hsseq/me/rotations` | L | non | L | L (site) | L (propres) | non |
| `POST /transport/rotations/{id}/depart` (Transport) | E | non | non | E (site) | non | non |
| `GET /hsseq/lock/departures` | L | L | L | L (site) | non | non |
| `/hsseq/lock/reasons` | L, E | L | L, E | L | non | non |
| `POST /hsseq/sites`, `PATCH /hsseq/sites/{id}` | E | non | E | non | non | non |
| Dérogations : liste, fiche | L | L | L | L (site, et propres) | non | non |
| Dérogations : demande | non | non | non | E (site) | non | non |
| Dérogations : validation, refus | non | non | E | non | non | non |
| Dérogations : annulation | non | non | E | E (propres) | non | non |
| `/hsseq/attachments` (dépôt sur une fiche) | E (propres) | E (propres) | E | E (site, et propres) | E (propres) | non |
| `GET /hsseq/log` | L | L | L | non | non | non |
| Rapport PDF, exports Excel | L | L | L | L (site) | non | non |

Le départ (`POST /transport/rotations/{id}/depart`) appartient à Transport. Règle retenue par le
noyau le 26/10, verrou en service ou non : le chef de parc (profil `exploitation`, sites de la
rotation) et l'administration (`admin`) font partir une rotation ; jamais la finance ni la direction,
jamais le conducteur (403 `forbidden`). La session TRANSPORT aligne sa route sur cette règle.

### Sens des droits par fiche

| Fiche | `can_edit` | `can_close` | `can_approve` |
|---|---|---|---|
| Événement | Corriger la fiche (`hsseq` avant clôture ; déclarant tant que le statut est `reported`) | Transition `close` permise maintenant | Classer, ouvrir ou conduire l'enquête (`hsseq`, avant clôture) |
| Action | Mettre à jour (responsable ou `hsseq`, action ni close ni annulée) | Transition `close` permise (preuve exigée à l'envoi) | Vérification d'efficacité échue (`hsseq`) ou validation d'une action coûteuse (`direction`) |
| Contrôle | Vrai pour `hsseq` ; aucune route de correction au lot 1 (proposition, §14) | Lever au moins une non-conformité ouverte | Toujours faux au lot 1 : pas de contre-visa (objectif de moins de 4 minutes de saisie) |
| Non-conformité | Faux | Lever (chef de parc du site ou `hsseq`) | Faux |
| Dérogation | Corriger la justification (demandeur, avant la seconde validation) | Annuler (demandeur ou `hsseq`, avant expiration) | Donner la seconde validation (`hsseq`, autre que le demandeur) |

### Confidentialité (§9.4, §11)

- Alcootest, trois niveaux de lecture. Profil `conducteur` (et tout compte hors administration,
  direction, hsseq et exploitation) : seulement `done` (test fait ou non) et l'heure, aucun résultat
  (`access: "done"`), sur ses propres tests. Profils `exploitation`, `direction` et `admin` : le statut
  de conformité (`compliant`, `non_compliant`, `not_done`), le jour et la rotation, ni taux, ni appareil,
  ni heure précise, ni auteur (`access: "status"`). Profil `hsseq` seul : le détail chiffré (`access:
  "detail"`). Chaque lecture du détail est journalisée. La réponse à une saisie suit la même règle, y
  compris pour qui a saisi. Un test annulé n'est connu que du profil `hsseq`.
- Motif V03 du verrou : `detail` nul hors du profil `hsseq`.
- Habilitations et aptitude médicale : portées par le salarié RH (`eguitra.rh.qualification`) ;
  aptitude en statut seul (`fit`, `unfit`, `review`) partout, aucun motif médical servi par HSSEQ.
- Le cockpit compte les alcootests positifs sans nom ni rotation (§10).
- Toute diffusion d'un événement aux conducteurs (alerte flash, retour d'expérience) est anonymisée :
  ni déclarant ni personnes en cause (§9.4). Au lot 1, un conducteur ne lit que ses déclarations, sans
  actions, coûts, notifications ni journal.

## 3. Référentiels, réglages, criticité, échéances

### `GET /hsseq/referentials`

```json
{
  "sites": [{ "id": 1, "name": "Parc de Matoto", "code": "MAT", "company": { "id": 1, "name": "EGUITRA GROUP SARLU" },
              "default_vehicle_kind": "tanker", "yard_managers": [{ "id": 12, "name": "Mamadou Bah" }], "active": true, "vehicle_ids": [6, 7] }],
  "vehicles": [{ "id": 6, "name": "ER-06", "vehicle_kind": "tanker", "plate": "RC 6014 A", "site_id": 1, "driver_id": 6, "payload_tonnes": null }],
  "drivers": [{ "id": 6, "name": "Lamine Barry", "site_id": 1 }],
  "owners": [{ "id": 19, "name": "Alhassane Diakité" }],
  "criticality_thresholds": [{ "level": "high", "min": 15, "max": 25, "investigation_days": 3.0, "investigation_hours": 72, "method": "cause_tree" }],
  "costly_action_threshold": 50000000,
  "check_window_hours": 12, "breath_test_window_hours": 4,
  "vehicle_kinds": [{ "code": "tanker", "label": "Citerne" }, { "code": "tipper", "label": "Benne" }],
  "me": { "profiles": ["exploitation"], "site_ids": [1], "employee_id": null, "driver_id": null }
}
```

`owners` : comptes internes hors conducteurs, responsables possibles d'une action (vide pour le
conducteur). `drivers` : le conducteur ne reçoit que lui-même ; le site d'un chauffeur est celui de
l'ensemble dont il est le chauffeur habituel. Seuils et fenêtres viennent des réglages de la société.

Personnes : habilitations et aptitude sur le salarié RH, relié au chauffeur de Transport par
`employee.driver_id` et au compte par `employee.user_id` ; le compte `conducteur` est celui du
salarié (`me.employee_id`, `me.driver_id`).

### Sites : `/hsseq/sites`

- `GET /hsseq/sites` (tous les profils de l'application, sites inactifs compris) → `HsseqSite[]` :
  `id`, `name`, `code`, `company`, `default_vehicle_kind`, `yard_managers`, `active`, `vehicle_ids`.
- `POST /hsseq/sites` (`name`, `code` obligatoires) et `PATCH /hsseq/sites/{id}` (`admin`, `hsseq`) :
  `{ name, code, company_id, default_vehicle_kind, yard_manager_ids, vehicle_ids, active }`. Un chef de
  parc est un compte Exploitation transport de la société, sinon 422 `business_rule` ; `vehicle_ids`
  remplace les ensembles rattachés au site (ensembles de la même société). Réponse : le `HsseqSite`.

### Réglages : `GET` et `PATCH /hsseq/settings` (`admin`, `hsseq`)

Paramètres par société (`company_id` facultatif, la société de travail sinon), modifiables sans
développement (§11). `PATCH` n'envoie que les champs modifiés et répond par les réglages à jour.

| Champ | Défaut | Effet |
|---|---|---|
| `lock_start_date` | vide | Verrou en service pour les rotations chargées à partir de cette date (validation après le passage « en route ») ; vide : pas encore en service. |
| `qualifications_required_from`, `employee_file_required_from`, `documents_required_from` | vides | Avant ces dates, une habilitation obligatoire absente, un chauffeur sans dossier salarié ou un document du véhicule absent est un avertissement (`warn`) ; ensuite il bloque (V04, V05). |
| `check_window_hours`, `breath_test_window_hours` | 12, 4 | Fenêtres du rattachement automatique (§9). |
| `level_moderate_min`, `level_significant_min`, `level_high_min` | 4, 8, 15 | Seuils de criticité, croissants entre 2 et 25 (sinon 422 `business_rule`). |
| `investigation_hours_high`, `investigation_days_significant`, `investigation_days_moderate`, `client_notice_hours` | 72, 7, 15, 24 | Délais d'enquête et information du donneur d'ordre. |
| `verification_min_criticality`, `verification_days`, `escalation_days` | 8, 90, 30 | Vérification d'efficacité et escalade d'une action. |
| `costly_action_threshold` | 50 000 000 | Action coûteuse, validée par la direction avant son démarrage. |
| `director` (entrée `director_id`) | vide | Destinataire des notifications de la direction ; vide : les comptes Direction générale de la société. |
| `targets` | `{}` | Cibles du cockpit par code d'indicateur ; un code absent garde la cible proposée (§4). |

La réponse porte aussi `company` et `criticality_thresholds`.

### Criticité (§9.1)

`criticality = potential_severity × probability`, notes de 1 à 5 : pour un événement, la criticité
retenue est la potentielle. `actual_severity` (gravité réelle) est conservée pour les statistiques.

| `level` | Criticité (seuils par défaut) | Effet automatique au classement |
|---|---|---|
| `low` | 1 à 3 | Enregistrement et suivi statistique ; clôture directe possible sans action. |
| `moderate` | 4 à 7 | Analyse simple, échéance d'enquête à 15 jours. |
| `significant` | 8 à 14 | 5 Pourquoi sous 7 jours ; notification du Responsable HSSEQ et du responsable métier. |
| `high` | 15 à 25 | Arbre des causes sous 72 h ; notification immédiate du Directeur général ; information du donneur d'ordre sous 24 h ; immobilisation possible du véhicule (V09, lot 2). |

Seuils, délais et méthodes servis par `criticality_thresholds` (réglages). L'échéance d'enquête court
depuis l'heure de saisie (`reported_at`). Une action issue d'un événement de criticité au seuil
`verification_min_criticality` (8 par défaut) exige une vérification d'efficacité. Notifications dans
l'application et par courriel (serveur de courrier de la plateforme) ; pas de SMS au lot 1.

### `GET /hsseq/deadlines`

Paramètres : `horizon` (jours, 30 par défaut, de 0 à 366), `kind` (`qualification`,
`vehicle_document`), `site_id`, `vehicle_kind`, `company_id`. Réponse `{ horizon_days, items:
Deadline[] }`, échéances expirées comprises, date croissante. Sources : habilitations et aptitude du
salarié RH pour les personnes ; documents du véhicule de Transport (`insurance`, `inspection`,
`calibration`, `tightness`) pour les véhicules. Profil `rh` : personnes seules (`kind:
vehicle_document` répond 403).

```json
{ "kind": "vehicle_document", "document_kind": "inspection", "subject": { "type": "vehicle", "id": 8, "name": "ER-08" },
  "label": "Visite technique", "expires_on": "2026-10-12", "days_left": -3, "expired": true, "reason_code": "V05",
  "site": { "id": 1, "name": "Parc de Matoto" } }
```

`subject.type` : `driver` (chauffeur lié au salarié), `employee` (salarié sans chauffeur) ou
`vehicle`. Pour une habilitation, `document_kind` porte le code de l'habilitation et `reason_code` vaut
`V04` pour une habilitation obligatoire ou l'aptitude, nul sinon ; `V05` ou `V06` pour un document.

## 4. Cockpit (§3, §10)

### `GET /hsseq/cockpit`

Paramètres : `period` (`month` par défaut, ou `12m`, sinon 400), `month` (`YYYY-MM`, mois courant par
défaut), `company_id`, `site_id`, `vehicle_kind` (`tanker` ou `tipper`, sinon 400).

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

- `series` : douze points, le dernier étant le mois demandé ; pas de cible par mois (proposition, §14).
- `site_scoped` : faux pour le taux de fréquence et le taux de gravité (heures de RH par société, sans
  maille site) ; l'écran le dit. `hours_basis` (`paid` ou `presence`) est le paramètre de la base des
  heures. Aucune saisie d'heures dans HSSEQ.
- `breakdown` : pour `waivers` seulement, couples `{ site, reason_code, count }` (`site` : nom du site,
  « Sans site » à défaut) des dérogations activées de la période ; nul pour les autres indicateurs.
- `met` : nul sans valeur ou sans cible. Pas d'état « sous surveillance » ni de famille servis par le
  noyau : l'écran les calcule (proposition, §14).
- `blocked_departures` : forme `Departures` (§9), `items` limité aux départs bloqués du jour.
- `overdue_actions.items` : `ActionLine`, échéance la plus ancienne d'abord, 8 au plus.
  `deadlines.items` : `Deadline`. `events` : trois nombres, pas de matrice (proposition, §14).
- Calcul quotidien depuis les données d'origine ; un mois est figé au 5 du mois suivant (`frozen`,
  `frozen_on`), sans filtre de site ni de profil ; chaque indicateur porte sa `source` (§10).
- `period=12m` : `value` agrège les douze mois (rapport des sommes).
- `tipper_variance` : toujours nul au lot 1, sans série, avec la note « Sans objet au lot 1 : une seule
  pesée par rotation, pas de tonnage livré. » ; `tanker_shortage` nul sur le profil benne.
  `iso_maturity` reste nul au lot 1 (audits au lot 2).

### Indicateurs (codes fixes)

| `code` | Libellé du noyau (§10) | `unit` | `direction` | Cible proposée | Source |
|---|---|---|---|---|---|
| `frequency_rate` | Taux de fréquence, 12 mois glissants, sans filtre de site | `rate` | down | ≤ 5,00 | Événements, RH |
| `severity_rate` | Taux de gravité, 12 mois glissants, sans filtre de site | `rate` | down | ≤ 0,20 | Événements, RH |
| `road_accidents_per_mkm` | Accidents de la route par million de km, 12 mois glissants | `rate` | down | ≤ 1,50 | Événements, Transport |
| `reporting_ratio` | Taux de déclaration : (presque-accidents + situations dangereuses) ÷ accidents, 12 mois glissants | `ratio` | up | ≥ 10,00 | Événements |
| `check_completion` | Réalisation des contrôles avant départ : départs contrôlés ÷ départs | `pct` | up | 100 % | NIMOVA Terrain, Transport |
| `check_compliance` | Conformité des contrôles | `pct` | up | ≥ 95 % | NIMOVA Terrain |
| `breath_test_completion` | Alcootests réalisés : départs avec un alcootest réalisé ÷ départs | `pct` | up | 100 % | NIMOVA Terrain |
| `breath_test_positives` | Alcootests positifs, sans nom | `count` | down | 0 | NIMOVA Terrain |
| `waivers` | Dérogations au verrou activées ; `breakdown` par site et par motif | `count` | down | ≤ 2 par mois | Verrou de départ |
| `actions_on_time` | Actions dans les délais : réalisées à l'échéance ÷ échues | `pct` | up | ≥ 90 % | Actions |
| `actions_effectiveness` | Efficacité des actions : efficaces à J+90 ÷ vérifiées | `pct` | up | ≥ 80 % | Actions |
| `qualifications_valid` | Habilitations à jour : conducteurs actifs sans habilitation expirée ni absente ÷ conducteurs actifs | `pct` | up | 100 % | Habilitations RH |
| `fuel_consumption` | Consommation, litres aux 100 km | `l_100km` | down | ≤ 44,0 | Transport |
| `co2_emissions` | Émissions de CO₂, kg par km (2,68 kg par litre de gazole) | `kg_co2_km` | down | ≤ 1,18 | Transport |
| `tanker_shortage` | Écarts de livraison des citernes : volume manquant ÷ volume livré | `per_mille` | down | ≤ 1,50 ‰ | Transport |
| `tipper_variance` | Écarts de tonnage des bennes, sans objet au lot 1 | `per_mille` | down | ≤ 5,00 ‰ | Transport |

Cibles paramétrables sans développement par `targets` (§3) ; celles-ci sont la proposition de départ.

## 5. Événements (§3, §7, §9)

Cycle : `reported` (déclaré) → `classified` (classé) → `investigation` (enquête) → `actions` →
`closed` (clôturé).

| Transition | Depuis | Vers | Condition, effet |
|---|---|---|---|
| `classify` | `reported` | `classified` | Corps `EventClassification`. Calcule `criticality` et `level`, fixe `investigation_due` et `client_notice_due`, envoie les notifications du niveau. |
| `investigate` | `classified` | `investigation` | Corps facultatif `{ method, team_ids }` ; méthode par défaut selon le niveau. |
| `plan` | `investigation` | `actions` | Exige `root_cause`, sinon `root_cause_missing` ; l'enquête est conclue (`investigation.closed_at`). |
| `close` | `classified` (niveau `low`, sans action) ou `actions` | `closed` | Toutes les actions closes ou annulées, sinon `actions_open`. |
| `reopen` | `closed` | `actions`, sinon `investigation` ou `classified` | Corps `{ reason }` obligatoire (`reason_required`), gardé dans `reopen_reason`. |

Transition inconnue : 404 ; transition non permise depuis le statut : `invalid_transition`. `close`
n'apparaît dans `transitions` que si aucune action ne reste ouverte.

### `GET /hsseq/events`

Paramètres : `status`, `type`, `domain`, `level` (listes ; `level=unclassified` pour les non classés),
`site_id`, `vehicle_kind`, `vehicle_id`, `rotation_id`, `company_id`, `date_from`, `date_to` (sur
`occurred_at`), `overdue_investigation=1`, `search` (référence, titre, lieu), `sort` (`-occurred_at`
par défaut, `criticality`, `reference`, `status`), `offset`, `limit`.

Réponse `Page<EventLine, EventCounts>` :

```json
{
  "items": [{
    "id": 12, "reference": "EVT/2026/0012", "title": "Citerne immobilisée de nuit sur la chaussée sans balisage",
    "type": "hazard", "domain": "safety", "status": "investigation", "occurred_at": "2026-09-24T21:40:00Z",
    "site": { "id": 1, "name": "Parc de Matoto" },
    "vehicle": { "id": 7, "name": "ER-07", "vehicle_kind": "tanker", "plate": "RC 5178 A" },
    "rotation": { "id": 1031, "name": "ROT/2026/00977", "date_loading": "2026-09-24", "route_name": "Conakry - Siguiri", "state": "done" },
    "actual_severity": 2, "potential_severity": 4, "probability": 3, "criticality": 12, "level": "significant",
    "reported_by": { "id": 12, "name": "Mamadou Bah" }, "open_actions": 0,
    "investigation_due": "2026-10-02T09:00:00Z", "investigation_overdue": true, "total_cost": 0
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
`spill`, `fire`, `security_breach`, `product_quality`, `property_damage` ; `domain` ∈ `safety`,
`health`, `security` (sûreté), `environment`, `quality`. Une rotation (`RotationRef`) porte son
`state` de Transport.

### `GET /hsseq/events/{id}`

`Event` : la ligne, plus `description`, `location`, `latitude`, `longitude`, `gps_accuracy`, `source`
(`web`, `terrain`), `client_uuid`, `reported_at`, `synced_at`, `offline`, `people`, `lost_time`,
`days_lost`, `leave_id` (arrêt RH relié), `vehicle_immobilized` (lu seulement au lot 1),
`classified_at`, `classified_by`, `closed_at`, `closed_by`, `reopen_reason`, `investigation`,
`actions` (`ActionLine`), `costs`, `attachments`, `notifications`, `deadlines` (`investigation_due`,
`client_notice_due`, `client_notified_at`), `history`, `transitions`, `rights`. Pour le conducteur,
`actions`, `costs`, `notifications` et `history` sont vides.

- `people` : `{ id, kind, person_id, name, role, days_off }`. `id` est la ligne de l'événement ;
  `person_id` le chauffeur de Transport (`kind: driver`) ou le salarié RH (`kind: employee`), nul pour
  un tiers (`third_party`) ; `role` ∈ `victim`, `driver`, `witness`, `perpetrator`, `third_party`.
- `investigation` : toujours servie, vide tant qu'elle n'est pas ouverte : `{ method, team (Ref[]),
  immediate_causes (texte), whys, tree, factors_5m (un texte par famille), root_cause, conclusion,
  started_at, closed_at, due }`.
- `costs` : `{ id, kind, label, amount, date, finance_move_id }`.
- `notifications` : `HsseqNotification` (§11), les deux canaux.

### `POST /hsseq/events`

Déclaration du web ou de NIMOVA Terrain, corps `EventReport` : `client_uuid`, `type`, `title`,
`description`, `occurred_at` obligatoires ; `reported_at` (maintenant par défaut), `offline`, `domain`
(déduit du type sinon), `location`, `latitude`, `longitude`, `gps_accuracy`, `site_id` (celui de
l'ensemble sinon), `rotation_id` (un conducteur : ses rotations), `vehicle_id` (celui de la rotation
sinon), `people`, `attachment_ids` (photos déposées avant). Les notes de gravité et de probabilité ne
se reçoivent pas à la déclaration (proposition, §14). Réponse : l'`Event` créé, statut `reported`,
notes nulles. Le Responsable HSSEQ est notifié de toute déclaration.

`people` en entrée : `{ kind, person_id, name, role, days_off }` ; la liste remplace la précédente. Le
noyau lit `id` avant `person_id` comme identifiant de la personne : l'écran n'envoie jamais `id`.
Une personne sans identifiant ni nom répond `missing_fields`.

### `PATCH /hsseq/events/{id}`

Profils `hsseq`, `exploitation`, `conducteur`, selon `can_edit`. Champs de la déclaration et
`people` ; pour `hsseq` seul, aussi `actual_severity`, `potential_severity`, `probability`, `lost_time`,
`days_lost`, `leave_id`, `client_notified_at` (403 pour un autre profil). `vehicle_immobilized` ne
s'écrit pas au lot 1.

### `POST /hsseq/events/{id}/{transition}`

`transition` ∈ `classify`, `investigate`, `plan`, `close`, `reopen`, profil `hsseq`.
`EventClassification` : `potential_severity` et `probability` (1 à 5, exigées si la fiche ne les porte
pas encore, sinon `missing_fields`), `actual_severity`, `type`, `domain`, `lost_time`, `days_lost`
facultatifs ; une note hors de 1 à 5 répond `invalid_parameter`.

### `PUT /hsseq/events/{id}/investigation`

Statut `investigation` requis (`invalid_transition` sinon). Corps `InvestigationInput` : `method`
(`simple_analysis`, `five_whys`, `cause_tree`), `team_ids` (comptes internes des sociétés),
`immediate_causes` (texte), `whys` (cinq au plus), `tree` (faits : `id` texte, `label`, `parent_id`,
`kind` `unusual_fact` ou `permanent_fact`, parent connu), `factors_5m` (`environment`, `equipment`,
`method`, `manpower`, `material` : un texte chacun), `root_cause`, `conclusion`.

### Coûts (§6, exposés à Finance)

`POST /hsseq/events/{id}/costs` : `{ kind, amount }` obligatoires, `label`, `date` (le jour sinon),
`finance_move_id` facultatifs ; `kind` ∈ `claim` (sinistre), `deductible` (franchise), `downtime`
(immobilisation), `product_loss`, `repair`, `other`. `DELETE /hsseq/events/{id}/costs/{cost_id}`.
Événement clôturé : `invalid_transition`.

Toutes les routes d'écriture d'un événement répondent par l'`Event` à jour.

### Rapport et exports (§11)

`GET /hsseq/events/{id}/report.pdf` : rapport d'enquête, rendu par le noyau. `GET
/hsseq/events/export.xlsx` : registre, mêmes filtres que la liste. Le rapport mensuel HSSEQ en PDF
viendra au lot 2.

## 6. Plan d'actions (§3, §9.2)

`status` ∈ `todo`, `in_progress`, `to_verify`, `closed`, `cancelled`. `origin` ∈ `event`, `audit`,
`check`, `risk`, `review` ; `control_level` (hiérarchie des mesures, facultatif) ∈ `elimination`,
`substitution`, `engineering`, `administrative`, `ppe`.

| Transition | Depuis | Qui | Effet, refus |
|---|---|---|---|
| `start` | `todo` | responsable, `hsseq` | → `in_progress` ; `approval_required` pour une action coûteuse non validée. |
| `close` | `in_progress` | responsable, `hsseq` | Exige au moins une pièce de preuve, sinon `proof_required`. Sans vérification requise : `closed`. Avec : `to_verify`, `verification_date` = jour + `verification_days`. |
| `verify` | `to_verify` | `hsseq` | Corps `{ effective, comment, new_due_date? }` (`effective` exigé, sinon `missing_fields`) ; `verification_too_early` avant la date. Efficace : `closed`. Inefficace : retour `in_progress`, `new_due_date` obligatoire (`missing_fields`). |
| `approve` | `todo` (coûteuse, non validée) | `direction` | Validation d'une action dont `estimated_cost` atteint `costly_action_threshold` ; garde `approved_cost`. |
| `cancel` | `todo`, `in_progress`, `to_verify` | `hsseq` | Corps `{ reason }` obligatoire. |
| `reopen` | `closed`, `cancelled` | `hsseq` | Corps `{ reason }` obligatoire ; retour `in_progress`. |

Un nouveau coût estimé annule la validation de la direction ; une action coûteuse déjà démarrée
revient alors `todo`. Relances du responsable à J-7, à J0 puis chaque semaine de retard ; escalade au
Directeur général après `escalation_days` de retard (`reminders` : `{ kind, date, recipients }`, `kind`
∈ `d_minus_7`, `d0`, `weekly`, `escalation`).

- `GET /hsseq/actions` (tout compte interne : les actions dont il est responsable ; lecture
  intégrale pour `admin`, `direction`, `hsseq` ; site et propres pour le chef de parc) : `status`,
  `origin`, `owner_id`, `mine=1`, `overdue=1`, `site_id`, `due_before`, `event_id`, `company_id`,
  `search`, `sort` (`due_date` par défaut, `reference`, `status`, `created_at`) → `Page<ActionLine,
  ActionCounts>` (`by_status`, `overdue`, `verifications_due`).
- `ActionLine` : `id`, `reference`, `description`, `origin`, `origin_id`, `origin_label` (référence et
  titre de l'événement, ou référence du contrôle), `event` (`{ id, reference }`), `control_level`,
  `owner`, `due_date`, `status`, `overdue`, `days_overdue`, `verification_required`,
  `verification_date`, `site`, `estimated_cost`, `approval_required` (coûteuse et pas encore validée).
- `GET /hsseq/actions/{id}` → `HsseqAction` : la ligne, plus `expected_evidence`, `evidence`
  (pièces), `management_approval` (`required`, `approved_at`, `approved_by`, `approved_cost`),
  `created_at`, `created_by`, `started_at`, `done_at`, `verified_at`, `verified_by`, `effective`,
  `verification_comment`, `closed_at`, `cancel_reason`, `reopen_reason`, `reminders`, `history`,
  `transitions`, `rights`.
- `POST /hsseq/actions` (`hsseq`) : `NewAction` ; `description`, `owner_id`, `due_date` obligatoires ;
  `origin` (`event` par défaut), `origin_id` (exigé pour `event` et `check` ; événement clôturé :
  `invalid_transition`), `control_level`, `expected_evidence`, `estimated_cost`. Le responsable est un
  compte interne de la société (`business_rule` sinon).
- `PATCH /hsseq/actions/{id}` : `description`, `control_level`, `expected_evidence` ; `owner_id`,
  `due_date` et `estimated_cost` réservés à `hsseq` (403 sinon).
- `POST /hsseq/actions/{id}/{transition}`. Les preuves sont des pièces jointes (`model: "action"`).
- `GET /hsseq/actions/export.xlsx`. Toutes les écritures répondent par la `HsseqAction` à jour.

## 7. Contrôles et non-conformités (§5)

Grilles paramétrables (ajout, retrait, ordre, caractère bloquant) par `hsseq` et `admin`, une par
nature et par type de véhicule. Au lot 1, contrôle avant départ des citernes et des bennes, avec le
paramétrage initial du §5 : huit points critiques par type, cinq points communs non bloquants. Le
point « alcootest du conducteur négatif » est relié au formulaire d'alcootest (`linked_to:
"breath_test"`) : il ne se répond pas dans le contrôle et relève de V03. Cible : moins de 4 minutes de
saisie (`duration_s`), photo obligatoire sur toute non-conformité. Pas de contre-visa au lot 1.

### Grilles : `/hsseq/checks/templates`

- `GET /hsseq/checks/templates?vehicle_kind=&kind=&active=` (`active` : `1` par défaut, `0` pour les
  grilles retirées, `all` pour toutes) → `CheckTemplate[]` : `id`, `name`, `kind` (`pre_departure`,
  `unloading`, `mine_site`), `vehicle_kind`, `version`, `active`, `items` (`id`, `label`, `blocking`,
  `sequence`, `linked_to`, `active`), `updated_at`, `updated_by`. `admin` et `hsseq` reçoivent aussi
  les points retirés (`active: false`), les autres profils les seuls points en service.
- `POST /hsseq/checks/templates` (`name`, `vehicle_kind` obligatoires, `items` facultatifs) et
  `PATCH /hsseq/checks/templates/{id}` (`hsseq`, `admin`). Le PATCH vaut une seule version : points
  cités par `id` mis à jour, nouveaux créés, absents retirés ; un point retiré s'archive, jamais
  supprimé (un appareil hors ligne peut encore répondre sur sa version). `version` augmente ; un
  contrôle garde les libellés de sa version.

### Contrôles : `/hsseq/checks`

- `GET /hsseq/checks` : `date_from`, `date_to` (sur `reported_at`), `site_id`, `vehicle_kind`,
  `vehicle_id`, `rotation_id`, `driver_id`, `result` (liste : `compliant`, `non_compliant`,
  `blocking`), `company_id`, `sort` (`-reported_at` par défaut, `result`, `reference`), `offset`,
  `limit` → `Page<CheckLine, CheckCounts>`. `counts` : `by_result`, et, hors conducteur, `departures`
  et `departures_checked` (rotations parties, validées ou facturées de la période, mois courant par
  défaut).
- `CheckLine` : `id`, `reference`, `template` (`{ id, name, version }`, la version de la saisie),
  `kind`, `vehicle_kind`, `vehicle`, `rotation`, `driver`, `site`, `author` (compte qui a saisi),
  `reported_at`, `result`, `open_nonconformities`, `photos_missing`.
- `GET /hsseq/checks/{id}` → `Check` : la ligne, plus `client_uuid`, `synced_at`, `offline`,
  `duration_s`, `latitude`, `longitude`, `gps_accuracy`, `answers` (`item_id`, `label`, `blocking`,
  `sequence`, `answer` ∈ `ok`, `not_ok`, `na`, `not_evaluated` pour un point ajouté à la grille après
  la saisie, `comment`, `nonconformity_id`, `photos`), `signature` (pièce jointe de rôle `signature`,
  image PNG ou JPEG, ou nul), `nonconformities`, `attachments`, `history` (vide pour le conducteur),
  `transitions` (`["lift"]` quand une levée est permise), `rights`.
- `POST /hsseq/checks` : `NewCheck` ; `template_id` et `answers` obligatoires ; `vehicle_id` ou
  `rotation_id` (l'ensemble de la rotation, sinon `business_rule` s'ils diffèrent) ; `client_uuid`,
  `template_version` (version en cache sur l'appareil, la courante par défaut), `driver_id`,
  `reported_at`, `offline`, `duration_s`, `latitude`, `longitude`, `gps_accuracy`, `answers`
  (`item_id`, `answer` ∈ `ok`, `not_ok`, `na`, `comment`, `attachment_ids`), `attachment_ids`,
  `signature` (image PNG ou JPEG en base64, `data:image/png;base64,…` accepté, 512 Ko au plus, sinon
  415 `unsupported_type`). `result` : `blocking` dès qu'un point bloquant est `not_ok`,
  `non_compliant` (avec réserves) pour un point non bloquant, `compliant` sinon. Chaque réponse
  `not_ok` ouvre une non-conformité ; les photos citées d'un point s'y rattachent.
- Rattachement à la rotation : voir §9, « Rattachement automatique ».
- Photos : le noyau accepte le contrôle sans ses photos. Chaque non-conformité porte `photos_missing`
  tant qu'aucune pièce n'y est rattachée, et le contrôle aussi tant qu'il en reste une. Une
  non-conformité bloquante compte pour V02 avec ou sans photo.

### Non-conformités

- `GET /hsseq/checks/nonconformities` : `status` (liste : `open`, `lifted`), `blocking=1`, `site_id`,
  `vehicle_id`, `company_id`, `sort` (`-found_at` par défaut), `offset`, `limit` →
  `Page<Nonconformity>` (`counts` : `open`, `blocking_open`). Une non-conformité : `id`, `check`,
  `item` (`id`, `label`, `blocking`), `vehicle`, `rotation`, `site`, `found_at`, `comment`, `photos`,
  `photos_missing`, `status`, `lifted_at`, `lifted_by`, `lift_comment`, `lift_photos`, `action`
  (`{ id, name }`, `name` étant la référence de l'action), `rights`.
- `POST /hsseq/checks/{id}/lift` (`{id}` : le contrôle) : `{ nonconformity_id, comment?,
  attachment_ids }`. La levée exige au moins une photo citée, déposée sur la non-conformité
  (`model: "nonconformity"`), sinon `photo_missing` ; une pièce d'une autre fiche répond
  `invalid_parameter`. Les pièces citées passent au rôle `lift`. Lève V02 quand il ne reste aucune
  non-conformité bloquante ouverte sur le véhicule. Réponse : le `Check` à jour.

## 8. Alcootests : `/hsseq/breath-tests` (§4 V03, §9.4)

- `POST /hsseq/breath-tests` : `NewBreathTest` (`client_uuid`, `rotation_id` facultatif, `driver_id`
  (le conducteur de la rotation par défaut), `performed`, `result` (`negative`, `positive`) exigé si
  réalisé, `reading_mg_l`, `device`, `not_done_reason` exigé sinon, `reported_at`, `offline`). Un
  conducteur ne saisit que pour lui-même. La rotation doit être saisie (`invalid_transition` sinon). Un
  positif retire le conducteur de la rotation encore saisie (`driver_removed`) : Transport doit en
  affecter un autre.
- `GET /hsseq/breath-tests` (le conducteur : ses seuls tests, sans filtre de statut) : `date`,
  `date_from`, `date_to`, `rotation_id`, `driver_id`, `status` (liste), `site_id`, `company_id`,
  `cancelled=1` (`hsseq` : les tests annulés), `sort` (`-reported_at` par défaut, `date`), `offset`,
  `limit` → `Page<BreathTest>` ; `counts` : `{ by_status }` (vide pour le conducteur).
- `GET /hsseq/breath-tests/{id}` → `BreathTest`.
- `POST /hsseq/breath-tests/{id}/cancel` (`hsseq`) : `{ reason }` obligatoire (`reason_required`) ;
  test déjà annulé : `invalid_transition`. Le test annulé sort du verrou et des indicateurs ; un
  conducteur retiré par lui est rétabli sur la rotation encore saisie qui n'en a pas reçu d'autre.
- Réponses selon le profil : `BreathTestDone` (`access: "done"` : `id`, `rotation`, `driver`, `done`,
  `done_at`) ; `BreathTestStatus` (`access: "status"` : `id`, `rotation`, `driver`, `date`, `status`) ;
  `BreathTestDetail` (`access: "detail"`, en plus `performed`, `result`, `reading_mg_l`, `device`,
  `not_done_reason`, `performed_by`, `driver_removed`, `client_uuid`, `reported_at`, `synced_at`,
  `offline`, `cancelled`, `cancel_reason`, `cancelled_by`, `cancelled_at`) pour `hsseq` seul.

## 9. Verrou de départ : `/hsseq/lock` (§4)

Évaluation côté serveur, sans contournement possible depuis un client (§4, §11). Côté Transport :
état `en_route` de la rotation, posé par `action_depart` (`POST /transport/rotations/{id}/depart`),
qui appelle l'évaluation dans la même transaction. Le verrou ne vaut que pour une rotation chargée à
partir de sa mise en service (`lock_start_date` des réglages, §3) : avant, `lock_active` est faux, le
départ est toujours permis et les motifs s'affichent pour information. En service, une rotation ne se
valide qu'après son passage « en route » (refus `validation_blocked`, motif H01).

Départ (route de Transport) : ouvert aux profils qui écrivent les rotations (`admin`, `finance`,
`exploitation`) ; verrou en service, réservé au chef de parc des sites de la rotation (403 sinon).
Un refus répond 422 `departure_blocked` avec `blockers` : `{ code, label, source, since, waivable,
severity }`, motifs bloquants non couverts et avertissements ; les motifs propres à Transport (T01) y
figurent aussi. Une rotation qui n'est pas saisie répond 422 `business_rule`. La fiche de la rotation
(`GET /transport/rotations/{id}`) et la réponse de ses actions portent `departure_blockers` (nul dans
la liste) ; la trace du départ est dans `departed_at` et `departed_by`.

### `POST /hsseq/lock/evaluate`

Entrée `{ "rotation_id": 1127 }`. Sortie `LockEvaluation` :

```json
{
  "rotation_id": 1127,
  "allowed": false,
  "lock_active": true,
  "reasons": [{
    "code": "V02", "label": "Point critique du contrôle avant départ non conforme", "source": "NIMOVA Terrain",
    "since": "2026-10-15T06:05:00Z", "waivable": true, "detail": "Plaques et étiquettes de danger en place",
    "resolution": "Chef de parc après correction, photo obligatoire", "severity": "block", "pending": false, "waiver_id": null
  }],
  "warnings": [{
    "code": "V05", "label": "Document du véhicule expiré (assurance, visite technique)", "source": "Transport, fiche véhicule",
    "since": null, "waivable": true, "detail": "visite technique non renseignée", "resolution": "Responsable maintenance",
    "severity": "warn", "pending": false, "waiver_id": null
  }],
  "active_waiver": null,
  "active_waivers": [],
  "pending_checks_only": false,
  "checked_at": "2026-10-15T07:31:12Z"
}
```

| Code | Ouvert quand (lot 1) |
|---|---|
| V01 | Aucun contrôle avant départ rattaché à la rotation (rattachement automatique ci-dessous). |
| V02 | Une non-conformité d'un point bloquant reste ouverte sur le véhicule, d'une rotation à l'autre. |
| V03 | Aucun conducteur affecté, aucun alcootest du conducteur, un test non réalisé, ou un positif (le conducteur est alors retiré de la rotation) ; `detail` nul hors `hsseq`. |
| V04 | Statut RH du conducteur : habilitation obligatoire expirée, aptitude inapte ou échue ; habilitation absente ou chauffeur sans dossier salarié, bloquants après leur date de mise en service, avertissements avant. |
| V05 | Assurance (`insurance`) ou visite technique (`inspection`) expirée ; absente, bloquante après `documents_required_from`, avertissement avant. |

`severity` : `block` dans `reasons`, `warn` dans `warnings` ; un même code peut figurer dans les deux
(V04, V05). Un avertissement est affiché et transmis à Transport mais n'empêche jamais le départ.
`since` est nul quand le noyau ne date pas le motif.

`pending` : vrai pour un motif qui se lève par une saisie de terrain encore à faire, V01 et V03 non
fait ou non réalisé ; faux pour V02, V03 positif, V04 et V05. `pending_checks_only` : vrai quand toutes
les reasons bloquantes ouvertes (au moins une) sont `pending`.

`allowed` est vrai quand le verrou n'est pas en service, ou quand aucun motif `block` n'est ouvert, ou
quand chacun est couvert par une dérogation active de la rotation (`waiver_id`). Une dérogation couvre
un seul motif ; `active_waivers` (`id`, `reason_code`, `expires`) liste celles de la rotation,
`active_waiver` (la première, avec `approved_by`) reste servie pour compatibilité. Chaque évaluation
demandée est journalisée.

### Rattachement automatique

Le contrôle avant départ (`vehicle_id` toujours requis) et l'alcootest sont acceptés sans
`rotation_id`. À l'évaluation demandée et au départ, le noyau rattache à la rotation saisie, si elle
n'en a pas encore :

- le dernier contrôle avant départ de son véhicule saisi sans rotation dans la fenêtre
  `check_window_hours` (12 h par défaut) ;
- le dernier alcootest de son conducteur saisi sans rotation dans la fenêtre
  `breath_test_window_hours` (4 h par défaut), un positif l'emportant sur un test ultérieur.

Pas de double rattachement ; le rattachement est journalisé ; la fiche porte ensuite sa `rotation`.

### `GET /hsseq/me/rotations`

`date` (aujourd'hui par défaut), `company_id`. Lecture : `conducteur` (ses rotations), `exploitation`
(rotations de ses sites), `hsseq` et `admin` (toutes). Rotations du jour à l'état `draft` ou
`en_route`. Réponse `{ date, items: MyRotation[] }` :

```json
{ "date": "2026-10-15", "items": [{
  "id": 1129, "name": null, "date_loading": "2026-10-15", "state": "draft",
  "vehicle": { "id": 9, "name": "ER-09", "vehicle_kind": "tanker", "plate": "RC 9021 A" },
  "site": { "id": 1, "name": "Parc de Matoto" }, "driver": { "id": 9, "name": "Ibrahima Kouyaté" }, "route_name": "Conakry - Kindia",
  "lock": { "allowed": false, "pending_checks_only": true, "reasons": [], "warnings": [], "lock_active": true }
}] }
```

`lock` est nul pour une rotation en route.

### `GET /hsseq/lock/departures`

`date` (aujourd'hui par défaut), `site_id`, `vehicle_kind`, `company_id`, `blocked=1` → `Departures`
(`date`, `total`, `allowed`, `blocked`, `items` : `rotation`, `vehicle`, `driver`, `site`,
`evaluation`, `pending_checks_only`). Un départ du jour : rotation à charger ce jour-là, encore saisie.
`pending_checks_only` : l'écran affiche « À contrôler » au lieu de « Bloqué ».

### `/hsseq/lock/reasons`

`GET` → `ReasonSetting[]` (`code`, `label`, `source`, `resolution`, `vehicle_kinds`, `waivable`, `lot`,
`active`, `disabled_sites` : `Ref[]`). `PATCH` (`hsseq`, `admin`) : `{ code, active?, vehicle_kinds?,
disabled_sites? }` (identifiants de sites), activation par type de véhicule et par site (§4.2). Un
motif du lot 2 ne s'active pas (`not_in_lot_1`) ; `waivable` ne se modifie pas (`business_rule`) ; V01
et V03 restent non dérogeables.

## 10. Dérogations : `/hsseq/waivers` (§4.1)

Une rotation, un seul motif, une justification écrite. Seul un chef de parc (`exploitation`, site de
la rotation) la demande, et sa demande vaut première validation ; la seconde est donnée par un compte
`hsseq`, forcément une autre personne (`four_eyes`, aussi pour le refus). Le profil `hsseq` ne demande
pas. Expire à la fin de la rotation (validée, facturée ou annulée) ou à sa fin prévue ; journalisée,
notifiée au Directeur général à l'activation, comptée dans les indicateurs. Jamais sur V01 ni V03
(`not_waivable`).

`status` : `pending_hsseq` (attente du Responsable HSSEQ) → `active` → `expired` ; ou `refused`,
`cancelled`.

- `GET /hsseq/waivers` : `status` (liste), `rotation_id`, `site_id`, `reason_code`, `date_from`,
  `date_to`, `company_id`, `sort` (`-requested_at` par défaut, `status`, `reference`), `offset`,
  `limit` → `Page<Waiver>` (`counts` : `{ by_status }`).
- `GET /hsseq/waivers/{id}` → `Waiver` : `id`, `reference`, `rotation`, `vehicle`, `site`,
  `reason_code`, `reason_label`, `justification`, `requested_by`, `requested_at`, `approvals` (`level`
  1 ou 2, `role` `yard_manager` ou `hsseq_manager`, `by`, `at` ; le niveau 1 est la demande), `status`,
  `expires` (fin prévue de la rotation : son retour, sinon son chargement plus la durée de sa route,
  en fin de journée), `expired_at`, `refusal_reason`, `decided_by` (refus ou annulation),
  `management_notified_at`, `attachments`, `history`, `transitions`, `rights`.
- `POST /hsseq/waivers` (`exploitation`) : `{ rotation_id, reason_code, justification }`. Refus
  `not_waivable` (V01, V03), `reason_required` (justification vide), `invalid_transition` (rotation
  partie), `reason_not_open`, 409 `conflict` (demande en cours ou active pour la même rotation et le même
  motif). Le Responsable HSSEQ est notifié.
- `POST /hsseq/waivers/{id}/approve` (`hsseq`) : seconde validation ; `four_eyes` si le valideur a déjà
  validé ; rotation terminée : `invalid_transition`. Statut `active`, `expires` posé, notification du
  Directeur général (`management_notified_at`).
- `POST /hsseq/waivers/{id}/refuse` (`hsseq`) : `{ reason }` obligatoire.
- `POST /hsseq/waivers/{id}/cancel` : demandeur ou `hsseq`, avant expiration.
- Toutes répondent par le `Waiver` à jour.

## 11. Pièces jointes, notifications, espace du compte, journal

### `/hsseq/attachments`

- `POST /hsseq/attachments` (multipart) : `file` obligatoire ; `model` (`event`, `action`, `check`,
  `nonconformity`, `waiver`) et `id` de la fiche, ou rien : la pièce est alors déposée sans fiche, par un
  compte des profils de l'application, et se cite ensuite par `attachment_ids` (déposant seul, une seule
  fois, 409 `conflict` si elle est rattachée ailleurs ; purgée au bout de sept jours si jamais citée).
  `caption`, `client_uuid` (idempotence), `role` (`lift` pour une photo de correction sur une
  non-conformité ouverte) facultatifs. Ajout sur une fiche : son auteur ou responsable, le chef de parc
  du site, ou `hsseq` ; fiche close : 403 ; 30 pièces au plus par fiche (`business_rule`). Formats
  contrôlés par `eguitra_api/files.py` (JPEG, PNG, PDF ; signature du contenu), 8 Mo au plus. Réponse
  `Attachment` : `id`, `name`, `mimetype`, `size`, `is_photo`, `caption`, `role` (`photo`, `lift`,
  `evidence`, `signature`, `document`), `model`, `res_id`, `created_at`, `created_by`, `url`.
- `GET /hsseq/attachments/{id}/download` : le fichier, aux droits de la fiche (au déposant seul pour une
  pièce pas encore citée).
- `DELETE /hsseq/attachments/{id}` : auteur ou `hsseq`, tant que la fiche n'est pas close ; une photo
  de levée ou la preuve d'une action à vérifier est conservée (`invalid_transition`).

### Notifications : `/hsseq/notifications`

Tout compte interne, ses propres notifications dans l'application. `GET /hsseq/notifications?unread=1`
→ `Page<HsseqNotification>` (`counts` : `unread`), tri `-id` par défaut. `POST
/hsseq/notifications/{id}/read` → la notification, lue. `HsseqNotification` : `id`, `kind`
(`reported`, `significant`, `high`, `waiver_requested`, `waiver_active`, relances et escalade d'une
action), `channel` (`app`, `email`), `subject`, `body`, `model`, `res_id`, `to`, `sent_at`, `read_at`.
La fiche d'un événement sert ses notifications des deux canaux.

### Espace du compte : `GET /hsseq/me`

Tout compte interne relié à un salarié RH et à un chauffeur : `{ employee (id, name, matricule),
driver, fitness (fit, review, unfit), qualifications (code, name, mandatory, state, expiry), rotations
}` ; `rotations` : les rotations saisies du jour et celles en route du chauffeur (`RotationRef`, plus
`vehicle` et `lock`, l'évaluation du verrou, nulle en route). Sans salarié lié : `employee` et
`driver` nuls, listes vides.

### `GET /hsseq/log`

`model` (`event`, `action`, `check`, `nonconformity`, `breath_test`, `waiver`), `id`, `date_from`,
`date_to`, `company_id`, `sort` (`-at` par défaut), `offset`, `limit` → `Page<HistoryEntry>`.
`HistoryEntry` (journal et historique d'une fiche) : `id` (l'entrée), `model`, `res_id` (la fiche),
`at`, `by`, `action`, `field`, `old_value`, `new_value`, `note`. Lecture `direction` et `hsseq` (`admin`
par la direction qu'il implique). Comprend les lectures du détail des alcootests ; jamais leur
résultat ni leur valeur.

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
6. `admin` paramètre grilles, motifs, sites et réglages ; il ne lit jamais le détail des alcootests
   (§2).
7. Dérogation : seul un chef de parc la demande et sa demande vaut première validation ; seconde par un
   compte `hsseq`, autre personne ; `hsseq` ne demande pas (§10).
8. Action coûteuse : seuil paramétré, 50 000 000 GNF par défaut ; validation de la direction avant le
   démarrage (§6).
9. Pas de contre-visa du contrôle au lot 1 : `can_approve` d'un contrôle toujours faux ; le chef de
   parc lève les non-conformités (§2, §7).
10. V02 : toute non-conformité bloquante encore ouverte sur le véhicule, d'une rotation à l'autre (§9).
11. Action inefficace à J+90 : retour `in_progress` avec nouvelle échéance (§6).
12. `error` porte le code précis, message en français (§1).
13. Courriel par le serveur de courrier de la plateforme ; pas de SMS au lot 1 (option à chiffrer,
    fournisseur à choisir) (§3).
14. PDF rendus par le noyau, comme la lettre de relance : rapport d'enquête au lot 1, rapport mensuel
    au lot 2 (§5).
15. Noms retenus : `/hsseq/lock/departures`, `/hsseq/lock/reasons`, `/hsseq/attachments`,
    `/hsseq/referentials`, `/hsseq/deadlines`, `/hsseq/checks/nonconformities`,
    `/hsseq/waivers/{id}/cancel`, `/hsseq/log?model&id`. Pas de `/hsseq/sync` au lot 1 : les envois
    idempotents par `client_uuid` suffisent.

Horodatage : `reported_at` (saisie) et `synced_at` (posé par le serveur).

### Réponses aux derniers points (25/10)

1. `severity` vaut `block` ou `warn`, rien d'autre ; T01 de Transport est `block` (§9). Précisé le
   26/10 : les avertissements HSSEQ arrivent dans `warnings` (§13).
2. Photos : le noyau accepte le contrôle sans ses photos ; `photos_missing` sur la non-conformité et
   sur le contrôle ; une non-conformité bloquante compte pour V02 avec ou sans photo ; la levée exige une
   photo (`photo_missing`) (§7).
3. Sites : `GET /hsseq/sites` pour tous les profils de l'application ; écriture pour `admin` et
   `hsseq` ; entrée de menu « Paramètres » réservée à `admin` et `hsseq` (§2, §3).
4. Codes d'erreur : la liste du §1 est retenue, complétée le 26/10 (§13).

### Harmonisations des maquettes de terrain (25/10)

1. Alcootest : le profil `conducteur` ne lit que `done` et l'heure, sans résultat ; le statut de
   conformité pour `exploitation` (et la lecture intégrale de `direction` et `admin`) ; le détail
   chiffré pour `hsseq` seul (§2, §8).
2. Ton de criticité à l'écran : « Élevée » en alerte, « Significative » à surveiller, « Modérée » et
   « Faible » neutres.
3. Libellés affichés et libellés du noyau : « presque-accident », « contrôle avant départ » ; les clés de
   l'API ne changent pas.
4. `pending` sur chaque reason (V01 et V03 non faits) et `pending_checks_only` sur chaque départ (§9).
5. Position GPS à plat : `latitude`, `longitude`, `gps_accuracy` (mètres) (§1, §5, §7).

### Ajouts de la session Mobile App (25/10)

1. `GET /hsseq/me/rotations?date=` : rotations du jour (`draft`, `en_route`) avec leur verrou, pour
   `conducteur`, `exploitation` (ses sites), `hsseq` et `admin` (§2, §9).
2. Le conducteur ne fait pas partir une rotation (§2, §9).
3. Contrôle avant départ et alcootest acceptés sans `rotation_id`, rattachés automatiquement au
   verrou et au départ dans des fenêtres paramétrables (12 h pour le contrôle du véhicule, 4 h pour
   l'alcootest du conducteur), sans double rattachement (§7, §8, §9).

## 13. Écarts du noyau (26/10)

Relevés dans le code du noyau (branche `hsseq`, contrôleurs et modèles de `eguitra_hsseq`) et reportés
dans les sections, les types, la maquette et les écrans.

1. Verrou : `lock_active` en plus ; `allowed` reste vrai tant que le verrou n'est pas en service pour
   la rotation (`lock_start_date` des réglages). Les avertissements arrivent dans `warnings`, à part
   des `reasons` (qui ne portent que des `block`) ; un même code peut être dans les deux. `active_waivers`
   liste les dérogations actives (une par motif), `active_waiver` reste pour compatibilité ;
   `pending_checks_only` est servi aussi par l'évaluation. `since` et `resolution` peuvent être nuls.
   V03 couvre aussi la rotation sans conducteur. V04 suit le statut RH (dates de mise en service), V05
   l'absence d'un document. Les écrans affichent « Verrou pas encore en service », les avertissements à
   part, sans bloquer, et plusieurs dérogations actives (§9).
2. Départ (session Transport) : `POST /transport/rotations/{id}/depart`, verrou en service ou non,
   revient au chef de parc (`exploitation`, sites de la rotation) et à `admin`, jamais à `finance`, à
   `direction` ni au conducteur (règle du noyau du 26/10, route Transport alignée) ; les écrans ne
   montrent « Faire partir » qu'à ces deux profils.
   Une rotation qui n'est pas saisie répond `business_rule`. `departure_blockers` est lu dans la fiche et
   dans la réponse des actions, nul dans la liste ; la trace est dans `departed_at` et `departed_by`.
   Validation avant départ refusée par `validation_blocked` (H01) (§9).
3. Codes d'erreur en plus : `missing_fields` et `invalid_parameter` (400), `invalid_json` (400),
   `not_found` (404), `conflict` (409 : `client_uuid` d'un autre compte, dérogation déjà demandée, pièce
   déjà rattachée), `too_large` (413), `business_rule` (422) (§1).
4. Personnes d'un événement : `id` est la ligne, `person_id` le chauffeur ou le salarié ; en entrée,
   le noyau lit `id` avant `person_id` (§5).
5. Signature d'un contrôle : image PNG ou JPEG en base64 à la saisie, servie comme pièce jointe de rôle
   `signature` (§7). `template_version` sur chaque contrôle, dans `template.version` (§7).
6. `expires` d'une dérogation : fin prévue de la rotation ; `expired_at`, `decided_by`, `attachments`,
   `history` en plus ; une dérogation couvre un seul motif (§10).
7. `admin` comprend les droits de direction (lecture de `/hsseq/log`, validation d'une action
   coûteuse), jamais le détail d'un alcootest (§2).
8. `tipper_variance` toujours nul au lot 1, avec sa note ; `breakdown` en couples `{ site,
   reason_code, count }` ; libellés et formules du noyau ; cibles des réglages (§4).
9. Routes nouvelles : `GET /hsseq/me`, `GET /hsseq/notifications`, `POST
   /hsseq/notifications/{id}/read`, `GET` et `PATCH /hsseq/settings` (`admin`, `hsseq` : dates de mise
   en service, seuils, délais, cibles, destinataire de la direction ; onglet « Réglages » des
   Paramètres), `POST /hsseq/breath-tests/{id}/cancel` (`hsseq`, motif obligatoire : bouton « Annuler
   l'alcootest » de la vue Alcootests, tests annulés lus par `cancelled=1`) (§3, §8, §11).
10. Formes alignées : `RotationRef.state` ; `Attachment.role`, `model`, `res_id` ; `HistoryEntry` avec
    `id`, `model`, `res_id`, `note` ; seuils avec `investigation_hours` ; référentiels avec
    `vehicle_kinds`, sites avec `vehicle_ids` ; échéances avec `subject.type` `driver`, `employee` ou
    `vehicle` et `reason_code` nul pour une habilitation facultative ; enquête toujours servie, causes
    immédiates et 5M en texte, faits de l'arbre à identifiant texte ; coûts avec `finance_move_id` ;
    notifications au format `HsseqNotification` ; `ActionLine` avec `origin_label`, `event`,
    `estimated_cost`, `approval_required` (sans `origin_ref` ni `effective`) ; `CheckLine` avec
    `author`, `open_nonconformities`, `photos_missing` ; comptes `by_status` des alcootests et des
    dérogations ; motifs paramétrés avec `disabled_sites` en `Ref[]` ; `GET /hsseq/me/rotations` répond
    `{ date, items }` (§3 à §11).
11. Entrées assouplies : `reported_at` et `offline` facultatifs à la déclaration ; `comment` facultatif
    à la levée ; `label` et `date` facultatifs pour un coût ; `control_level` et `expected_evidence`
    facultatifs pour une action ; `vehicle_immobilized` ne s'écrit pas (§5, §6, §7).
12. Règles du noyau : clôture d'une action depuis `in_progress` seulement ; un nouveau coût estimé
    annule la validation de la direction ; `four_eyes` aussi au refus ; grilles : un point absent du
    PATCH s'archive (§6, §7, §10).

## 14. Propositions des écrans

Champs que les écrans réclamaient, comparés au code du noyau.

Déjà servis, écrans branchés dessus : `photos_missing` sur la ligne d'un contrôle ; `approval_required`
sur la ligne d'une action (l'« approval_pending » des écrans) ; comptes des alcootests
(`counts.by_status`) ; tri des contrôles (`sort` : `reported_at`, `result`, `reference`).

Manquants, proposés à la session OTHER. Réponse du noyau (26/10) : tous retenus et servis avec le
lot 2 (`hsseq@4c505ab`), sauf la correction d'un contrôle (refusée : pas de `PATCH /hsseq/checks/{id}`,
`can_edit` d'un contrôle toujours faux). `GET /hsseq/rotations` est borné aux sites du lecteur. Les
écrans sont branchés dessus (§15).

| Proposition | Route ou clé | Profil | Pourquoi |
|---|---|---|---|
| État d'un indicateur | `indicators[].status` (`met`, `watch`, `missed`, `no_data`) | cockpit | L'état « sous surveillance » (cible tenue sur la période, manquée sur un mois) est calculé à l'écran ; le noyau le fixerait une fois pour le cockpit, le comité et le rapport mensuel. |
| Cible par mois | `indicators[].series[].target` | cockpit | Le prévu du comité ramène à l'écran la cible d'un nombre sur 12 mois au mois ; une cible datée suivrait les changements de `targets`. |
| Famille d'un indicateur | `indicators[].family` (`proactive`, `reactive`) | cockpit | Classement du comité des donneurs d'ordre, aujourd'hui figé à l'écran. |
| Matrice des événements | `events.matrix` (`{ potential_severity, probability, count }[]`) dans `GET /hsseq/cockpit` | cockpit | L'écran compte la matrice sur `GET /hsseq/events?limit=500` : au-delà, elle est tronquée. |
| Rotations d'un véhicule à une date | `GET /hsseq/rotations?vehicle_id&date` (tous états) | déclarants (`admin`, `direction`, `hsseq`, `exploitation`, `conducteur`) | Rattacher un événement à une rotation déjà partie ou terminée ; `/hsseq/me/rotations` ne sert que le jour et n'est pas ouvert à `direction`. |
| Notes du déclarant | `actual_severity`, `potential_severity`, `probability` à `POST /hsseq/events`, gardées à part du classement | déclarants | L'écran fait estimer la criticité au déclarant ; le noyau les ignore aujourd'hui. |
| Liste des salariés | `employees: [{ id, name, site_id }]` dans `GET /hsseq/referentials` | déclarants hors conducteur | Une personne `employee` exige l'identifiant du salarié RH ; l'écran ne peut que la nommer librement. |
| Lecture de `person_id` d'abord | `people[]` en entrée : `person_id` avant `id` | déclarants | Une fiche relue puis renvoyée avec `id` (la ligne) désignerait une autre personne. |
| ~~Correction d'un contrôle~~ (refusée) | ~~`PATCH /hsseq/checks/{id}`~~ | `hsseq` | Refusée par le noyau : un contrôle ne se corrige pas, `can_edit` vaut toujours faux. |
| Filtre de profil | `vehicle_kind` sur `GET /hsseq/checks/nonconformities` et `GET /hsseq/breath-tests` | lecteurs de ces listes | Les vues Non-conformités et Alcootests ne se filtrent pas par citerne ou benne, contrairement aux contrôles. |
| Non-conformités bloquantes ouvertes | `open_blocking` sur `CheckLine` | lecteurs des contrôles | Marquer V02 dans la liste ; `open_nonconformities` ne dit pas si elles sont bloquantes. |
| Résultat de la vérification | `effective` sur `ActionLine` | lecteurs des actions | Marquer « Non efficace » dans le plan et dans la fiche d'un événement sans ouvrir chaque action. |

## 15. Lot 2 et compléments servis (26/10, `hsseq@98da669`)

Le noyau du lot 2 est figé à `hsseq@98da669` : la session OTHER ne change plus ni forme, ni route, ni
droit sans prévenir. Les écrans lisent son code ; la maquette (`docs/design/maquette-api/`) l'imite,
avec un module par domaine (`hsseq-risques.mjs`, `hsseq-conformite.mjs`, `hsseq-habilitations-rapports.mjs`,
`hsseq-trajets.mjs`).

### Compléments du lot 1, branchés

| Clé ou route | Écran |
|---|---|
| `indicators[].status` (`met`, `watch`, `missed`, `no_data`), `family`, `series[].target` et `series[].status` | Cockpit : sceau des indicateurs, comité (familles, état de chaque mois) ; plus aucun état calculé à l'écran. Sous surveillance : à moins de 15 % de la cible, ou tenue sur 12 mois mais manquée le dernier mois. |
| `events.matrix` (`potential_severity`), `matrix_unclassified` | Cockpit : matrice de la période (le mois ou 12 mois), sans relire la liste des événements. |
| `waivers_by_reason` | Cockpit : dérogations par motif, V06 à V09 compris. |
| `risks`, `audits`, `findings`, `requirements`, `immobilizations`, `iso_maturity` | Cockpit : section « Risques et conformité ». `requirements` et `iso_maturity` nuls pour le chef de parc. |
| `GET /hsseq/rotations?date=&vehicle_id=` (`{ date, items }`) | Déclaration : rotations du jour de l'événement, même parties ou terminées. |
| `declared` et notes à `POST /hsseq/events` | Déclaration (notes enregistrées) ; classement (« Estimation du déclarant »). |
| `referentials.employees` (`site_id`, `site`) | Déclaration : un salarié se choisit dans la liste, ceux du site d'abord. |
| `open_blocking`, `complement_of`, `awaiting_items`, `complements`, résultat `incomplete`, transitions `complement` | Contrôles : tampon « bloquantes », filtre « Incomplets », fiche (contrôle complémentaire, points en attente). Le contrôle complémentaire se saisit dans NIMOVA Terrain. |
| `vehicle_kind` sur les non-conformités et les alcootests | Filtre « Profil » des deux listes. |
| `effective`, `approval_pending` sur `ActionLine`, filtre `approval_pending=1` | Plan d'actions : tampons « Efficace », « Non efficace », « À valider » ; bascule « À valider par la direction ». |
| Motifs V06 à V09 (lot courant : 2) | Paramètres : livrés désactivés, ils s'activent par type de véhicule et par site. |

### Écrans du lot 2

| Écran | Routes | Lecture | Écriture |
|---|---|---|---|
| Registre des risques `/hsseq/risques` | `/hsseq/risks` (+ `/{id}`, `/matrix`, `/{id}/measures`, transitions `activate`, `review`, `archive`, `reactivate`, `export.xlsx`) | administration, direction, hsseq ; chef de parc et auditeur pour leurs sites ; tout compte interne pour ses risques | hsseq ; le propriétaire d'un risque (mesures, revue) |
| Audits et conformité `/hsseq/conformite` | `/hsseq/audits`, `/hsseq/findings`, `/hsseq/requirements` (+ revue) | audits et constats : administration, direction, hsseq, chef de parc, auditeur ; exigences : sans le chef de parc | hsseq |
| Habilitations `/hsseq/habilitations` | `/hsseq/qualifications`, `/hsseq/qualifications/alerts` | matrice : administration, direction, hsseq, RH, chef de parc ; alertes : sans le chef de parc | RH, dans son application |
| Rapport mensuel `/hsseq/rapports` | `/hsseq/reports/keys`, `/templates`, `?template_id=`, `/{modèle}/{AAAA-MM}` (+ `report.xlsx`, `report.pdf`) | administration, direction, hsseq | hsseq ; modèles : administration et hsseq |
| Immobilisations `/hsseq/immobilisations` | `GET /hsseq/immobilizations`, `POST /hsseq/events/{id}/immobilize`, `POST /hsseq/vehicles/{id}/release` | administration, direction, hsseq, chef de parc, auditeur | hsseq |
| Plan de trajet et repesée (panneau de départ, Transport) | `GET`, `PUT /hsseq/rotations/{id}/journey`, `POST …/journey/validate`, `POST /hsseq/rotations/{id}/reweigh` | lecteurs du départ | chef de parc |
| Paramètres : itinéraires, modèles de rapport, auditeurs | `GET`, `PATCH /hsseq/routes` ; `/hsseq/reports/templates` ; `GET`, `PATCH /hsseq/auditors` | administration, hsseq | administration, hsseq |

### Auditeur externe

Profil `auditeur` : lecture seule (403 sur toute écriture), bornée à ses sites et à sa date de fin
d'accès (403 au-delà, sans date ou sans site). Les noms des personnes ne lui sont pas servis
(déclarant, auteur d'un contrôle, personnes d'un événement, conducteurs des départs bloqués,
échéances des personnes, liste des conducteurs). Son menu : cockpit, événements, plan d'actions,
registre des risques, contrôles (sans les alcootests), dérogations, immobilisations, audits et
conformité. Sa durée et ses sites se fixent dans « Paramètres › Auditeurs ».

### Manques relevés en branchant le lot 2 (transmis à la session OTHER le 26/10)

Registre des risques :
- `counts.by_status` de `GET /hsseq/risks` ignore les filtres (sauf la société), contrairement au §1.
- Pas de filtre par case de matrice (`raw_severity`, `raw_probability`, `residual_severity`,
  `residual_probability`) : l'écran borne la case à l'écran, sur 500 risques au plus.
- `vehicle_kind` et `site_id` écartent les risques « tous profils » ou « tous sites ».
- Pas de filtre `risk_id` sur `GET /hsseq/actions` (comme `event_id`).
- `history` du plus récent au plus ancien, l'inverse du lot 1 : l'écran trie lui-même.
- Délai de revue (`risk_review_months`) non servi dans les référentiels.

Audits et conformité :
- Pas d'objet « revue de direction » (date, participants, éléments d'entrée, décisions, compte rendu),
  pourtant dans la spécification de `/hsseq/conformite` : l'écran en montre les éléments d'entrée et
  les actions d'origine « review ».
- Pas de liste des clients pour le profil hsseq (`partner_id` des audits, exigences, modèles de
  rapport) : `/finance/partners` lui est fermé. Proposition : `clients` dans les référentiels HSSEQ.
- Export des audits : la feuille des exigences reprend `status` et `standard` de la liste des audits.
- Fiche d'un constat sans `history` ni statut de son audit (proposition : `audit: { id, reference, status }`).
- Pas de compte des revues en retard (exigences) ni des audits planifiés en retard ; pas de recherche
  sur les audits et les constats ; constats triés par identifiant seulement.
- `actual_date` d'un audit non contrôlé en `PATCH` (date future acceptée).
- Modèles audit, constat et exigence sans `_rec_name` : le journal affiche un nom technique.

Habilitations et rapport mensuel :
- EPI non servis par `/hsseq/qualifications` (RH les tient dans `eguitra.rh.ppe.issue`).
- Filtre `status` combiné à `type` : il prend le statut d'ensemble ou celui de la case.
- `mandatory_for_drivers` global : l'ADR ne peut pas être obligatoire pour les seules citernes, ni
  l'accès au site minier pour les seules bennes.
- Alertes sans identifiant (`employee_id`, `vehicle_id`, clé) ni filtre de date.
- `employee.name` servi en clair (sans effet tant que l'auditeur reste hors de `QUAL_READ`).
- `month_not_frozen` sans élision (« de octobre », « de août ») ; le PDF crée le mois du rapport et
  journalise un « create » au nom du lecteur ; journal d'une saisie en tuples Python ; société et
  indicateurs d'un modèle non journalisés.
- `PATCH` d'un modèle avec une liste `indicators` partielle : les absents sont supprimés ou archivés
  (l'écran envoie toujours la liste complète) ; numéro d'indicateur en double à rendre en 409.
- `GET /hsseq/reports?year=` d'une année future liste des mois ; les mois antérieurs à la création
  d'un modèle sont listés « à valider ».
- Valeurs calculées par société seulement, sans site ni profil de véhicule : le rapport d'un donneur
  d'ordre minier mêle citernes et bennes. Proposition : `site_ids` ou `vehicle_kind` sur le modèle.

Trajets, pesées et immobilisations :
- Décimales avec un point dans des textes français (détail de V07 « délester de 5.00 t », journal de
  la pesée « 47.800 t ») : il faut une virgule.
- `_immobilization_proposed` propose de nouveau l'immobilisation après une levée tant que
  l'événement reste ouvert : à confirmer, sinon ne la proposer que sans aucune immobilisation.
- Un `PUT` identique d'un plan de trajet dévalide un plan validé (présence des clés, pas valeurs) :
  l'écran évite cet envoi.
- `settings_row` sert `None` pour une valeur à 0 (`or None`) : une nuit finissant à minuit ou
  `max_driving_hours` à 0 reviennent nuls.
- `PATCH /hsseq/routes/{id}` : `bool("false")` vaut vrai ; il faut un booléen strict.
- Plan de trajet : arrêts hors de l'intervalle départ-arrivée acceptés (400 attendu) ;
  `_check_journey` lève une ValidationError sans code ni `fields` ; le même chef de parc saisit et
  valide (la spécification parle du responsable exploitation, à confirmer) ; `journey_row.route` sans
  origine, destination ni durée.
- Aucune lecture HSSEQ du ticket de pesée en cours : l'écran le lit dans `GET /transport/rotations/{id}`.

