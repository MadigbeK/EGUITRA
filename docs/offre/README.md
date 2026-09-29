# Offre technique et financière EGUITRA / MB AxisPro, par E-VOLUTION XP

Révision 1 du 29 septembre 2026 (référence OTF-EGUITRA-2026-36-R1), en réponse aux observations du client sur l'offre du 15 septembre 2026. Elle porte sur la seule proposition 1, plateforme intégrée sur noyau de gestion, à 50 000 000 GNF HT.

- `contenu.js` : hypothèses (dates, validité, garantie), sauvegardes, pénalités, règles de maintenance évolutive, postes et total de la proposition 1, planning. C'est le seul fichier à modifier pour rechiffrer. Le total est obtenu par un effort commercial déduit de la valeur des postes ; le script refuse de construire si le total dépasse cette valeur.
- `build.js` : contenu rédactionnel et rendu. Produit le `.docx` et le `.md`.
- `logo.png` : logo officiel E-VOLUTION XP, à déposer ici. Tant qu'il est absent, `logo-rendu.png` (rendu vectoriel provisoire issu de `logo-rendu.svg`) est utilisé.
- `Offre_technique_financiere_EGUITRA.docx` : version à envoyer au client.
- `Offre_technique_financiere_EGUITRA.md` : même contenu, lisible dans le dépôt.
- `mail-reponse.md` : texte du courrier accompagnant la révision, point par point.
- `mail-envoi.md` : texte du mail qui accompagnait l'offre initiale.
- `envoyes/` : PDF exactement tels qu'envoyés au client. `2026-09-15_…pdf` est l'offre initiale ; la source correspondante est le commit « Aligne la source sur la version de l'offre envoyée au client ».

Régénérer :

```bash
npm install
node docs/offre/build.js
```

Le Word contient une table des matières automatique : à l'ouverture, accepter la mise à jour des champs.
