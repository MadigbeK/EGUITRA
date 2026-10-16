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
| n'importe lequel, par exemple `demo` | Profil complet (administration, direction, finance, exploitation, chantiers, immobilier, cabinet), applications Finance, AxisPro et mobile, les deux sociétés. |
| `porteur` | Porteur de projet : portail seul, société MB AxisPro Consulting, deux dossiers. |
| `parc` | Exploitation : application mobile Rotations et Finance, société EGUITRA seule. |
| `cabinet` | Consultant du cabinet : AxisPro seul, société MB AxisPro Consulting. |
| `provisoire` | Profil complet avec mot de passe provisoire : le changement de mot de passe est imposé. |
| `mfa` | Étape du code à six chiffres. `000000` est refusé, tout autre code est accepté. |
| `activation` | Première activation de la double authentification (QR code et clé), même règle pour le code. |

## Sociétés et cas particuliers

Le sélecteur de société change les chiffres : EGUITRA GROUP SARLU (transport, BTP, immobilier) et
MB AxisPro Consulting (cabinet, environ vingt fois plus petit). La vue « groupe » consolide les deux.
AxisPro et le portail s'ouvrent sur la société du cabinet.

Les données contiennent volontairement les cas utiles au design : listes vides, noms très longs,
factures échues et relances des trois niveaux, échéance de prêt en retard, rotation et chantier à marge
négative, biens vacants, demande d'approbation rejetée, alerte bloquante (compte de passage 585 non
soldé), dossier AxisPro en NO-GO sur un critère éliminatoire et dossier sans aucune évaluation.

## Limites

Les soldes de trésorerie, le bilan, le compte de résultat et le chiffre d'affaires viennent d'un modèle
calculé au démarrage. Une saisie faite pendant la séance apparaît dans les listes et dans les encours
clients ou fournisseurs, mais un virement interne, une ligne de relevé ou une facture validée ne
modifient pas ces soldes.
