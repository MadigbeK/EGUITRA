"""Intitulés français des blocs et des colonnes des classeurs d'analyse (controllers/classeur.py).

Une clé absente se traduit mot à mot (MOTS), puis se met en forme : le classeur reste lisible quand une
section gagne un bloc, et l'intitulé exact s'ajoute ici.
"""

# Onglets : blocs des sections.
BLOCS = {
    "health": "Santé", "waterfall": "Cascade du résultat", "monthly": "Évolution mensuelle",
    "activities": "Activités", "by_activity": "Par activité", "bridge": "Pont d'EBE",
    "transport_effects": "Effets volume-prix-mix", "cost_structure": "Structure des coûts",
    "budget_variance": "Budget", "metiers": "BTP et immobilier", "position": "Position de trésorerie",
    "forecast": "Prévision", "runway": "Autonomie de trésorerie", "cycle": "Cycle de conversion",
    "collections": "Encaissements attendus", "concentration": "Concentration", "segments": "Segments clients",
    "behaviour": "Comportement de paiement", "trends": "Tendances clients", "available": "Données disponibles",
    "indicators": "Indicateurs", "heatmap": "Marge route x mois", "trucks": "Ensembles routiers",
    "pricing": "Tarifs et point mort", "shortages": "Manquants", "scatter": "Rotations",
    "fuel_anomalies": "Consommations anormales", "cube": "Dépenses", "suppliers": "Fournisseurs",
    "benford": "Loi de Benford", "duplicates": "Doublons suspects", "outliers": "Montants inhabituels",
    "revenue": "Chiffre d'affaires", "ebe": "EBE", "landing": "Atterrissage", "sensitivities": "Sensibilités",
    "sensitivity_base": "Base des sensibilités", "method": "Méthode", "score": "Score", "checks": "Contrôles",
    "funnel": "Entonnoir des gates", "maturity": "Maturité des projets", "maturity_thresholds": "Seuils de maturité",
    "sections": "Sections", "time_in_gate": "Durée dans les gates", "bottleneck": "Goulot",
    "by_sector": "Par secteur", "by_location": "Par localisation", "pipeline_value": "Pipeline pondéré",
    "domain_heatmap": "Domaines par dossier", "top_gaps": "Critères manquants", "themes": "Thèmes à proposer",
    "knockouts": "Knock-outs", "knockouts_pending": "Knock-outs à évaluer", "evaluation_backlog": "Évaluations en attente",
    "evidence": "Preuves et pièces", "progression": "Progression des scores", "decisions": "Décisions",
    "agreement": "Accord méthode-comité", "forced_summary": "Passages forcés", "time_to_decision": "Délai de décision",
    "score_at_decision": "Score à la décision", "conditions": "Conditions du comité", "flows": "Flux de financement",
    "by_funder": "Par financeur", "pipeline": "Pipeline", "coverage": "Couverture", "time": "Temps passé",
    "realization": "Réalisation", "profitability": "Rentabilité des dossiers", "summary": "Résumé",
    "risk_matrix": "Matrice des risques", "actions": "Actions", "responsiveness": "Réactivité des porteurs",
}

# Colonnes et indicateurs.
COLONNES = {
    "id": "Identifiant", "key": "Code", "code": "Code", "name": "Nom", "label": "Libellé", "title": "Titre",
    "reference": "Référence", "date": "Date", "month": "Mois", "months": "Mois", "week": "Semaine",
    "start": "Début", "end": "Fin", "date_from": "Du", "date_to": "Au", "value": "Valeur", "values": "Valeurs",
    "count": "Nombre", "n": "Effectif", "unit": "Unité", "previous": "Période précédente", "target": "Cible",
    "delta_pct": "Variation (%)", "status": "Statut", "definition": "Définition", "trend": "Tendance", "score": "Score",
    "kind": "Nature", "type": "Type", "total": "Total", "totals": "Totaux", "rank": "Rang", "detail": "Détail",
    "details": "Détails", "comment": "Commentaire", "source": "Source", "level": "Niveau", "levels": "Niveaux",
    "index": "Indice", "weight": "Poids", "sequence": "Ordre", "version": "Version", "group": "Groupe",
    "revenue": "Chiffre d'affaires", "revenue_previous": "Chiffre d'affaires N-1", "revenue_12m": "CA 12 mois",
    "revenue_delta": "Variation du CA", "revenue_share": "Part du CA (%)", "revenue_per_km": "CA au km",
    "average_revenue": "CA moyen", "income_total": "Produits", "expense": "Charges", "charges": "Charges",
    "costs": "Coûts", "cost": "Coût", "margin": "Marge", "margin_rate": "Taux de marge (%)",
    "margin_pct": "Marge (%)", "margin_delta": "Variation de marge", "margin_threshold": "Seuil de marge (%)",
    "share_pct": "Part (%)", "growth_pct": "Croissance (%)", "amount": "Montant", "open": "Encours", "overdue": "Échu",
    "inflows": "Encaissements", "outflows": "Décaissements", "net": "Solde net", "net_cash": "Trésorerie nette",
    "balance": "Solde", "balance_p10": "Solde pessimiste (p10)", "balance_p50": "Solde central (p50)",
    "balance_p90": "Solde optimiste (p90)", "start_balance": "Solde de départ", "low_point": "Point bas",
    "forecast": "Prévision", "actual": "Réalisé", "actual_to_date": "Réalisé à date", "low": "Bas", "high": "Haut",
    "lower": "Borne basse", "upper": "Borne haute", "p10": "p10", "p50": "p50", "p90": "p90", "budget": "Budget",
    "gap": "Écart", "gap_pct": "Écart (%)", "estimate": "Estimation", "expected": "Attendu", "observed": "Observé",
    "expected_gnf": "Attendu (GNF)", "expected_total": "Total attendu", "probability": "Probabilité",
    "probability_pct": "Probabilité (%)", "confidence": "Confiance", "impact": "Impact", "impact_gnf": "Impact (GNF)",
    "route": "Route", "routes": "Routes", "truck": "Ensemble routier", "trucks": "Ensembles routiers",
    "vehicles": "Ensembles routiers", "driver": "Chauffeur", "drivers": "Chauffeurs", "product": "Produit",
    "products": "Produits", "km": "Kilomètres", "volume": "Volume", "volume_m3": "Volume (m³)",
    "volume_m3_previous": "Volume N-1 (m³)", "rotations": "Rotations", "fuel": "Carburant (L)",
    "fuel_per_100km": "Consommation (L/100 km)", "fuel_12m": "Carburant 12 mois", "tariff": "Tarif",
    "price": "Effet prix", "mix": "Effet mix", "cost_per_km": "Coût au km", "direct_costs": "Coûts directs",
    "structure": "Charges de structure", "structure_per_km": "Structure au km", "structure_booked": "Structure comptabilisée",
    "structure_booked_per_km": "Structure comptabilisée au km", "net_result": "Résultat net",
    "utilization_pct": "Utilisation (%)", "days_active": "Jours d'activité", "load_factor_pct": "Taux de chargement (%)",
    "avg_load": "Chargement moyen", "full_cost_per_m3_full_load": "Coût complet au m³ (pleine charge)",
    "full_cost_per_rotation": "Coût complet par rotation", "breakeven_rate": "Tarif de point mort",
    "target_rate": "Tarif cible", "target_margin_pct": "Marge cible (%)", "shortage": "Manquant",
    "shortage_value": "Valeur du manquant", "shortage_excess": "Manquant hors tolérance",
    "out_of_tolerance_pct": "Hors tolérance (%)", "excess_rotations": "Rotations hors tolérance",
    "deficit_vehicles": "Ensembles déficitaires", "deficit_loss": "Perte des déficitaires", "taxes": "Taxes",
    "transport_revenue": "CA transport", "client": "Client", "clients": "Clients", "client_id": "Client (id)",
    "supplier": "Fournisseur", "suppliers": "Fournisseurs", "partner_id": "Tiers (id)", "category": "Catégorie",
    "categories": "Catégories", "activity": "Activité", "activite": "Activité", "activity_id": "Activité (id)",
    "segment": "Segment", "segment_label": "Segment", "avg_days_late": "Retard moyen (jours)",
    "sd_days_late": "Dispersion du retard (jours)", "avg_days_to_pay": "Délai moyen de paiement (jours)",
    "days_late": "Retard (jours)", "days_overdue": "Jours de retard", "payment_score": "Note de paiement",
    "good_payer_score": "Note de bon payeur", "slope_days_per_month": "Tendance du retard (jours/mois)",
    "history_n": "Factures réglées", "ecl": "Perte attendue", "doubtful": "Douteux", "non_echu": "Non échu",
    "1_30": "1 à 30 jours", "31_60": "31 à 60 jours", "61_90": "61 à 90 jours", "plus_90": "Plus de 90 jours",
    "aging": "Ancienneté", "receivables": "Créances", "payables": "Dettes", "payables_overdue": "Dettes échues",
    "dso_days": "DSO (jours)", "gini": "Indice de Gini", "hhi": "Indice HHI", "top_share": "Part du premier",
    "top_share_pct": "Part du premier (%)", "top5": "Cinq premiers", "pareto_count": "Nombre pour 80 %",
    "cumulative_pct": "Part cumulée (%)", "x": "x", "y": "y", "digits": "Chiffres", "d": "Chiffre",
    "chi2": "Khi-deux", "chi2_critical": "Khi-deux critique", "mad": "MAD", "conformity": "Conformité",
    "conformity_label": "Conformité", "suspicious": "Chiffres en excès", "z": "Score robuste",
    "drift_pct": "Dérive (%)", "monthly_avg": "Moyenne mensuelle", "monthly_avg_previous": "Moyenne mensuelle N-1",
    "fixed_monthly": "Charges fixes mensuelles", "variable_rate": "Part variable", "variable_rate_pct": "Part variable (%)",
    "r2": "R²", "breakeven_monthly": "Point mort mensuel", "safety_margin_pct": "Marge de sécurité (%)",
    "operating_leverage": "Levier opérationnel", "cpi": "Indice de performance des coûts",
    "earned_value": "Valeur acquise", "eac": "Coût estimé à terminaison", "margin_at_completion": "Marge à terminaison",
    "margin_at_completion_pct": "Marge à terminaison (%)", "contract_amount": "Montant du marché",
    "progress_pct": "Avancement (%)", "retention_outstanding": "Retenues à libérer", "occupancy_pct": "Occupation (%)",
    "gross_yield_pct": "Rendement brut (%)", "annual_rent": "Loyer annuel", "unpaid_amount": "Impayés",
    "unpaid_count": "Loyers impayés", "lease_end": "Fin de bail", "weeks": "Semaines", "weeks_p10": "Semaines (p10)",
    "weeks_p50": "Semaines (p50)", "threshold": "Seuil", "mape": "Erreur moyenne (MAPE %)",
    "pass_probability": "Probabilité d'atteindre le budget", "payroll": "Masse salariale", "dossier": "Dossier",
    "dossiers": "Dossiers", "dossier_id": "Dossier (id)", "promoter": "Porteur", "sector": "Secteur",
    "gate": "Gate", "in_gate": "Dans le gate", "decision": "Décision", "recommendation": "Recommandation",
    "readiness": "Readiness", "apd": "APD", "bankability": "Bankability", "need": "Besoin de financement",
    "weighted_need": "Besoin pondéré", "investment": "Investissement", "conversion_pct": "Conversion (%)",
    "pass_rate_pct": "Taux de passage (%)", "median_days": "Médiane (jours)", "p75_days": "3e quartile (jours)",
    "km_median_days": "Médiane Kaplan-Meier (jours)", "median": "Médiane", "mean": "Moyenne", "min": "Minimum",
    "max": "Maximum", "q1": "1er quartile", "q3": "3e quartile", "frequency": "Fréquence",
    "frequency_pct": "Fréquence (%)", "avg_priority": "Priorité moyenne", "priority": "Priorité",
    "priority_label": "Priorité", "domain": "Domaine", "domain_code": "Domaine", "criterion_id": "Critère (id)",
    "deliverable": "Livrable à produire", "knockout": "Knock-out", "critical": "Critique", "weak": "Domaines faibles",
    "weak_share_pct": "Part faible (%)", "method_mean": "Moyenne (méthode)", "coverage_pct": "Couverture (%)",
    "required": "Exigés", "proven": "Prouvés", "no_proof": "Sans preuve", "expired": "Périmés", "missing": "Manquants",
    "age_days": "Âge (jours)", "first_readiness": "Readiness initial", "velocity_per_month": "Vitesse (points/mois)",
    "agreement_pct": "Accord (%)", "kappa": "Kappa de Cohen", "forced": "Passages forcés", "go": "GO",
    "conditional": "CONDITIONAL GO", "hold": "HOLD", "no_go": "NO-GO", "postponed": "Ajourné", "funder": "Financeur",
    "funders": "Financeurs", "requested": "Demandé", "granted": "Obtenu", "success_pct": "Taux de succès (%)",
    "avg_ticket": "Ticket moyen", "consultant": "Consultant", "consultants": "Consultants", "hours": "Heures",
    "billable_hours": "Heures facturables", "non_billable_hours": "Heures non facturables", "billed": "Facturé",
    "fees": "Honoraires", "fees_previous": "Honoraires N-1", "fees_ltd": "Honoraires depuis l'ouverture",
    "realization_pct": "Taux de réalisation (%)", "effective_rate": "Taux horaire effectif",
    "standard_rate": "Taux horaire de référence", "cost_hourly": "Coût horaire", "wip_hours": "Heures non facturées",
    "wip_value": "Valeur non facturée", "backlog_hours": "Carnet (heures)", "backlog_value": "Carnet (valeur)",
    "risk": "Risque", "risks": "Risques", "criticality": "Criticité", "mitigation": "Traitement",
    "treated_pct": "Traités (%)", "action": "Action", "assignee": "Responsable", "due_date": "Échéance",
    "done": "Terminées", "created": "Créées", "done_rate_pct": "Terminées (%)", "weeks_to_clear": "Semaines pour solder",
    "responded": "Réponses", "pending": "En attente", "oldest_pending_days": "Plus ancienne attente (jours)",
    "severity": "Gravité", "narrative": "Constat", "metric": "Mesure", "method": "Méthode", "link": "Lien",
}

# Traduction mot à mot des clés inconnues (avant mise en forme).
MOTS = {
    "avg": "moyen", "days": "jours", "day": "jour", "rate": "taux", "pct": "(%)", "late": "retard", "by": "par",
    "per": "par", "count": "nombre", "total": "total", "share": "part", "previous": "précédent", "median": "médiane",
    "age": "âge", "old": "ancien", "value": "valeur", "hours": "heures", "week": "semaine", "month": "mois",
    "months": "mois", "year": "année", "first": "premier", "last": "dernier", "expected": "attendu", "first_name": "nom",
    "score": "score", "trend": "tendance", "remaining": "restant", "source": "source", "rows": "lignes",
}


def bloc(key):
    return BLOCS.get(key) or colonne(key)


def colonne(key):
    key = str(key)
    if key in COLONNES:
        return COLONNES[key]
    words = [MOTS.get(w, w) for w in key.split("_") if w]
    text = " ".join(words).strip()
    return (text[:1].upper() + text[1:]) if text else key
