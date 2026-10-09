# Offre technique et financière EGUITRA / MB AxisPro, par E-VOLUTION XP

Deux versions cohabitent :

- **Offre initiale** (15 septembre 2026, deux propositions) : `contenu.js` + `build.js` → `Offre_technique_financiere_EGUITRA.docx`.
- **Offre révisée R1** (30 septembre 2026, proposition 1 seule, réponse aux observations du client) : `contenu-r1.js` + `build-r1.js` → `Offre_revisee_R1_EGUITRA.docx`. Texte du mail de réponse : `mail-reponse-r1.md`.

- **Offre finale v2** (30 septembre 2026, proposition unique, présentée comme une offre originale, sans donnée du JSON de test) : `contenu-v2.js` + `build-v2.js` → `Offre_technique_financiere_EGUITRA_v2.docx`. C'est la version à envoyer.

- **Annexe détail par poste** (7 octobre 2026, demandée par le client avant le cadrage) : `build-annexe-postes.js` → `Annexe_detail_par_poste_EGUITRA.docx`. Mail : `mail-reponse-annexe.md`.

Le rendu (.docx et .md) est commun à toutes les versions : `rendu.js`.

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
node docs/offre/build-v2.js   # offre finale v2
```

Le Word contient une table des matières automatique : à l'ouverture, accepter la mise à jour des champs.

## Réunion de cadrage (`cadrage/`)

- `build-deck.js` → `Reunion_de_cadrage_EGUITRA.pptx` : support projeté en réunion, 14 diapositives avec notes pour l'animateur.
- `build-ordre-du-jour.js` → `Ordre_du_jour_cadrage_EGUITRA.docx` : ordre du jour d'une page à envoyer au client. Mail : `mail-confirmation-date.md`.
- `build-kit.js` → `Kit_reunion_de_cadrage_EGUITRA.docx` : guide interne de préparation, fiches d'atelier, fiche de décisions, modèle de compte rendu, pièges. Ne pas transmettre au client.

```bash
npm install pptxgenjs react-icons react react-dom sharp
node docs/offre/cadrage/build-deck.js
node docs/offre/cadrage/build-kit.js
node docs/offre/cadrage/build-ordre-du-jour.js
```
