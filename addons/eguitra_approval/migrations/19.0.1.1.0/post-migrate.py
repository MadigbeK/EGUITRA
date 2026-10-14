"""19.0.1.1.0 : empreinte des demandes en cours ou approuvées, prise sur la pièce telle qu'elle est,
si elle correspond encore au montant soumis (sinon la demande reste au contrôle par le montant)."""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    requests = env["eguitra.approval.request"].search(
        [("state", "in", ("pending", "approved")), ("fingerprint", "=", False)]
    )
    for request in requests:
        record = request._record()
        if record and request._matches(record):
            request.fingerprint = record._eguitra_fingerprint()
