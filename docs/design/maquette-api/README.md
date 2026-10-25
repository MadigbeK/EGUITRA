# Maquette de l'API NIMOVA

`serveur.mjs` est un outil de design. Il imite l'API du noyau (`/api/v1`) pour afficher tous les écrans
authentifiés de l'application web sans le vrai serveur. Toutes les données sont fictives : sociétés
suffixées « (démo) », noms courants, montants plausibles arrêtés au 15/10/2026. Ne jamais pointer la
maquette vers un environnement de production ou de recette, ne jamais la brancher sur une vraie base,
et ne jamais présenter ses chiffres au client comme des chiffres réels.

## Démarrer

Node 20 ou plus suffit, sans aucune dépendance à installer :

```bash
node docs/design/maquette-api/serveur.mjs
```

Le serveur écoute sur `http://127.0.0.1:8170/api/v1`. La variable `PORT` change le port (`PORT=8171`).

Chaque requête produit une ligne de journal dans le terminal. Une route que la maquette ne connaît pas
répond 404 `{"error":"not_found"}` et sa ligne commence par `INCONNU` : c'est le signe qu'un écran appelle
un chemin non simulé. Les données sont recalculées à chaque démarrage, donc les saisies d'une séance
(factures, rotations, pièces déposées, etc.) disparaissent à l'arrêt.

## Brancher l'application web

Lancer Next depuis `apps/web` avec deux variables d'environnement :

```bash
ODOO_URL=http://127.0.0.1:8170 COOKIE_PREFIX=egm npx next dev --port 3200
```

Sous PowerShell :

```powershell
$env:ODOO_URL="http://127.0.0.1:8170"; $env:COOKIE_PREFIX="egm"; npx next dev --port 3200
```

`COOKIE_PREFIX` (lettres minuscules, huit au plus) donne aux cookies de session un nom distinct de celui
d'une instance branchée sur le vrai noyau. Une session de maquette ne part ainsi jamais vers le vrai
serveur, et inversement.

Next.js refuse deux `next dev` dans le même dossier : arrêter d'abord l'aperçu branché sur la recette
(port 3200), puis le relancer après usage de la maquette.

## Identifiants

Tout mot de passe est accepté, sauf `faux`, qui est refusé (y compris comme ancien mot de passe lors
d'un changement).

| Identifiant | Ce que l'on voit |
|---|---|
| n'importe lequel, par exemple `demo` | Profil complet (administration, direction, finance, exploitation, chantiers, immobilier, cabinet, HSSEQ), applications Finance, AxisPro, mobile et HSSEQ, les deux sociétés. |
| `porteur` | Porteur de projet : portail seul, société MB AxisPro Consulting, deux dossiers. |
| `parc` | Exploitation : application mobile Rotations et Finance, société EGUITRA seule. |
| `cabinet` | Consultant du cabinet : AxisPro seul, société MB AxisPro Consulting. |
| `provisoire` | Profil complet avec mot de passe provisoire : le changement de mot de passe est imposé. |
| `mfa` | Étape du code à six chiffres. `000000` est refusé, tout autre code est accepté. |
| `activation` | Première activation de la double authentification (QR code et clé), même règle pour le code. |
| `hsseq` | Fanta Kourouma, Responsable HSSEQ seul : classement, enquêtes, seconde validation des dérogations, détail chiffré des alcootests. |
| `dg` | Saïdou Barry, Directeur général : lecture intégrale, alcootests en statut, validation des actions coûteuses, journal HSSEQ. |
| `boffa` | Sékou Condé, chef de parc de la base minière de Boffa (exploitation bornée au site 2) : contrôles, levées, demandes de dérogation. |
| `conducteur` | Amadou Oury Diallo, conducteur de ER-01 : application `terrain` (NIMOVA Terrain) seule, refusé sur le web ; alcootest lu en « fait » seulement. |

## Sociétés et cas particuliers

Le sélecteur de société change les chiffres : EGUITRA GROUP SARLU (transport, BTP, immobilier) et
MB AxisPro Consulting (cabinet, environ vingt fois plus petit). La vue « groupe » consolide les deux.
AxisPro et le portail s'ouvrent sur la société du cabinet.

Les données contiennent volontairement les cas utiles au design : listes vides, noms très longs,
factures échues et relances des trois niveaux, échéance de prêt en retard, rotation et chantier à marge
négative, biens vacants, demande d'approbation rejetée, alerte bloquante (compte de passage 585 non
soldé, 180 M GNF au 15/10, qui avec 70 M de chèques à encaisser en 513 fait l'écart entre les journaux
et la trésorerie nette), dossier AxisPro en NO-GO sur un critère éliminatoire et dossier sans aucune
évaluation.

AxisPro suit la version 3 de l'outil de scoring du cabinet : les grilles v2 (en vigueur) et v3 (brouillon,
modifiable) ont huit compartiments C0 à C7, la v1 (archivée, dossiers clos) n'en a pas ; les gates G1 et
G4 exigent une complétude documentaire minimale de 40 % et 70 %. Dans les dossiers ouverts, C1 et C4
restent à affecter et le dossier d'aquaculture n'a pas d'équipe ; `cabinet` (Aïssatou Barry) reçoit C0, C5
et C6 des dossiers qu'elle mène, dont la rizerie de Kankan (« Mes compartiments »).

## NIMOVA · Analyse

Les routes `/analyse/contexte`, `/analyse/groupe/*` (synthèse, rentabilité, trésorerie, clients, transport,
dépenses, prévisions, fiabilité) et `/analyse/cabinet/*` (synthèse, portefeuille, diagnostic, comités,
financements, activité, risques) vivent dans `analyse.mjs` (entrée et contexte), `analyse-groupe.mjs`,
`analyse-cabinet.mjs` et `analyse-commun.mjs` (période, constats, outils). Elles reproduisent les formes
exactes du noyau `addons/eguitra_analytics` (mêmes clés, mêmes unités, mêmes blocs facultatifs ou nuls),
telles que `apps/web/lib/analyse-types.ts` les décrit, au contrat de `docs/projet/analyse/specification.md`
(chapitres 3 à 7). Elles acceptent `period` (`ytd`, `12m`, `q`, `m`, `custom` avec `date_from`) et `date_to`.
Les données viennent d'un modèle mensuel déterministe sur 36 mois (graines fixes) : chiffre d'affaires et
marges par activité, trésorerie, routes et ensembles, clients et fournisseurs, puis un portefeuille de
quatorze projets sur les huit gates de la méthode pour le cabinet. Les constats sont calculés depuis ce
modèle quand ils portent sur lui (point mort, atterrissage, point bas de trésorerie, goulot du portefeuille).
Une route du groupe appelée dans les livres du cabinet (et inversement) répond 403 `wrong_company`, comme
le noyau.

## NIMOVA · HSSEQ

Les routes `/hsseq/*` (lot 1) suivent le contrat `docs/design/hsseq-contrat.md` et les types
`apps/web/lib/hsseq-types.ts` : cockpit, référentiels et sites, échéances, événements (cycle, enquête,
coûts, rapport PDF, registre Excel), actions (preuve, J+90, validation de la direction), grilles et
contrôles avant départ, non-conformités et levée, alcootests, verrou (`lock/evaluate`,
`lock/departures`, `lock/reasons`), dérogations, pièces jointes et journal. Chaque fiche renvoie
`rights` et `transitions` selon le profil du compte connecté ; l'alcootest se lit en « fait » pour
le conducteur, en statut pour exploitation, direction et administration, en détail chiffré pour le
seul profil `hsseq`. Le profil complet (`demo`) porte aussi `hsseq`.

Données, toutes fictives, au 15/10/2026 :

- deux sites, Parc de Matoto (les seize citernes de Transport) et Base minière de Boffa (six bennes,
  EB-01 à EB-06, et leurs postes « Fosse 3 de Boffa - Port de Dapilon ») ; Transport de la maquette ne
  connaissant pas encore les bennes, celles-ci, leurs conducteurs et leurs postes n'existent que dans
  la partie HSSEQ ;
- vingt-deux événements de 2026, de tous niveaux et de tous statuts (dont deux de criticité élevée et
  trois enquêtes en retard), avec enquêtes (5 Pourquoi, arbre des causes, 5M), coûts et photos ;
- vingt et une actions, dont trois en retard (une au-delà de 30 jours, escaladée au Directeur général),
  six à vérifier à J+90 et une jugée inefficace ;
- deux grilles de contrôle avant départ (citerne, benne) au paramétrage initial de la spécification, un
  contrôle et un alcootest par départ depuis le 1er octobre, quelques non-conformités, dont une sans
  photo ;
- départs du 15/10 : dix, dont cinq bloqués (V01 et V03 à faire et V04 pour ER-09, V02 pour ER-06 avec
  une dérogation en attente du Responsable HSSEQ, V03 positif pour EB-02, V04 pour ER-04, V05 pour
  ER-08) ;
- huit dérogations sur l'année, des échéances à 30 jours (permis, assurance, visite technique,
  barémage) et un cockpit de seize indicateurs avec leurs séries sur douze mois (consommation, écarts
  de livraison et kilomètres tirés des rotations de Transport, heures travaillées modélisées par
  société).

Pour NIMOVA Terrain, se connecter avec `"app": "terrain"` (application absente de `apps` du web) et
envoyer l'en-tête `X-Eguitra-App: terrain` : les déclarations y prennent la source `terrain`.

## Limites

Les soldes de trésorerie, le bilan, le compte de résultat et le chiffre d'affaires viennent d'un modèle
calculé au démarrage. Une saisie faite pendant la séance apparaît dans les listes et dans les encours
clients ou fournisseurs, mais un virement interne, une ligne de relevé ou une facture validée ne
modifient pas ces soldes.
