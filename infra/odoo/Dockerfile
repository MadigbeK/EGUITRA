# Image du noyau : Odoo 19 Community officiel + dépendances Python des modules OCA.
# Contexte de construction : infra/ (pour lire oca-src/requirements.txt).
FROM odoo:19.0

USER root
COPY oca-src/requirements.txt /tmp/oca-requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/oca-requirements.txt \
 && rm /tmp/oca-requirements.txt
USER odoo
