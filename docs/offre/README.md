# Offre technique et financière EGUITRA / MB AxisPro

- `contenu.js` : hypothèses (TJM, taux GNF, forfait exploitation) et charges par lot. C'est le seul fichier à modifier pour rechiffrer.
- `build.js` : contenu rédactionnel et rendu. Produit le `.docx` et le `.md`.
- `Offre_technique_financiere_EGUITRA.docx` : version à envoyer au client.
- `Offre_technique_financiere_EGUITRA.md` : même contenu, lisible dans le dépôt.

Régénérer :

```bash
npm install docx
node docs/offre/build.js
```

Le Word contient une table des matières automatique : à l'ouverture, accepter la mise à jour des champs.
