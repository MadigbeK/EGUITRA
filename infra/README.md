# Infrastructure EGUITRA : serveur, noyau, sauvegardes

## 1. Achat du VPS

| Élément | Choix |
|---|---|
| Fournisseur | Hetzner (CPX31 ou CX32), OVH (VPS Comfort) ou Contabo. Hetzner est le meilleur rapport prix et fiabilité. |
| Taille | 4 vCPU, 8 Go de RAM, 160 Go NVMe, comme dans l'offre. |
| Système | Ubuntu 24.04 LTS, installation vierge, sans panneau d'administration. |
| Localisation | Europe de l'Ouest (Falkenstein, Nuremberg, Gravelines) : meilleure latence vers Conakry. |
| Accès | Clé SSH à l'achat, pas de mot de passe root. |
| Stockage de sauvegarde hors site | Chez un autre fournisseur : Backblaze B2 ou Scaleway Object Storage, 50 Go suffisent la première année. |

À m'envoyer dès l'achat : l'adresse IP, la clé publique SSH utilisée, le nom de domaine retenu, les identifiants du stockage hors site.

## 2. Mise en route, dans l'ordre

```bash
# Sur le serveur, en root, une seule fois
curl -fsSL https://raw.githubusercontent.com/MadigbeK/EGUITRA/claude/erp-odoo-clients-eu6ep6/infra/setup-vps.sh | bash
# ou : scp infra/setup-vps.sh root@IP: && ssh root@IP bash setup-vps.sh

# Ensuite, avec l'utilisateur deploy créé par le script
git clone https://github.com/MadigbeK/EGUITRA.git ~/eguitra && cd ~/eguitra/infra
cp .env.example .env            # puis renseigner les secrets et le domaine
./fetch-oca.sh                  # clone les dépôts OCA (branche 17.0)
docker compose up -d            # postgres, odoo, caddy (TLS automatique)
docker compose logs -f odoo     # attendre « HTTP service (werkzeug) running »
```

Création de la base et installation des modules :

```bash
docker compose exec odoo odoo -d eguitra -i base,account,l10n_syscohada,analytic,fleet,project,contract,mis_builder,account_asset_management,account_financial_report,account_reconcile_oca,base_tier_validation,auditlog,eguitra_core --stop-after-init --load-language=fr_FR
```

## 3. Sauvegardes renforcées

- `backup/backup.sh` : sauvegarde complète quotidienne (dump PostgreSQL + filestore), chiffrée, envoyée hors site par `rclone`. Rétention 30 jours et 12 mensuelles.
- Archivage continu : PostgreSQL écrit ses journaux de transactions dans le volume `wal-archive` ; `backup/sync-wal.sh` les pousse hors site toutes les 15 minutes.
- `backup/restore.sh` : restauration à une date, ou à un instant précis entre deux sauvegardes complètes.
- Installation des crons : `backup/install-cron.sh`.

## 4. Environnements

- Production : `https://finance.<domaine>` et `https://axispro.<domaine>` servis par Caddy vers le même Odoo, bases séparées si la direction le souhaite.
- Recette : même machine, base `eguitra_recette`, hôte `recette.<domaine>`.
- Le client web du noyau (`/web`) n'est joignable que depuis les adresses IP listées dans `Caddyfile` (`@admin`). Les utilisateurs n'accèdent qu'à la surcouche.
