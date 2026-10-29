"""19.0.1.8.0 : chaîne documentaire d'une opération (ordre de transport, ordre de mission, budget de voyage, lettre
de voiture) et ensemble routier en tracteur et remorque.

Données existantes :
- chaque ensemble reçoit un tracteur (numéro de parc : le code de l'ensemble, immatriculation du tracteur) et, s'il
  a une immatriculation de citerne, une capacité ou le profil citerne, une remorque (même numéro de parc,
  immatriculation et capacité de la citerne) ; les numéros de parc se corrigent ensuite dans Flotte ;
- chaque rotation reçoit le tracteur et la remorque de son ensemble (rien ne change sur la facture, les relevés
  des propriétaires, les charges mensuelles ni HSSEQ, qui restent attachés à l'ensemble) ;
- séquences OT, OM, BV, LV et BCA, consignes au chauffeur, rubriques des budgets et circuit d'approbation des
  budgets de voyage pour EGUITRA GROUP SARLU ; piste d'audit des nouveaux modèles.
Redémarrer le noyau ensuite (module d'audit)."""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_transport import AUDITED_MODELS, documents_setup

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    Vehicle = env["eguitra.transport.vehicle"].with_context(active_test=False)
    created = 0
    for vehicle in Vehicle.search([("tractor_id", "=", False)]):
        vehicle.tractor_id = vehicle._unit_for("tractor", vehicle.tractor_plate or False)
        created += 1
    for vehicle in Vehicle.search([("trailer_id", "=", False)]):
        if vehicle.trailer_plate or vehicle.capacity_liters or vehicle.vehicle_kind == "tanker":
            trailer = vehicle._unit_for("trailer", vehicle.trailer_plate or False)
            if vehicle.capacity_liters and not trailer.capacity_liters:
                trailer.capacity_liters = vehicle.capacity_liters
            vehicle.trailer_id = trailer
            created += 1
    env.flush_all()
    # Rotations : engins de leur ensemble, par SQL (une rotation facturée refuse toute écriture du noyau).
    cr.execute("""
        UPDATE eguitra_transport_rotation rot
           SET tractor_id = COALESCE(rot.tractor_id, veh.tractor_id),
               trailer_id = COALESCE(rot.trailer_id, veh.trailer_id)
          FROM eguitra_transport_vehicle veh
         WHERE rot.vehicle_id = veh.id
           AND (rot.tractor_id IS NULL OR rot.trailer_id IS NULL)
    """)
    _logger.info("Transport 19.0.1.8.0 : %s engins créés, %s rotations rattachées à leurs engins", created, cr.rowcount)
    env.invalidate_all()
    documents_setup(env)
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
