"""Contenus publiés par le cabinet sur le portail : centre de ressources (articles, guides, fiches,
questions fréquentes, vidéos) et communications (annonces, opportunités, alertes)."""

import math
import re

from odoo import api, fields, models
from odoo.exceptions import UserError

PUBLICATION_STATES = [("draft", "Brouillon"), ("published", "Publié"), ("archived", "Archivé")]
ARTICLE_KINDS = [
    ("article", "Article"),
    ("guide", "Guide pratique"),
    ("fiche", "Fiche outil"),
    ("faq", "Question fréquente"),
    ("video", "Vidéo"),
    ("modele", "Modèle à télécharger"),
]
ANNOUNCEMENT_KINDS = [
    ("info", "Information"),
    ("important", "Important"),
    ("opportunity", "Opportunité de financement"),
    ("event", "Rendez-vous du cabinet"),
    ("alert", "Alerte"),
]
CATEGORY_COLORS = ("azur", "lagon", "or", "jade", "corail", "violet")
MAX_BODY = 60_000


def reading_minutes(text):
    words = len(re.findall(r"\w+", text or ""))
    return max(1, math.ceil(words / 200)) if words else 0


class PortailCategory(models.Model):
    _name = "portail.category"
    _description = "Rubrique du centre de ressources"
    _order = "sequence, id"

    name = fields.Char("Rubrique", required=True)
    description = fields.Char("Description")
    icon = fields.Char("Icône", default="BookOpen")
    color = fields.Selection([(c, c) for c in CATEGORY_COLORS], "Teinte", default="azur", required=True)
    sequence = fields.Integer(default=10)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    article_ids = fields.One2many("portail.article", "category_id", "Contenus")


class PortailArticle(models.Model):
    _name = "portail.article"
    _description = "Contenu du centre de ressources"
    _order = "featured desc, published_at desc, id desc"

    name = fields.Char("Titre", required=True)
    summary = fields.Char("Chapeau")
    body = fields.Text("Texte", help="Mise en forme simple : # titre, **gras**, *italique*, - liste, > citation, [lien](https://...).")
    kind = fields.Selection(ARTICLE_KINDS, "Format", default="article", required=True)
    category_id = fields.Many2one("portail.category", "Rubrique", ondelete="set null")
    tags = fields.Char("Mots-clés", help="Séparés par des virgules.")
    gate_codes = fields.Char("Recommandé aux étapes", help="Codes des étapes (G0, G1...) : le contenu est proposé "
                                                          "en priorité aux dossiers qui y sont.")
    video_url = fields.Char("Adresse de la vidéo")
    featured = fields.Boolean("À la une")
    state = fields.Selection(PUBLICATION_STATES, default="draft", required=True)
    published_at = fields.Datetime("Publié le", readonly=True)
    author_id = fields.Many2one("res.users", "Auteur", default=lambda self: self.env.user)
    attachment_ids = fields.Many2many("ir.attachment", "portail_article_attachment_rel", "article_id", "attachment_id",
                                      "Fichiers à télécharger")
    reading_minutes = fields.Integer("Temps de lecture (min)", compute="_compute_reading", store=True)
    view_count = fields.Integer("Lectures", readonly=True)
    reaction_ids = fields.One2many("portail.article.reaction", "article_id", "Réactions")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)

    @api.depends("body")
    def _compute_reading(self):
        for article in self:
            article.reading_minutes = reading_minutes(article.body)

    @api.constrains("body", "video_url")
    def _check_content(self):
        for article in self:
            if len(article.body or "") > MAX_BODY:
                raise UserError("Texte trop long (60 000 caractères au plus).")
            if article.video_url and not article.video_url.startswith("https://"):
                raise UserError("L'adresse de la vidéo doit commencer par https://.")

    def action_publish(self):
        for article in self:
            if not (article.body or article.attachment_ids or article.video_url):
                raise UserError(f"« {article.name} » est vide : ajoutez un texte, un fichier ou une vidéo.")
        self.filtered(lambda a: not a.published_at).write({"published_at": fields.Datetime.now()})
        self.write({"state": "published"})
        for article in self:
            article.env["portail.notification"].sudo().notify(
                article._readers(), "resource", f"Nouveau contenu : {article.name}",
                article.summary or "", f"/portail/ressources/{article.id}",
            )

    def _readers(self):
        """Porteurs des dossiers ouverts de la société (un contenu publié est ouvert à tous)."""
        self.ensure_one()
        dossiers = self.env["axispro.dossier"].sudo().search(
            [("company_id", "=", self.company_id.id), ("state", "!=", "closed")])
        return dossiers.portal_user_ids.filtered("active")


class PortailArticleReaction(models.Model):
    _name = "portail.article.reaction"
    _description = "Lecture, avis et favori d'un porteur sur un contenu"

    article_id = fields.Many2one("portail.article", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="article_id.company_id", store=True)
    user_id = fields.Many2one("res.users", required=True, ondelete="cascade", index=True)
    viewed_at = fields.Datetime("Lu le")
    helpful = fields.Selection([("yes", "Utile"), ("no", "Pas utile")], "Avis")
    bookmarked = fields.Boolean("Enregistré")

    _unique = models.Constraint("unique(article_id, user_id)", "Une réaction par porteur et par contenu.")


class PortailAnnouncement(models.Model):
    _name = "portail.announcement"
    _inherit = ["portail.audience.mixin"]
    _description = "Communication du cabinet aux porteurs"
    _order = "pinned desc, published_at desc, id desc"

    name = fields.Char("Titre", required=True)
    body = fields.Text("Texte")
    kind = fields.Selection(ANNOUNCEMENT_KINDS, "Nature", default="info", required=True)
    pinned = fields.Boolean("Épinglée")
    require_ack = fields.Boolean("Accusé de lecture demandé")
    cta_url = fields.Char("Lien")
    cta_label = fields.Char("Texte du lien")
    expire_date = fields.Date("Visible jusqu'au")
    state = fields.Selection(PUBLICATION_STATES, default="draft", required=True)
    published_at = fields.Datetime("Publiée le", readonly=True)
    author_id = fields.Many2one("res.users", "Auteur", default=lambda self: self.env.user)
    read_ids = fields.One2many("portail.announcement.read", "announcement_id", "Lectures")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)

    @api.constrains("body", "cta_url")
    def _check_content(self):
        for announcement in self:
            if len(announcement.body or "") > MAX_BODY:
                raise UserError("Texte trop long (60 000 caractères au plus).")
            if announcement.cta_url and not announcement.cta_url.startswith(("https://", "/portail")):
                raise UserError("Le lien doit commencer par https:// ou mener à une page du portail.")

    def visible_now(self):
        today = fields.Date.context_today(self)
        return self.filtered(lambda a: a.state == "published" and (not a.expire_date or a.expire_date >= today))

    def action_publish(self):
        self.filtered(lambda a: not a.published_at).write({"published_at": fields.Datetime.now()})
        self.write({"state": "published"})
        for announcement in self:
            label = dict(ANNOUNCEMENT_KINDS)[announcement.kind]
            announcement.env["portail.notification"].sudo().notify(
                announcement._audience_users(), "announcement", announcement.name, label,
                f"/portail/actualites/{announcement.id}",
            )


class PortailAnnouncementRead(models.Model):
    _name = "portail.announcement.read"
    _description = "Lecture d'une communication par un porteur"

    announcement_id = fields.Many2one("portail.announcement", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="announcement_id.company_id", store=True)
    user_id = fields.Many2one("res.users", required=True, ondelete="cascade", index=True)
    read_at = fields.Datetime("Lue le", default=fields.Datetime.now)
    acknowledged_at = fields.Datetime("Accusé de lecture le")

    _unique = models.Constraint("unique(announcement_id, user_id)", "Une lecture par porteur et par communication.")
