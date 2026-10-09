"""Base SQLAlchemy 2.0 declarative + métadonnées schema `platform`."""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Convention de nommage des contraintes — bénéfique pour les migrations Alembic
# (les noms générés sont stables et lisibles, pas des hash random).
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base déclarative pour tous les modèles ORM de la plateforme.

    Toutes les tables vivent dans le schema `platform` (séparé du schema
    `public` qui appartient à Odoo).
    """

    metadata = MetaData(
        naming_convention=NAMING_CONVENTION,
        schema="platform",
    )
