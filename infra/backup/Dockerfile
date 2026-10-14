# Conteneur des sauvegardes : outils PostgreSQL 16 (même version que le serveur), rsync, rclone.
FROM postgres:16
RUN apt-get update \
 && apt-get install -y --no-install-recommends rclone rsync ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY common.sh base-backup.sh files-backup.sh offsite.sh check.sh scheduler.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/*.sh
ENTRYPOINT []
CMD ["/usr/local/bin/scheduler.sh"]
