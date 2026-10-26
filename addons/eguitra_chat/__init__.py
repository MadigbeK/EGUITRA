"""Discussion interne de la plateforme (NIMOVA) : conversations entre comptes internes, servies par l'API
(/api/v1/chat/...) sous l'identité du compte ; l'utilisateur ne voit jamais le noyau."""

from . import models
from . import controllers

# Modèles suivis par la piste d'audit (eguitra_base, ensure_audit_rules) : les conversations et leurs
# membres (qui a ouvert quelle conversation, qui y a été ajouté ou retiré). Les messages eux-mêmes et les
# accusés de lecture en sont écartés (AUDIT_EXCLUDED_MODELS d'eguitra_base) : correspondance privée, que
# la piste d'audit, lue par l'administration, ne doit pas recopier.
AUDITED_MODELS = ["eguitra.chat.channel", "eguitra.chat.member"]


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
