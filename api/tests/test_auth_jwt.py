"""Tests unitaires pour app.auth.jwt."""

from __future__ import annotations

import time
import uuid
from datetime import UTC

import pytest

from app.auth.jwt import (
    InvalidTokenError,
    decode_access_token,
    hash_refresh_token,
    issue_tokens,
)


def test_issue_tokens_returns_valid_pair() -> None:
    user_id = uuid.uuid4()
    tokens = issue_tokens(user_id, role="super_admin")

    assert tokens.access_token
    assert tokens.refresh_token
    assert tokens.refresh_token_hash
    assert len(tokens.refresh_token_hash) == 64  # SHA-256 hex
    assert tokens.access_expires_at < tokens.refresh_expires_at
    # exp future
    assert tokens.access_expires_at.tzinfo == UTC
    assert tokens.refresh_expires_at.tzinfo == UTC


def test_decode_access_token_round_trip() -> None:
    user_id = uuid.uuid4()
    tokens = issue_tokens(user_id, role="commercial")
    claims = decode_access_token(tokens.access_token)

    assert claims.sub == str(user_id)
    assert claims.role == "commercial"
    assert claims.exp > int(time.time())
    assert claims.jti


def test_decode_access_token_rejects_garbage() -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token("not-a-jwt")


def test_decode_access_token_rejects_wrong_signature() -> None:
    user_id = uuid.uuid4()
    tokens = issue_tokens(user_id, role="admin")
    # Altère la signature
    parts = tokens.access_token.split(".")
    forged = ".".join([*parts[:2], "AAAA" + parts[2][4:]])
    with pytest.raises(InvalidTokenError):
        decode_access_token(forged)


def test_hash_refresh_token_deterministic() -> None:
    t = "the-refresh-token-foo-bar"
    assert hash_refresh_token(t) == hash_refresh_token(t)


def test_hash_refresh_token_different_for_different_inputs() -> None:
    assert hash_refresh_token("a") != hash_refresh_token("b")


def test_two_issued_refresh_tokens_differ() -> None:
    user_id = uuid.uuid4()
    a = issue_tokens(user_id, "admin")
    b = issue_tokens(user_id, "admin")
    assert a.refresh_token != b.refresh_token
    assert a.refresh_token_hash != b.refresh_token_hash
    # Les access tokens diffèrent aussi (jti unique)
    assert a.access_token != b.access_token
