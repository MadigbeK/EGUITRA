# NIMOVA · RH : spécification

Module `addons/eguitra_rh` (noyau) et espace `/rh` de l'application web. Décision du gérant du
22 octobre 2026 : « une gestion complète, simple et intelligente des ressources humaines », carte
blanche. La paie était hors du périmètre de l'offre (chapitre 3 de `ETAT.md`) : c'est une évolution
demandée par le gérant.

## 1. Principes

- **Gestion commune aux deux sociétés** (décision du gérant, 22 octobre 2026), comme la finance : un
  seul service RH gère, dans les mêmes listes et le même tableau de bord, le personnel de toutes les
  sociétés auxquelles son compte est ouvert (filtre « Société » facultatif, paramètre `company_id`
  des routes). Chaque société reste l'employeur légal : un salarié a un employeur, choisi à son
  embauche ; une paie, une déclaration CNSS, une déclaration fiscale et une écriture de paie par
  société et par mois (préparées ensemble en un geste). Départements communs ou propres à une
  société ; le responsable hiérarchique peut être de l'autre société. Taux, barème, congés, heures,
  alertes et comptes sont communs aux deux sociétés ; numéro d'employeur CNSS, taxe de formation
  (selon l'effectif de chaque société) et journal des salaires sont propres à chacune.
- **Code sans module.** L'application `rh` n'est accordée à un compte que là où le module
  `eguitra_rh` est installé : la production peut recevoir le code sans l'installer.
- **Profils.** Nouveau profil `rh` (« Ressources humaines »), commun aux deux sociétés : tout l'espace
  RH. La direction lit tout, approuve les absences ; l'administration a tous les droits. La finance
  n'ouvre pas l'espace RH : elle reçoit l'écriture de paie en brouillon dans ses journaux.
- **Libre-service.** Tout compte NIMOVA lié à un dossier salarié actif ouvre l'espace RH réduit à
  « Mon espace » : sa fiche, son solde de congés, ses demandes d'absence, ses bulletins validés, et les
  demandes de ses collaborateurs directs à trancher. Il ne voit jamais les données d'un autre salarié.
- **Confidentialité.** Les salaires ne sont lus que par les profils RH, direction et administration.
  Piste d'audit sur les salariés, les éléments fixes, les absences, les avances, les paies, les
  bulletins et les paramètres.
- **Paramétrable.** Taux, barème, plafonds et comptes sont des paramètres par société, avec les
  valeurs légales par défaut. À faire valider par l'expert-comptable avant la première paie réelle.

## 2. Règles de paie (Guinée), valeurs par défaut

| Élément | Règle | Source |
|---|---|---|
| CNSS | 5 % salarié, 18 % employeur, assiette plafonnée à 2 500 000 GNF par mois, plancher au SMIG (550 000 GNF) au prorata de la présence ; stagiaires et apprentis exclus | Pratique CNSS (plafond depuis 2019) ; **à confirmer auprès de la CNSS** |
| RTS | Barème mensuel progressif : 0 % jusqu'à 1 000 000, 5 % jusqu'à 3 000 000, 8 % jusqu'à 5 000 000, 10 % jusqu'à 10 000 000, 15 % jusqu'à 20 000 000, 20 % au-delà | CGI, art. 63 |
| Base de la RTS | Brut imposable moins la cotisation CNSS salariale | CGI, art. 58 |
| Indemnités forfaitaires | Logement, transport, panier et repas, cherté de vie : exonérées de RTS dans la limite totale de 25 % du brut | CGI, art. 55-3 |
| Versement forfaitaire (VF) | 6 % des rémunérations versées, à la charge de l'employeur ; stagiaires (jusqu'à 1 200 000 GNF) et apprentis exonérés | CGI, art. 201 et 203 ter |
| Taxe d'apprentissage | 2 % de la même base, entreprises de moins de 30 salariés (sinon contribution de 1,5 % à la formation professionnelle) : taux et libellé paramétrables | CGI, art. 204 à 210 |
| Congés payés | 2,5 jours ouvrables par mois de service, acquis au fil des mois | Code du travail ; à confirmer |
| Jours ouvrables | Lundi au samedi, jours fériés exclus | |
| Heures supplémentaires | Taux horaire = salaire de base / 173,33 h, majoré selon la rubrique (+30 %, +60 %, +100 %) | Paramétrable |
| Prorata | Entrée, sortie et absence non rémunérée : salaire de base et éléments fixes au prorata des jours ouvrables du mois | |

Arrondi : chaque montant au franc, à l'entier le plus proche (demi vers le haut).

## 3. Modèles du noyau

`eguitra.rh.settings` (une fiche par société, barème `eguitra.rh.tax.bracket`), `eguitra.rh.rubric`
(rubriques de paie, partagées), `eguitra.rh.department`, `eguitra.rh.employee` (éléments fixes
`eguitra.rh.employee.line`, documents `eguitra.rh.document`, historique du salaire
`eguitra.rh.salary.change`), `eguitra.rh.holiday`, `eguitra.rh.leave.type`, `eguitra.rh.leave`,
`eguitra.rh.advance`, `eguitra.rh.payroll` (paie d'un mois), `eguitra.rh.payslip` (bulletin, lignes
`eguitra.rh.payslip.line`, éléments variables `eguitra.rh.payslip.input`).

## 4. Routes de l'API (`/api/v1`)

Lecture (`READ`) : administration, direction, RH. Écriture (`WRITE`) : administration, RH. Les types
des réponses sont dans `apps/web/lib/rh-types.ts`.

| Méthode et route | Profils | Réponse ou effet |
|---|---|---|
| GET `/rh/summary` | READ | `Summary` |
| GET `/rh/meta` | READ | `Meta` |
| GET `/rh/employees?state=&q=&department_id=` | READ | `EmployeeRow[]` (state : `active` = à venir, essai et actifs ; `sorti` ; `all`) |
| POST `/rh/employees` | WRITE | `Employee` (corps `EmployeeInput`) |
| GET `/rh/employees/<id>` | READ | `Employee` |
| PATCH `/rh/employees/<id>` | WRITE | `Employee` |
| POST `/rh/employees/<id>/exit` | WRITE | `{exit_date, exit_reason}` ; `Employee` |
| POST `/rh/employees/<id>/documents` | WRITE | multipart : `file` (facultatif), `kind`, `name`, `expiry_date` ; `EmployeeDocument` |
| GET `/rh/documents/<id>/file` | READ | le fichier |
| DELETE `/rh/documents/<id>` | WRITE | `{status: "ok"}` |
| POST `/rh/departments`, PATCH `/rh/departments/<id>` | WRITE | `{name, manager_id, active}` ; `Department` |
| POST `/rh/rubrics`, PATCH `/rh/rubrics/<id>` | WRITE | champs de `Rubric` (hors `system`) ; `Rubric` |
| POST `/rh/leave-types`, PATCH `/rh/leave-types/<id>` | WRITE | champs de `LeaveType` ; `LeaveType` |
| GET `/rh/settings` ; PATCH `/rh/settings` | READ ; WRITE | `Settings` (PATCH partiel ; `rts_brackets` remplace le barème) |
| GET `/rh/holidays?year=` ; POST `/rh/holidays` ; DELETE `/rh/holidays/<id>` | READ ; WRITE | `Holiday[]` ; `{date, name}` |
| GET `/rh/leaves?state=&employee_id=&date_from=&date_to=` | READ | `Leave[]` |
| POST `/rh/leaves` | WRITE | `{employee_id, type_id, date_from, date_to, half_day, note, approve}` ; `Leave` |
| POST `/rh/leaves/<id>/approve` | RH, direction, administration ou responsable hiérarchique | `{force}` (solde insuffisant : 422 `insufficient_balance`, sauf `force` par la RH) ; `Leave` |
| POST `/rh/leaves/<id>/refuse` | idem | `{reason}` ; `Leave` |
| POST `/rh/leaves/<id>/cancel` | WRITE, ou le salarié pour sa demande | `Leave` |
| GET `/rh/leaves/balances` | READ | `BalanceRow[]` |
| GET `/rh/leaves/days?date_from=&date_to=&half_day=` | tout compte | `{days}` (jours ouvrables) |
| GET `/rh/advances?state=` ; POST `/rh/advances` ; POST `/rh/advances/<id>/cancel` | READ ; WRITE | `Advance[]` ; `{employee_id, kind, date, amount, installment, first_month, note}` |
| GET `/rh/payrolls` | READ | `PayrollRow[]` (plus récent d'abord) |
| POST `/rh/payrolls` | WRITE | `{month, company_id?}` : crée et calcule la paie du mois de la société, ou sans `company_id` celle de chaque société qui a du personnel ; `Payroll` (la première) avec `created` |
| GET `/rh/payrolls/<id>` | READ | `Payroll` |
| POST `/rh/payrolls/<id>/compute` | WRITE | recalcule (éléments saisis conservés, nouveaux salariés ajoutés) ; `Payroll` |
| POST `/rh/payrolls/<id>/validate` | WRITE | bulletins figés ; refus 422 si un net est négatif ; `Payroll` |
| POST `/rh/payrolls/<id>/reopen` | WRITE | retour en préparation (écriture encore en brouillon supprimée) ; `Payroll` |
| POST `/rh/payrolls/<id>/account` | WRITE | écriture de paie en brouillon dans le journal des salaires ; `Payroll` |
| GET `/rh/payrolls/<id>/export.xlsx` | READ | classeur : livre de paie, virements, CNSS, impôts sur salaires |
| GET `/rh/payslips/<id>` | READ | `Payslip` |
| POST `/rh/payslips/<id>/inputs` | WRITE | `{rubric_id, amount, quantity, note}` (paie en préparation) ; `Payslip` recalculé |
| DELETE `/rh/payslips/<id>/inputs/<input_id>` | WRITE | élément saisi supprimé ; `Payslip` recalculé |
| POST `/rh/simulate` | READ | `SimulationInput` ; `Simulation` |
| GET `/rh/me` | tout compte lié à un salarié | `MySpace` |
| POST `/rh/me/leaves` | idem | `{type_id, date_from, date_to, half_day, note}` ; `Leave` (à valider) |
| POST `/rh/me/leaves/<id>/cancel` | idem | sa demande, à valider ou future ; `Leave` |
| GET `/rh/me/payslips/<id>` | idem | son bulletin validé ; `Payslip` |

Erreurs : 404 `not_found`, 422 `business_rule` (message en français, affiché tel quel),
422 `insufficient_balance`, 403 `forbidden`.

## 5. Écriture de paie

À la comptabilisation, une pièce en brouillon dans le journal « Salaires » (code `SAL`, créé au
besoin), datée du dernier jour du mois, référence « Paie AAAA-MM » :

| Compte (par défaut) | Sens | Montant |
|---|---|---|
| 6611 Appointements et salaires (ou compte de la rubrique) | Débit | brut, ventilé par axe d'activité du salarié |
| 6641 Charges sociales | Débit | CNSS employeur, par activité |
| 6413 Taxes sur salaires | Débit | VF et taxe d'apprentissage, par activité |
| 431 Sécurité sociale | Crédit | CNSS salariale et employeur |
| 447 État, impôts retenus à la source | Crédit | RTS |
| 442 État, autres impôts et taxes | Crédit | VF et taxe d'apprentissage |
| 421 Personnel, avances et acomptes | Crédit | avances et prêts remboursés |
| 422 Personnel, rémunérations dues | Crédit | net de chaque salarié (tiers : sa fiche) |

Un compte paramétré est cherché par son code, puis par sa racine. La finance relit et comptabilise la
pièce dans « Journaux et OD », puis règle les nets depuis la trésorerie (lettrage sur le 422 de chaque
salarié).

## 6. Intelligence du module

- Soldes de congés calculés au jour le jour (acquisition mensuelle, prises, demandes en attente).
- Jours d'absence comptés en jours ouvrables, jours fériés exclus ; chevauchements refusés.
- Paie du mois en un geste : salariés présents dans le mois, prorata d'entrée et de sortie, absences
  non rémunérées retenues, échéances d'avances et de prêts, primes de rotation des chauffeurs
  (rotations validées du mois, si une prime par rotation est paramétrée), éléments fixes.
- Contrôles avant validation : net négatif (bloquant), brut inférieur au SMIG, numéro CNSS ou compte
  bancaire manquant, axe d'activité manquant, net en écart de plus de 20 % avec le mois précédent.
- Échéancier : fins de période d'essai et de CDD, documents expirés ou à expirer, soldes de congés
  élevés, paie du mois précédent non validée, fiches incomplètes, anniversaires.
- Simulateur : du salaire de base au net et au coût employeur, ou du net cible au salaire de base.

## 7. Données lues par NIMOVA · HSSEQ

Demande de la Direction générale (spécification du module HSSEQ, diffusion restreinte, hors dépôt) :
les données RH du module HSSEQ vivent dans `eguitra_rh` ; HSSEQ n'en lit que des statuts, côté serveur,
sans jamais un justificatif ni un détail médical.

- **Habilitations** : référentiel `eguitra.rh.qualification.type` (permis poids lourd, conduite
  défensive, matières dangereuses, accès au site minier, secourisme ; durée de validité, obligatoire
  pour les conducteurs, justificatif exigé) et habilitations des salariés `eguitra.rh.qualification`
  (obtention, expiration, référence, organisme, justificatif). Statut : valide, à renouveler (J-30),
  expirée (le lendemain de la date d'expiration), absente (type obligatoire sans habilitation).
- **Aptitude médicale** : sur le dossier, « apte » ou « inapte », date de la visite et date de
  validité ; aucun autre champ, aucun détail médical.
- **EPI remis** : `eguitra.rh.ppe.issue` (équipement, précision, taille, quantité, date, renouvellement,
  remise signée).
- **Accidents du travail** : type d'absence « Accident du travail » (`work_accident`), jours perdus
  comptés en jours calendaires ; heures réellement travaillées tirées des bulletins validés (jours
  payés au prorata de l'horaire mensuel, plus heures supplémentaires), estimées par la présence pour
  un mois sans paie validée.
- **Interface serveur** (méthodes de `eguitra.rh.employee`, en sudo) : `_hsseq_driver_status(driver,
  on_date)` (motif V04 du verrou de départ : habilitation obligatoire expirée ou absente, aptitude
  inapte, échue ou non renseignée, chauffeur sans dossier salarié), `_hsseq_expiring(companies,
  horizon_days)` (alertes J-30 et J-7), `_hsseq_worked_hours`, `_hsseq_work_accidents`,
  `_hsseq_indicators` (taux de fréquence : accidents avec arrêt × 1 000 000 ÷ heures ; taux de gravité :
  jours perdus × 1 000 ÷ heures).
- **API RH** : `/rh/qualifications` (liste, création, modification, suppression, justificatif),
  `/rh/qualifications/matrix`, `/rh/qualification-types`, `/rh/ppe`, `/rh/safety` ; aptitude par
  PATCH `/rh/employees/<id>` ; `/rh/me` renvoie au conducteur ses habilitations et son aptitude.
  Quatre yeux : personne ne gère ses propres habilitations ni son aptitude.
- **Échéancier** : habilitations et aptitudes à J-30 (à traiter) et J-7 (urgent), expirées (urgent).
