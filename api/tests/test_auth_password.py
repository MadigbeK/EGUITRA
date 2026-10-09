"""Tests unitaires pour app.auth.password (Argon2id)."""

from __future__ import annotations

from app.auth.password import hash_password, needs_rehash, verify_password


def test_hash_password_returns_argon2id_format() -> None:
    h = hash_password("correct horse battery staple")
    assert h.startswith("$argon2id$")


def test_verify_password_ok() -> None:
    pw = "correct horse battery staple"
    h = hash_password(pw)
    assert verify_password(pw, h) is True


def test_verify_password_ko() -> None:
    h = hash_password("correct horse battery staple")
    assert verify_password("wrong", h) is False


def test_verify_password_empty_inputs() -> None:
    h = hash_password("foo")
    assert verify_password("", h) is False
    assert verify_password("foo", "") is False
    assert verify_password("", "") is False


def test_verify_password_malformed_hash() -> None:
    """Un hash corrompu retourne False, ne lève pas."""
    assert verify_password("foo", "not-a-real-hash") is False


def test_two_hashes_of_same_password_differ() -> None:
    """Argon2id génère un sel aléatoire → deux hashes du même password diffèrent."""
    pw = "same password"
    h1 = hash_password(pw)
    h2 = hash_password(pw)
    assert h1 != h2
    assert verify_password(pw, h1) is True
    assert verify_password(pw, h2) is True


def test_needs_rehash_false_for_current_params() -> None:
    h = hash_password("foo")
    assert needs_rehash(h) is False
