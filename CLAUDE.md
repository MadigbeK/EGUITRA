# EGUITRA : plateforme EGUITRA Finance et AxisPro Suite

Projet mené par E-VOLUTION XP (Madigbè Kouyaté, gérant) pour EGUITRA GROUP SARLU et MB AxisPro Consulting, Conakry.
Avant toute action, lire `docs/projet/ETAT.md` : décisions prises, état d'avancement, prochaines étapes, engagements contractuels.

## Repères
- Offre contractuelle : `docs/offre/Offre_technique_financiere_EGUITRA.md` (réf. OTF-EGUITRA-2026-37, 50 000 000 GNF HT, 4 semaines, pénalités de retard). Tout ce qui y est décrit est dû au client ; ne jamais réduire le périmètre sans décision explicite du gérant.
- Générateur de l'offre : `node docs/offre/build.js` (source unique des chiffres : `docs/offre/contenu.js`).
- Documents de projet : `docs/projet/`.
- Langue de travail : français. Montants en GNF hors taxes.

## Décisions techniques (raisons dans ETAT.md)
- Odoo 19.0 Community + modules OCA 19.0. Les trois modules d'approbation OCA n'existent pas en 19.0 : porter `base_tier_validation` (limité à 2 jours) ou écrire un moteur spécifique. Porte de sortie vers Odoo 18.0 ouverte jusqu'à la fin de la semaine 1.
- Déploiement en conteneurs (Docker Compose) sur un VPS Ubuntu 26.04 LTS, deux environnements (recette et production) sur le même serveur.
- Sauvegardes : journalisation continue PostgreSQL copiée hors site toutes les 15 minutes chez un second hébergeur, sauvegarde complète quotidienne, pièces jointes synchronisées chaque heure.
- Application mobile de saisie des rotations : application web progressive installable, fonctionnant hors ligne.

## Conventions
- Commits en français, un sujet par commit. Branche de travail : `claude/bold-shannon-gpg2hv` (aucune branche main pour l'instant).
- Ne jamais committer de secrets : `.env`, clés SSH, mots de passe. Fournir des `.env.example`.
- Chaque fin de session : mettre à jour `docs/projet/ETAT.md` (fait, en cours, prochaine étape) avant de pousser.
