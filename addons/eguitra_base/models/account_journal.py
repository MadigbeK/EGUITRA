"""Journaux : réglages des factures imprimées et numérotation reprise de l'ancien système.

Journal de vente : signataire et modes de règlement portés au bas de la facture, dernier numéro de
l'ancien système. La première facture comptabilisée du journal prend le numéro suivant ; le noyau
continue ensuite de lui-même (account_move.py, _get_next_sequence_format). Le moteur du noyau continue
toujours le dernier groupe de chiffres du numéro : un format dont le compteur n'est pas en fin de numéro
(« 0026/MBAX06/26 » : compteur, mois, année) est refusé, avec le format continu le plus proche.

Journal de banque : « afficher sur les factures » ; chaque compte marqué est listé dans les conditions de
règlement des factures de la société (banque, numéro, IBAN, SWIFT).
"""

import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError

DEFAULT_SIGNATORY = "Service Comptabilité & Finance"
DEFAULT_PAYMENT_METHODS = "Par chèque ou virement bancaire"
# Formats que le noyau sait continuer : compteur continu, remis à zéro chaque année ou chaque mois.
CONTINUABLE_RESETS = ("never", "year", "month")
REFUNDS = ("out_refund", "in_refund")


class AccountJournal(models.Model):
    _inherit = "account.journal"

    eguitra_signatory = fields.Char(
        "Signataire des factures", default=DEFAULT_SIGNATORY,
        help="Service qui signe les factures du journal, en bas à droite, au-dessus de la raison sociale.",
    )
    eguitra_payment_methods = fields.Char(
        "Modes de règlement", default=DEFAULT_PAYMENT_METHODS,
        help="Ligne des conditions de règlement des factures du journal (« Par chèque ou virement bancaire »).",
    )
    eguitra_legacy_last_number = fields.Char(
        "Dernier numéro de l'ancien système", copy=False,
        help="Numéro de la dernière facture émise avant la plateforme (« EG24137 ») : la première facture "
             "comptabilisée du journal prend le numéro suivant, puis la numérotation continue.",
    )
    eguitra_show_on_invoices = fields.Boolean(
        "Afficher sur les factures", copy=False,
        help="Compte bancaire listé dans les conditions de règlement des factures de la société.",
    )

    @api.constrains("eguitra_legacy_last_number", "type")
    def _check_eguitra_legacy_last_number(self):
        for journal in self.filtered("eguitra_legacy_last_number"):
            if journal.type != "sale":
                raise ValidationError("Le dernier numéro de l'ancien système ne concerne que les journaux de vente.")
            refusal = journal._eguitra_legacy_refusal(journal.eguitra_legacy_last_number)
            if refusal:
                raise ValidationError(refusal["message"])
            numbered = journal._eguitra_numbered_invoice()
            if numbered:
                raise ValidationError(
                    f"Le journal {journal.name} numérote déjà ses factures (dernière : {numbered.name}) : la "
                    "numérotation continue d'elle-même, le dernier numéro de l'ancien système ne s'y applique plus.")

    # ─── Numérotation reprise de l'ancien système ─────────────────────────

    def _eguitra_numbered_invoice(self):
        """Dernière facture déjà numérotée du journal (avoirs exclus quand ils ont leur propre suite)."""
        self.ensure_one()
        domain = [("journal_id", "=", self.id), ("name", "not in", ("/", "", False))]
        if self.refund_sequence:
            domain.append(("move_type", "not in", REFUNDS))
        return self.env["account.move"].sudo().search(domain, order="id desc", limit=1)

    @staticmethod
    def _eguitra_year_like(digits, day):
        """Groupe de chiffres qui se lit comme l'année de `day` ou la précédente (« 2026 », « 26 »)."""
        years = (day.year, day.year - 1)
        if len(digits) == 4:
            return int(digits) in years
        return len(digits) == 2 and int(digits) in {y % 100 for y in years}

    def _eguitra_nearest_number(self, number, day):
        """Format continu le plus proche d'un numéro refusé : lettres du numéro (à défaut, code du journal),
        année, compteur à quatre chiffres au moins (« 0026/MBAX06/26 » -> « MBAX/2026/0026 »)."""
        letters = "".join(re.findall(r"[A-Za-z]+", number)).upper() or (self.code or "FA").upper()
        groups = re.findall(r"\d+", number)
        counters = [g for g in groups if not (len(g) == 4 and self._eguitra_year_like(g, day))] or groups
        counter = max(counters, key=len) if counters else "0"
        width = max(4, len(counter))
        return f"{letters}/{day.year}/{int(counter):0{width}d}", f"{letters}/{day.year}/{int(counter) + 1:0{width}d}"

    def _eguitra_legacy_refusal(self, number, day=None):
        """None si le noyau sait continuer ce numéro ; sinon {"message", "suggestion", "next"} : pourquoi,
        et le format continu le plus proche (dernier numéro à saisir, numéro de la première facture)."""
        self.ensure_one()
        number = (number or "").strip()
        day = day or fields.Date.context_today(self)
        Move = self.env["account.move"]
        groups = re.findall(r"\d+", number)
        try:
            reset = Move._deduce_sequence_number_reset(number)
            format_string, values = Move._get_sequence_format_param(number)
            readable = format_string.format(**values) == number
        except (ValidationError, ValueError, KeyError):
            reset, values, readable = None, {}, False
        if not groups:
            reason = "il ne porte aucun compteur (aucun chiffre)"
        elif len(groups[-1]) > 9:
            reason = "son compteur dépasse neuf chiffres"
        elif not readable or reset not in CONTINUABLE_RESETS:
            reason = "le noyau n'en reconnaît pas le format"
        elif reset != "never" and str(values["year"]).zfill(values["year_length"]) not in {
                str(y)[-values["year_length"]:] for y in (day.year, day.year - 1)}:
            # « 0026/MBAX06/26 » se lit année 06, compteur 26 : la suite serait 0026/MBAX06/27.
            reason = "le compteur n'est pas en fin de numéro"
        elif reset == "never" and len(groups) > 1 and self._eguitra_year_like(groups[-1], day):
            # « 0026/MBAX/2026 » : le noyau ferait de l'année le compteur (0026/MBAX/2027).
            reason = "le compteur n'est pas en fin de numéro (le numéro finit par l'année)"
        else:
            return None
        suggestion, following = self._eguitra_nearest_number(number, day)
        return {
            "message": (f"Numéro « {number} » refusé : {reason}. La numérotation du noyau continue toujours le "
                        f"dernier groupe de chiffres du numéro, et ne saurait pas continuer celui-ci. Format "
                        f"continu le plus proche : saisissez « {suggestion} » ; la première facture portera "
                        f"« {following} », puis la numérotation repartira à 0001 chaque année."),
            "suggestion": suggestion,
            "next": following,
        }

    def _eguitra_legacy_format(self, number, day):
        """Format et valeurs du noyau pour continuer `number` à la date `day` (sequence.mixin) : compteur du
        numéro, sauf changement d'année ou de mois d'un format qui s'y remet à zéro (compteur à 0, période
        de `day`), comme le noyau le fait pour une nouvelle période."""
        Move = self.env["account.move"]
        format_string, values = Move._get_sequence_format_param(number)
        reset = Move._deduce_sequence_number_reset(number)
        if reset != "never":
            year = Move._truncate_year_to_length(day.year, values["year_length"])
            if values["year"] != year or (reset == "month" and values["month"] != day.month):
                values.update(seq=0, year=year, month=day.month)
        return format_string, values

    def _eguitra_next_number(self, day=None):
        """Numéro que prendra la prochaine facture comptabilisée du journal, datée de `day` (aujourd'hui)."""
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        move = self.env["account.move"].with_company(self.company_id).new(
            {"journal_id": self.id, "move_type": "out_invoice", "date": day, "company_id": self.company_id.id})
        format_string, values = move._get_next_sequence_format()
        return format_string.format(**dict(values, seq=values["seq"] + 1))


class ResPartnerBank(models.Model):
    _inherit = "res.partner.bank"

    eguitra_iban = fields.Char("IBAN", help="IBAN du compte, imprimé sur les factures à côté du numéro de compte.")
