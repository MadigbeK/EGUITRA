# EGUITRA : plateforme EGUITRA Finance et AxisPro Suite

Projet mené par E-VOLUTION XP (Madigbè Kouyaté, gérant) pour EGUITRA GROUP SARLU et MB AxisPro Consulting, Conakry.
Avant toute action, lire `docs/projet/ETAT.md` : décisions prises, état d'avancement, prochaines étapes, engagements contractuels.

## Repères
- Offre contractuelle : `docs/offre/Offre_technique_financiere_EGUITRA.md` (réf. OTF-EGUITRA-2026-37, 50 000 000 GNF HT, 4 semaines, pénalités de retard). Tout ce qui y est décrit est dû au client ; ne jamais réduire le périmètre sans décision explicite du gérant.
- Générateur de l'offre : `node docs/offre/build.js` (source unique des chiffres : `docs/offre/contenu.js`).
- Documents de projet : `docs/projet/`.
- Langue de travail : français. Montants en GNF hors taxes.

## Décisions techniques (raisons dans ETAT.md)
- Odoo 19.0 Community + dix modules OCA 19.0 épinglés (`infra/oca/`), confirmé. Moteur d'approbation spécifique (`addons/eguitra_approval`) à la place de `base_tier_validation`, absent en 19.0.
- Huit modules `addons/eguitra_*` ; l'API métier (`/api/v1`, `eguitra_api`) s'exécute dans le noyau sous l'identité de l'utilisateur. L'utilisateur ne voit jamais Odoo.
- Une seule application Next.js (`apps/web`) pour les quatre surfaces : `/finance`, `/axispro`, `/portail`, `/mobile` (Rotations, application web progressive hors ligne). Le navigateur ne parle qu'à la passerelle `/api/odoo`.
- Déploiement en conteneurs (Docker Compose) sur un VPS Ubuntu 26.04 LTS. Deux environnements complets et séparés sur le même serveur : production (`db`, `odoo`, `web`) et recette (`db-recette`, `odoo-recette`, `web-recette`), sans base, secret ni cookie communs. Exploitation : `infra/README.md`.
- Multi-sociétés : EGUITRA GROUP SARLU et MB AxisPro Consulting dans la même base de chaque environnement, comptabilités séparées, un même compte pouvant être ouvert aux deux sociétés (engagement pris auprès du client).
- Sauvegardes : archivage continu des WAL (15 minutes au plus), sauvegarde de base quotidienne, pièces jointes toutes les 15 minutes, copie hors site chiffrée chez un second hébergeur (`infra/backup/README.md`).

## Travailler sur le code
- Tests des modules : `infra/test.sh module…` sur le serveur (base jetable). Lint Python : `ruff check addons scripts`. Web : `npx tsc --noEmit` et `npx next build` dans `apps/web`.
- Envoi du code sur la recette : `scripts/dev/sync.sh`. Après installation ou mise à jour de modules, toujours redémarrer le noyau (module d'audit).
- La production ne change que par `infra/release.sh` (version figée, sauvegarde, mise à jour, contrôle). Jamais de données de démonstration ni de test en production.
- Tâches longues sur le serveur : les lancer détachées (`nohup … &`, journal dans `~/eguitra/logs/`) ; une coupure SSH tue sinon le travail en cours.
- Écrire les fichiers en fins de ligne LF (les scripts shell en CRLF ne s'exécutent pas sur le serveur).

## Conventions
- Commits en français, un sujet par commit. Branche de travail : `claude/bold-shannon-gpg2hv` (aucune branche main pour l'instant).
- Ne jamais committer de secrets : `.env`, clés SSH, mots de passe. Fournir des `.env.example`.
- Chaque fin de session : mettre à jour `docs/projet/ETAT.md` (fait, en cours, prochaine étape) avant de pousser.
