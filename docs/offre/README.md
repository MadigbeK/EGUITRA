# Offre technique et financière EGUITRA / MB AxisPro, par E-VOLUTION XP

Offre du 29 septembre 2026, référence OTF-EGUITRA-2026-37 : plateforme de gestion intégrée EGUITRA Finance et AxisPro Suite sur noyau Odoo Community, 50 000 000 GNF HT, puis 9 000 000 GNF HT par an. Elle annule et remplace l'offre du 15 septembre 2026 et intègre les demandes du client (validité 30 jours, garantie 6 mois, perte de données maximale 15 minutes, pénalités de retard, règles de maintenance évolutive).

- `contenu.js` : hypothèses (dates, validité, garantie), sauvegardes, pénalités, maintenance évolutive, postes et total, planning. Seul fichier à modifier pour rechiffrer ; le script refuse de construire si la somme des postes diffère du total.
- `build.js` : contenu rédactionnel et rendu. Produit le `.docx` et le `.md`.
- `logo.png` : logo officiel E-VOLUTION XP, à déposer ici. Tant qu'il est absent, `logo-rendu.png` (rendu vectoriel provisoire issu de `logo-rendu.svg`) est utilisé.
- `Offre_technique_financiere_EGUITRA.docx` : version à envoyer au client.
- `Offre_technique_financiere_EGUITRA.md` : même contenu, lisible dans le dépôt.
- `mail-reponse.md` : courrier accompagnant l'offre du 29 septembre.
- `mail-envoi.md` : courrier qui accompagnait l'offre du 15 septembre.
- `envoyes/` : PDF exactement tels qu'envoyés au client. La source de l'offre du 15 septembre est le commit « Aligne la source sur la version de l'offre envoyée au client ».

Régénérer :

```bash
npm install
node docs/offre/build.js
```

Le Word contient une table des matières automatique : à l'ouverture, accepter la mise à jour des champs.
