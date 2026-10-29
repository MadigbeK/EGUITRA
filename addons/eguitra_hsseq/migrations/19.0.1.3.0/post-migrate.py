"""19.0.1.3.0 : référentiel documentaire HSE (politiques et procédures, 29/10).

- Les procédures existantes deviennent le type « procédure » (référence et versions inchangées).
- Leurs versions déjà publiées ont été mises en vigueur par le Responsable HSSEQ, seul approbateur des
  procédures : elles sont notées approuvées et soumises par la personne et à l'heure de leur publication.
- Une procédure en vigueur reçoit sa prochaine revue : date de publication de la version en vigueur plus la
  périodicité des procédures des réglages de sa société (24 mois par défaut).
- Réglages des sociétés existantes : périodicités de revue par type (politique 12 mois, procédure,
  instruction de travail et consigne 24, formulaire 36), alerte 30 jours avant, pas de quatre yeux imposé
  aux procédures.

Reprise en SQL, sans ligne au journal HSSEQ ; nouvelles règles de la piste d'audit (objectifs des politiques,
revues des documents). Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_hsseq import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    # Réglages des sociétés existantes : périodicités et alerte proposées (une colonne ajoutée reste vide).
    cr.execute("""
        UPDATE eguitra_hsseq_settings
           SET review_months_policy = COALESCE(NULLIF(review_months_policy, 0), 12),
               review_months_procedure = COALESCE(NULLIF(review_months_procedure, 0), 24),
               review_months_work_instruction = COALESCE(NULLIF(review_months_work_instruction, 0), 24),
               review_months_instruction = COALESCE(NULLIF(review_months_instruction, 0), 24),
               review_months_form = COALESCE(NULLIF(review_months_form, 0), 36),
               document_review_alert_days = COALESCE(document_review_alert_days, 30),
               document_four_eyes = COALESCE(document_four_eyes, false)
    """)
    cr.execute("UPDATE eguitra_hsseq_procedure SET doc_type = 'procedure' WHERE doc_type IS NULL")
    cr.execute("UPDATE eguitra_hsseq_procedure SET review_months = 0 WHERE review_months IS NULL")
    cr.execute("""
        UPDATE eguitra_hsseq_procedure_version
           SET approved_at = published_at, approved_by = published_by,
               submitted_at = COALESCE(submitted_at, published_at), submitted_by = COALESCE(submitted_by, published_by)
         WHERE status IN ('published', 'superseded') AND approved_at IS NULL AND published_at IS NOT NULL
    """)
    cr.execute("""
        UPDATE eguitra_hsseq_procedure p
           SET next_review_date = (v.published_at::date
                                   + make_interval(months => COALESCE(NULLIF(s.review_months_procedure, 0), 24)))::date
          FROM eguitra_hsseq_procedure_version v
          LEFT JOIN eguitra_hsseq_settings s ON s.company_id = v.company_id
         WHERE v.id = p.current_version_id AND p.status = 'published' AND p.next_review_date IS NULL
           AND v.published_at IS NOT NULL
    """)
