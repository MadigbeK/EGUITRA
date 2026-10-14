#!/usr/bin/env bash
# Sécurisation d'un VPS Ubuntu 26.04 LTS vierge pour la plateforme EGUITRA.
# À exécuter une seule fois, avec sudo, depuis le compte « ubuntu » livré par l'hébergeur,
# APRÈS avoir installé une clé SSH pour ce compte (sinon le script s'arrête).
#
#   sudo bash setup-vps.sh
#
# Effets : utilisateur « deploy » (clé SSH, sudo, docker), SSH par clé uniquement et
# root interdit, pare-feu (22, 80, 443), fail2ban, mises à jour de sécurité
# automatiques, Docker officiel, swap de 4 Go, fuseau Africa/Conakry.
# Le script est rejouable sans effet de bord.
set -euo pipefail

DEPLOY_USER=deploy
SOURCE_USER=${SUDO_USER:-ubuntu}
SSH_PORT=22

log() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Lancer avec sudo." >&2; exit 1; }

# Garde-fou : on ne coupe pas les mots de passe tant qu'aucune clé n'est en place.
SRC_KEYS="$(getent passwd "$SOURCE_USER" | cut -d: -f6)/.ssh/authorized_keys"
if [ ! -s "$SRC_KEYS" ]; then
  echo "Aucune clé SSH dans $SRC_KEYS : installer une clé avant de lancer ce script." >&2
  exit 1
fi

log "Mise à jour du système"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ufw fail2ban unattended-upgrades ca-certificates curl gnupg git rclone htop

log "Utilisateur $DEPLOY_USER"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SRC_KEYS" "/home/$DEPLOY_USER/.ssh/authorized_keys"
# sudo sans mot de passe : le compte n'a pas de mot de passe, l'accès est protégé par la clé.
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$DEPLOY_USER
chmod 440 /etc/sudoers.d/90-$DEPLOY_USER
visudo -cf /etc/sudoers.d/90-$DEPLOY_USER

log "SSH : clés uniquement, root interdit"
# Fichier préfixé 00 : sshd retient la première valeur lue, avant les réglages cloud-init.
cat > /etc/ssh/sshd_config.d/00-eguitra.conf <<EOF
Port $SSH_PORT
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowUsers $DEPLOY_USER $SOURCE_USER
EOF
sshd -t
systemctl reload ssh

log "Pare-feu"
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "fail2ban sur SSH"
cat > /etc/fail2ban/jail.d/eguitra.local <<EOF
[sshd]
enabled  = true
port     = $SSH_PORT
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Mises à jour de sécurité automatiques"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
# Pas de redémarrage automatique : un redémarrage se planifie hors heures ouvrées.
cat > /etc/apt/apt.conf.d/51eguitra-unattended <<EOF
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades

log "Docker (dépôt officiel)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
CODENAME="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"
# Journaux des conteneurs bornés, pour ne pas remplir les 100 Go.
cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
EOF
systemctl enable --now docker
systemctl restart docker

log "Swap de 4 Go"
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-eguitra.conf
sysctl -q --system

log "Fuseau horaire"
timedatectl set-timezone Africa/Conakry

log "Terminé"
echo "Tester AVANT de fermer la session en cours, dans un autre terminal :"
echo "  ssh $DEPLOY_USER@$(hostname -I | awk '{print $1}')"
