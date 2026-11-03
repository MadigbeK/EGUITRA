# Image du noyau : Odoo 19 Community officiel + dépendances Python des modules OCA.
# Contexte de construction : infra/ (pour lire oca-src/requirements.txt).
FROM odoo:19.0

USER root
COPY oca-src/requirements.txt /tmp/oca-requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/oca-requirements.txt \
 && rm /tmp/oca-requirements.txt
# Lecture des business plans par l'IA (eguitra_axispro, lecture_ia.py) : bibliothèque officielle d'Anthropic.
RUN pip3 install --no-cache-dir --break-system-packages anthropic==2.3.0
USER odoo
