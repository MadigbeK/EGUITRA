# Offre technique et financière EGUITRA / MB AxisPro, par E-VOLUTION XP

- `contenu.js` : hypothèses (dates, validité, VPS), postes et totaux des deux propositions en GNF, planning en quatre semaines. C'est le seul fichier à modifier pour rechiffrer. Le script refuse de construire si la somme des postes diffère du total annoncé.
- `build.js` : contenu rédactionnel et rendu. Produit le `.docx` et le `.md`.
- `logo.png` : logo officiel E-VOLUTION XP, à déposer ici. Tant qu'il est absent, `logo-rendu.png` (rendu vectoriel provisoire issu de `logo-rendu.svg`) est utilisé.
- `Offre_technique_financiere_EGUITRA.docx` : version à envoyer au client.
- `Offre_technique_financiere_EGUITRA.md` : même contenu, lisible dans le dépôt.

Régénérer :

```bash
npm install docx
node docs/offre/build.js
```

Le Word contient une table des matières automatique : à l'ouverture, accepter la mise à jour des champs.
