# Demandes de la session design à la session fonctionnelle

Ce qui sort du périmètre de la session design (présentation de `apps/web`) et revient à la session
fonctionnelle.

## Nom de domaine nimova.cloud (décision du gérant, 6 novembre 2026)

Le domaine officiel est nimova.cloud, enregistré le 6 novembre 2026. Il remplace nimovagroup.com
(16 octobre) et nimova.gn (21 octobre). Sous-domaines en service : voir `infra/README.md`. Reste à
faire : adresse d'expédition des courriels.

Point à trancher avec le gérant : le portail des porteurs garde la marque MB AxisPro Consulting.
Les adresses portail.nimova.cloud et nimova.cloud/portail montrent la marque interne aux clients du cabinet ; un domaine du
cabinet conviendrait peut-être mieux (`infra/domaines.sh appliquer nimova.cloud <nom-du-portail>`).

## Polices : accès sortant pendant la construction de l'image web

Les polices Barlow sont embarquées par `next/font/google` : `next build` les télécharge une fois
(fonts.googleapis.com et fonts.gstatic.com), puis le site les sert lui-même, ce qui respecte la
politique de contenu. La construction de l'image web sur le serveur a donc besoin de cet accès
sortant, comme pour `npm ci`. Si ce n'était pas possible, les fichiers seraient à placer dans le
dépôt avec `next/font/local`.

## Rotations : renouveler le cache du service worker

Les icônes et le manifeste de Rotations changent (monogramme NIMOVA, couleurs forêt). Le service
worker `public/mobile-sw.js` les met en cache sous la version `rotations-v1` ; les téléphones déjà
installés garderont les anciennes icônes tant que cette version ne change pas. À faire à la fusion :
passer `VERSION` à `rotations-v2` dans `public/mobile-sw.js` et dans `lib/offline-store.ts` (le
commentaire du fichier indique les deux emplacements). Ce fichier est hors du périmètre de la
session design, d'où cette demande.

Fait par la session fonctionnelle (commit 8b3e66e, `rotations-v2`). Toute nouvelle retouche des
icônes ou du manifeste de Rotations demandera de passer à `rotations-v3`.
