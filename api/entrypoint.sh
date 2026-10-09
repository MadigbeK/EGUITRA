#!/bin/sh
# Entry point du container API.
# - Lance les migrations Alembic en premier (idempotent : si rien à faire, rien fait)
# - Puis démarre le serveur (uvicorn) OU le worker (arq) selon $SERVICE_ROLE.
set -e

echo "==> Running Alembic migrations (target=head)"
alembic upgrade head

case "${SERVICE_ROLE:-api}" in
  api)
    echo "==> Starting FastAPI (uvicorn)"
    exec uvicorn app.main:app \
      --host 0.0.0.0 \
      --port 8000 \
      --proxy-headers \
      --forwarded-allow-ips="*"
    ;;
  worker)
    echo "==> Starting Arq worker"
    exec arq app.jobs.worker.WorkerSettings
    ;;
  *)
    echo "Unknown SERVICE_ROLE: ${SERVICE_ROLE}" >&2
    exit 1
    ;;
esac
