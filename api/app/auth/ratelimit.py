"""Rate limiting Redis — sliding window simple via INCR + EXPIRE.

Politique :
- Par IP : 5 essais de login en 15 min (anti bruteforce IP)
- Par account (login_str) : 10 essais en 24 h (anti bruteforce ciblé même IP rotation)
- Tous endpoints /auth/* protégés par un global 30 req/min/IP (largesse pour les
  refresh tokens silencieux).

Format clé Redis : `rl:<bucket>:<identifier>` (ex: rl:login_ip:192.168.1.1).

Implémentation : un compteur INCR + EXPIRE atomique (script Lua pour éviter le
gap). Si la valeur dépasse le seuil → 429 + Retry-After (TTL restant).

NB : un vrai sliding window log nécessiterait ZSET ; pour un endpoint d'auth,
un simple compteur fenêtré est suffisant et bien plus rapide.
"""
from __future__ import annotations

from dataclasses import dataclass

import structlog

from app.redis_client import get_redis

log = structlog.get_logger()


# Script Lua atomique : INCR + EXPIRE (premier passage) ; renvoie (count, ttl).
_INCR_EXPIRE_LUA = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return {n, ttl}
"""


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    count: int
    limit: int
    retry_after_seconds: int    # > 0 si bloqué, 0 sinon


async def check_and_incr(
    bucket: str,
    identifier: str,
    *,
    limit: int,
    window_seconds: int,
) -> RateLimitResult:
    """Incrémente le compteur Redis. Retourne `allowed=False` si quota dépassé.

    Bucket usuels :
    - `login_ip` (limit=5, window=900) — 5 essais / 15 min par IP
    - `login_account` (limit=10, window=86400) — 10 / jour par login
    - `auth_global_ip` (limit=30, window=60) — 30 / min par IP (refresh ok)
    """
    if not identifier:
        # Pas d'IP / pas de login → on refuse plutôt que d'avoir un bucket "anonymous" partagé.
        return RateLimitResult(allowed=False, count=0, limit=limit, retry_after_seconds=window_seconds)

    redis = get_redis()
    key = f"rl:{bucket}:{identifier}"

    try:
        result = await redis.eval(_INCR_EXPIRE_LUA, 1, key, str(window_seconds))
        count = int(result[0])
        ttl = max(int(result[1]), 0)
    except Exception as e:
        # Si Redis est down, on FAIL OPEN (permettre, mais logger) — sinon
        # tout l'auth tombe à la première panne Redis. Trade-off documenté.
        log.warning("ratelimit.redis_unavailable", bucket=bucket, error=str(e))
        return RateLimitResult(allowed=True, count=0, limit=limit, retry_after_seconds=0)

    if count > limit:
        log.info(
            "ratelimit.blocked",
            bucket=bucket,
            identifier_hash=identifier[:8] + "***",   # ne pas logger l'IP/login en entier
            count=count,
            limit=limit,
        )
        return RateLimitResult(allowed=False, count=count, limit=limit, retry_after_seconds=ttl)

    return RateLimitResult(allowed=True, count=count, limit=limit, retry_after_seconds=0)


async def reset_bucket(bucket: str, identifier: str) -> None:
    """Reset manuel d'un bucket (utile après login OK : on efface le compteur d'échecs)."""
    try:
        await get_redis().delete(f"rl:{bucket}:{identifier}")
    except Exception:
        pass
