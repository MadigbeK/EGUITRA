"""Schéma platform initial : users, refresh_tokens, audit_log.

Revision ID: 20261009_0001
Revises: None
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261009_0001"
down_revision = None
branch_labels = None
depends_on = None

S = "platform"


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS platform")
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("login", sa.String(64), nullable=False, unique=True),
        sa.Column("email", sa.String(255), nullable=True, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("odoo_partner_id", sa.Integer, nullable=True),
        sa.Column("odoo_user_id", sa.Integer, nullable=True),
        sa.Column("must_change_pwd", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("is_share", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invitation_token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("invitation_expires_at", sa.DateTime(timezone=True), nullable=True),
        schema=S,
    )
    op.create_index("ix_users_login", "users", ["login"], schema=S)
    op.create_index("ix_users_role", "users", ["role"], schema=S)
    op.create_index("ix_users_odoo_partner_id", "users", ["odoo_partner_id"], schema=S)
    op.create_index("ix_users_odoo_user_id", "users", ["odoo_user_id"], schema=S)
    op.create_index("ix_users_role_active", "users", ["role", "is_active"], schema=S)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rotated_from_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.refresh_tokens.id", ondelete="SET NULL"), nullable=True),
        schema=S,
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], schema=S)
    op.create_index("ix_refresh_tokens_rotated_from_id", "refresh_tokens", ["rotated_from_id"], schema=S)
    op.create_index("ix_refresh_tokens_user_active", "refresh_tokens", ["user_id", "revoked_at"], schema=S)

    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platform.users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=True),
        sa.Column("resource_id", sa.String(64), nullable=True),
        sa.Column("ip_address", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        schema=S,
    )
    op.create_index("ix_audit_log_action", "audit_log", ["action"], schema=S)
    op.create_index("ix_audit_log_request_id", "audit_log", ["request_id"], schema=S)
    op.create_index("ix_audit_log_success", "audit_log", ["success"], schema=S)
    op.create_index("ix_audit_log_user_occurred", "audit_log", ["user_id", "occurred_at"], schema=S)
    op.create_index("ix_audit_log_action_occurred", "audit_log", ["action", "occurred_at"], schema=S)


def downgrade() -> None:
    op.drop_table("audit_log", schema=S)
    op.drop_table("refresh_tokens", schema=S)
    op.drop_table("users", schema=S)
