#!/usr/bin/env bash
# Préparation d'un VPS Ubuntu 24.04 vierge : durcissement, Docker, utilisateur deploy.
# À exécuter en root, une seule fois.
set -euo pipefail

DEPLOY_USER=deploy
SSH_PORT=22

apt-get update && apt-get -y upgrade
apt-get -y install ufw fail2ban unattended-upgrades ca-certificates curl gnupg git rclone htop

# Utilisateur de déploiement avec la clé SSH de root
id -u "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
mkdir -p /home/$DEPLOY_USER/.ssh
cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh && chmod 700 /home/$DEPLOY_USER/.ssh && chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys

# SSH : clés uniquement
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# Pare-feu : SSH, HTTP, HTTPS
ufw default deny incoming && ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# Mises à jour de sécurité automatiques
dpkg-reconfigure -f noninteractive unattended-upgrades

# Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"

# Swap de 4 Go : Odoo et PostgreSQL sur 8 Go de RAM
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

timedatectl set-timezone Africa/Conakry
echo "Serveur prêt. Connectez-vous avec : ssh $DEPLOY_USER@$(curl -s ifconfig.me)"
