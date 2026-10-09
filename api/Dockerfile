# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# Stage 1 : build (deps Python isolées)
# ─────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY pyproject.toml ./
RUN pip install --prefix=/install ".[dev]"

# ─────────────────────────────────────────────────────────────────────
# Stage 2 : runtime (image minimale)
# ─────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/usr/local/bin:$PATH

# Runtime deps + postgresql-client-16 (pour pg_dump du job backup).
# Le serveur Postgres est en v16 ; le client par défaut de Debian bookworm est
# en v15 et pg_dump refuse de dumper un serveur plus récent que lui. On ajoute
# donc le dépôt officiel PGDG pour installer précisément postgresql-client-16.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    procps \
    gnupg \
    ca-certificates \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsS https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1000 eguitra \
 && useradd -u 1000 -g eguitra -m -s /bin/bash eguitra \
 && mkdir -p /data/backups \
 && chown -R eguitra:eguitra /data

COPY --from=builder /install /usr/local
COPY --chown=eguitra:eguitra app /app/app
COPY --chown=eguitra:eguitra scripts /app/scripts
COPY --chown=eguitra:eguitra migrations /app/migrations
COPY --chown=eguitra:eguitra alembic.ini /app/alembic.ini
COPY --chown=eguitra:eguitra entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

WORKDIR /app
USER eguitra

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# SERVICE_ROLE=api (défaut) ou worker — voir docker-compose.yml
ENTRYPOINT ["/app/entrypoint.sh"]
