"""Authentification — Argon2id + JWT access/refresh + rotation theft detection.

Modules :
- `password` : hash et vérification Argon2id
- `jwt`      : génération et validation tokens access + refresh
- `repository` : accès DB pour users et refresh_tokens
- `schemas`  : modèles Pydantic v2 (request/response)
- `service`  : orchestration login/refresh/logout/sessions
- `dependencies` : `get_current_user` injectable dans FastAPI
"""
