"""Hashing Argon2id — state-of-art OWASP 2025+ (ADR-008).

Paramètres validés :
- type=Argon2id (résistance side-channel + brute force)
- memory_cost=64 MiB (65536 KiB)
- time_cost=3 itérations
- parallelism=1 (single-thread, suffisant)
- hash_len=32 bytes (256 bits)
- salt_len=16 bytes

Coût mesuré ~50-100 ms sur CPU server moderne. Acceptable car rate-limited.

Si on doit migrer les params plus tard (ex: augmenter memory_cost), le
PasswordHasher détecte automatiquement les anciens hashes et trigger un
rehash transparent au prochain login (via `needs_rehash`).
"""

from __future__ import annotations

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError

from app.config import get_settings


def _make_hasher() -> PasswordHasher:
    settings = get_settings()
    return PasswordHasher(
        type=Type.ID,
        memory_cost=settings.argon2_memory_cost,  # 65536 = 64 MiB
        time_cost=settings.argon2_time_cost,  # 3
        parallelism=1,
        hash_len=32,
        salt_len=16,
    )


_hasher = _make_hasher()


def hash_password(plain: str) -> str:
    """Hash un mot de passe avec Argon2id. Le sel est généré automatiquement.

    Retourne un string complet `$argon2id$v=19$m=...,t=...,p=.../<salt>/<hash>`
    qui contient TOUS les paramètres nécessaires à la vérification.
    """
    if not plain:
        raise ValueError("plain password must be non-empty")
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Vérifie un mot de passe contre un hash Argon2id.

    Retourne True/False ; ne lève PAS d'exception en cas de mismatch
    (les exceptions servent juste au logging interne).

    Le temps de calcul est constant côté Argon2 (résistance timing-attack).
    """
    if not plain or not hashed:
        return False
    try:
        return _hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False
    except Exception:
        # Format de hash invalide, lib corrompue, etc.
        return False


def needs_rehash(hashed: str) -> bool:
    """Indique si le hash a été produit avec des params plus faibles que les
    courants. Utilisé pour faire un re-hash transparent au prochain login.
    """
    try:
        return _hasher.check_needs_rehash(hashed)
    except Exception:
        return False
