# Offre technique et financière EGUITRA / MB AxisPro, par E-VOLUTION XP

Deux versions cohabitent :

- **Offre initiale** (15 septembre 2026, deux propositions) : `contenu.js` + `build.js` → `Offre_technique_financiere_EGUITRA.docx`.
- **Offre révisée R1** (30 septembre 2026, proposition 1 seule, réponse aux observations du client) : `contenu-r1.js` + `build-r1.js` → `Offre_revisee_R1_EGUITRA.docx`. Texte du mail de réponse : `mail-reponse-r1.md`.

Le rendu (.docx et .md) est commun aux deux versions : `rendu.js`.

## Offre initiale

- `contenu.js` : hypothèses (dates, validité, VPS), postes et totaux des deux propositions en GNF, planning en quatre semaines. C'est le seul fichier à modifier pour rechiffrer. Le script refuse de construire si la somme des postes diffère du total annoncé.
- `build.js` : contenu rédactionnel et rendu. Produit le `.docx` et le `.md`.
- `logo.png` : logo officiel E-VOLUTION XP, à déposer ici. Tant qu'il est absent, `logo-rendu.png` (rendu vectoriel provisoire issu de `logo-rendu.svg`) est utilisé.
- `Offre_technique_financiere_EGUITRA.docx` : version à envoyer au client.
- `Offre_technique_financiere_EGUITRA.md` : même contenu, lisible dans le dépôt.

Régénérer :

```bash
npm install docx
node docs/offre/build.js      # offre initiale
node docs/offre/build-r1.js   # offre révisée R1
```

Le Word contient une table des matières automatique : à l'ouverture, accepter la mise à jour des champs.
