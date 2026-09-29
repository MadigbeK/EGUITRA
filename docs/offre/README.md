# Offre technique et financière EGUITRA / MB AxisPro, par E-VOLUTION XP

Offre du 29 septembre 2026 (référence OTF-EGUITRA-2026-36), qui annule et remplace celle du 15 septembre 2026. Offre complète sur la seule proposition 1, plateforme intégrée sur noyau de gestion, à 50 000 000 GNF HT, intégrant les demandes du client : validité 30 jours, garantie 6 mois, sauvegardes toutes les 15 minutes, pénalités de retard, règles de maintenance évolutive.

- `contenu.js` : hypothèses (dates, validité, garantie), sauvegardes, pénalités, règles de maintenance évolutive, postes et total, planning. C'est le seul fichier à modifier pour rechiffrer. Le script refuse de construire si la somme des postes diffère du total annoncé.
- `build.js` : contenu rédactionnel et rendu. Produit le `.docx` et le `.md`.
- `logo.png` : logo officiel E-VOLUTION XP, à déposer ici. Tant qu'il est absent, `logo-rendu.png` (rendu vectoriel provisoire issu de `logo-rendu.svg`) est utilisé.
- `Offre_technique_financiere_EGUITRA.docx` : version à envoyer au client.
- `Offre_technique_financiere_EGUITRA.md` : même contenu, lisible dans le dépôt.
- `mail-reponse.md` : texte du courrier accompagnant l'offre du 29 septembre.
- `mail-envoi.md` : texte du mail qui accompagnait l'offre initiale.
- `envoyes/` : PDF exactement tels qu'envoyés au client. `2026-09-15_…pdf` est l'offre initiale ; la source correspondante est le commit « Aligne la source sur la version de l'offre envoyée au client ».

Régénérer :

```bash
npm install
node docs/offre/build.js
```

Le Word contient une table des matières automatique : à l'ouverture, accepter la mise à jour des champs.
