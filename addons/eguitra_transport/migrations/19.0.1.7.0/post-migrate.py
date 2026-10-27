"""19.0.1.7.0 : lignes de facture reliées à leur rotation (tableau du transport de la facture imprimée) et
N° de bon de la rotation. Les factures déjà établies retrouvent leurs rotations par le libellé de la ligne,
qui porte le numéro de la rotation : « Transport gasoil Conakry - Siguiri, … (ROT/2026/0001, ER-01, …) »."""


def migrate(cr, version):
    cr.execute("""
        UPDATE account_move_line line
           SET eguitra_rotation_id = rot.id
          FROM eguitra_transport_rotation rot
         WHERE line.move_id = rot.invoice_id
           AND line.eguitra_rotation_id IS NULL
           AND line.display_type = 'product'
           AND line.name LIKE %s
           AND rot.name IS NOT NULL AND rot.name != '/'
           AND position('(' || rot.name || ',' IN line.name) > 0
    """, ["Transport %"])
