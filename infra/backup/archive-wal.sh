#!/bin/sh
# archive_command de PostgreSQL (exécuté dans le conteneur db, utilisateur postgres) :
# copie compressée, atomique et durable d'un segment WAL dans /backup/wal.
#   archive_command = 'sh /usr/local/bin/archive-wal.sh %p %f'
# Un code de sortie non nul fait recommencer PostgreSQL plus tard : aucun segment n'est perdu.
set -eu
src="$1"
name="$2"
dir=/backup/wal
dest="$dir/$name.gz"

if [ -f "$dest" ]; then
  # Déjà archivé (relance après un incident) : accepté seulement si le contenu est identique.
  gunzip -c "$dest" | cmp -s - "$src"
  exit $?
fi
gzip -c "$src" > "$dest.tmp"
sync "$dest.tmp"
mv "$dest.tmp" "$dest"
sync "$dir"
