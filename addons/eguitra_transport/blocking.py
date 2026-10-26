"""Motifs qui s'opposent au passage d'une rotation (départ en route, validation), au format convenu avec
le module HSSEQ : {code, label, source, since, waivable, severity}."""

from odoo.exceptions import UserError


def motif(code, label, source, since=None, waivable=False, severity="block"):
    """Un motif : severity « block » (le passage est refusé) ou « warn » (vigilance, notée au départ)."""
    return {"code": code, "label": label, "source": source, "since": since, "waivable": waivable,
            "severity": severity}


class RotationBlocked(UserError):
    """Passage refusé : blockers porte la liste des motifs (bloquants et vigilances)."""

    def __init__(self, message, blockers):
        super().__init__(f"{message} : {'; '.join(b['label'] for b in blockers if b['severity'] == 'block')}")
        self.blockers = blockers
