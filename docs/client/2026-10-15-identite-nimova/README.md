# Nouvelle identité du SIG : NIMOVA (message du DG, 15 octobre 2026)

À traiter avec le gérant : sujet mis de côté le 15 octobre au matin, « nous y reviendrons tout à
l'heure ».

## Message du DG au gérant (reçu le 15 octobre au matin)

> Bonjour,
> C'est désormais la nouvelle identité de notre SIG.
> Merci de t'y conformer. Tu peux l'améliorer mais le fondamental reste. L'outil doit être unique à nous.
> On se parle vers 08h.

Le DG a aussi demandé au gérant de choisir le nom de domaine parmi les propositions de l'image
`choix-du-nom-de-domaine.jpg` :

| Nom | Positionnement indiqué | Exemples de sous-domaines |
|---|---|---|
| nimova.com (marqué « Mon premier choix ») | Court, international et facile à retenir ; identité numérique officielle de NIMOVA | cloud.nimova.com, mail.nimova.com, erp.nimova.com |
| nimova.cloud | Orienté cloud et services numériques (stockage, documents partagés, services hébergés) | drive.nimova.cloud, mail.nimova.cloud |
| nimovagroup.com | Positionnement institutionnel, futur écosystème numérique du groupe | — |

## Fichiers

- `NIMOVA_Presentation_Cadrage_ERP.pdf` : présentation de cadrage transmise par le DG.
- `choix-du-nom-de-domaine.jpg` : les trois noms de domaine proposés.

## Ce que cela touchera (à instruire le moment venu)

- Charte graphique et nom affiché des applications (variables de `apps/web/app/globals.css`, titres,
  icônes, manifeste de Rotations), documents imprimés, guides, dossier de conception.
- Noms de domaine du proxy (`infra/caddy/Caddyfile`, variables de `infra/.env`) et adresse
  d'expédition des courriels.
- Périmètre : vérifier dans la présentation ce qui relève de l'offre OTF-EGUITRA-2026-37 et ce qui
  serait une évolution.

## Premiers constats (15 octobre)

- Disponibilité des noms (interrogation RDAP des registres, 15 octobre) : nimova.com est déjà
  enregistré par un tiers depuis le 12 décembre 2011 (expiration 12 décembre 2027) ; nimova.cloud
  et nimovagroup.com sont libres. La disponibilité juridique du nom reste à vérifier (la note du DG
  le rappelle).
- Le « fondamental » de la note : le nom NIMOVA, la signature « La maîtrise intégrée de votre
  performance », une marque interne commune aux deux structures sans vocation commerciale
  immédiate, une plateforme commune avec deux espaces de gestion. Charte de la présentation : verts
  profonds (#142F29, #22634C), vert d'eau (#A5E6C2), accent doré (#D3AA5B), fond crème (#F9F8F5),
  police Aptos (Microsoft, non libre pour le web).
- Écarts avec l'offre signée : la note liste aussi les stocks et le carburant, la maintenance
  (plans préventifs, ordres de travail), les ressources humaines, les demandes d'achat, commandes
  et réceptions, les devis. L'offre classe « un nouveau module ou un nouvel écran complet, par
  exemple la paie ou les stocks » parmi les évolutions facturables : à clarifier avec le DG
  avant tout engagement.
- La note évoque une « éventuelle intégration avec Odoo » et une feuille de route en quatre phases :
  elle semble rédigée sans tenir compte de ce qui est déjà construit. Un point d'alignement avec
  le DG est à prévoir.
