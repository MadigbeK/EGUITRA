"""Questionnaire de paramétrage du transport destiné à l'exploitation, à la finance et à la direction d'EGUITRA GROUP.

    python docs/projet/questionnaire-transport.py   # Questionnaire_parametrage_transport.xlsx et .md
    node docs/projet/questionnaire-transport.js     # version Word, depuis le .md

Version courte et dédoublonnée des questions de cadrage-transport.md et de
analyse-systeme-transport-actuel.md (logiciel Datakö Fleet Manager), même mise en page que les
questionnaires finance et AxisPro (questionnaire_commun.py). Valeurs par défaut citées : celles de
Finance > Transport > Paramètres. Les thèmes sont rangés par urgence ; le thème des autres
activités du pôle prépare un module hors de l'offre, à chiffrer.
"""

from pathlib import Path

from questionnaire_commun import write_markdown, write_xlsx

HERE = Path(__file__).parent
XLSX = HERE / "Questionnaire_parametrage_transport.xlsx"
MD = HERE / "questionnaire-transport.md"

EXP, DAF, DIR = "Exploitation", "DAF", "Direction"

# (thème, [(question, destinataire, pièce à fournir)])
THEMES = [
    ("Le système actuel et la reprise", [
        ("Depuis quand Datakö Fleet Manager est-il utilisé, et sur quels camions ? Il compte environ 45 rotations en 2026, le classeur 383 : quelle source fait foi pour la reprise ?",
         EXP, ""),
        ("Pouvez-vous obtenir de Datakö un export complet des données, et à quelle date l'abonnement prend-il fin ?",
         EXP, "Export complet de Datakö"),
        ("Qui saisit les rotations aujourd'hui, qui valide les livraisons, et à quoi sert WhatsApp dans ce circuit ?",
         EXP, ""),
        ("Combien de véhicules compte la flotte, par type (citernes, bennes, porte-conteneurs, bus, tout-terrain, taxis) ? Les tracteurs changent-ils souvent de citerne ?",
         EXP, "Liste de la flotte"),
    ]),
    ("Camions de tiers et partenaires", [
        ("Combien de camions appartiennent à des tiers ? Pour chacun : part retenue par EGUITRA, charges à la charge du propriétaire, reversement, et règlement d'un mois déficitaire ?",
         DIR, "Contrats avec les propriétaires"),
        ("Qui sont vos partenaires commissionnés ou sous-traitants (apporteur d'affaires, associé, transporteur), sur quelle base, et facturent-ils leur commission ?",
         DIR, ""),
        ("Le chiffre d'affaires des camions gérés est-il celui d'EGUITRA, ou seulement sa commission ? À trancher avec l'expert-comptable.",
         DAF, ""),
    ]),
    ("Volumes, manquants et facturation", [
        ("Facturez-vous le volume chargé, le volume livré ou le volume ramené à 15 °C ? Quelle date rattache une rotation au mois : le chargement ou la livraison ?",
         DAF, ""),
        ("Quelle tolérance de manquant par client (0,5 % du volume chargé par défaut) ? Au-delà, qui supporte le manquant : déduction du client, note de débit, retenue au chauffeur ? Les chauffeurs sont-ils salariés ?",
         DAF, "Contrats des distributeurs"),
        ("Comment valorisez-vous un manquant (prix du dépôt, prix à la pompe, prix du contrat), hors taxes ou toutes taxes, et la déduction porte-t-elle la TVA ?",
         DAF, ""),
        ("Les bons du dépôt indiquent-ils température, masse volumique et coefficient de correction à 15 °C ? Les citernes ont-elles des certificats de jaugeage ?",
         EXP, "Bons de chargement et de livraison, certificats de jaugeage"),
        ("Une facture par rotation ou un relevé mensuel par client ? Quelles pièces exige le client (numéro de tournée, bons de commande, BL) ? Un règlement couvre-t-il plusieurs rotations ?",
         DAF, "Une facture récente"),
        ("Vos tarifs suivent-ils le barème national de péréquation ou sont-ils négociés par client ? Quelle date d'effet ? Transportez-vous d'autres produits que le gasoil (essence, mazout, jet) ?",
         DAF, "Grille tarifaire 2026"),
    ]),
    ("Taxes et frais de route", [
        ("Quelles taxes et redevances payez-vous par rotation (roulage, communes, pesage, laissez-passer, douane), sur quelle base et à quel taux ? Lesquelles refacturez-vous, avec ou sans TVA ?",
         DAF, "Quittances types"),
        ("Les frais de route (carburant, prime du chauffeur, péages) sont-ils des forfaits ou des dépenses réelles ? Sur l'aller simple ou l'aller-retour ? Qui les fixe et comment sont-ils payés ?",
         EXP, "Barème des forfaits"),
        ("Le carburant est-il acheté au prix officiel ou à un prix négocié, en station, par cartes ou stocké en cuve ?",
         EXP, ""),
    ]),
    ("Coûts et rentabilité", [
        ("Les factures de carburant, de pneus et d'entretien peuvent-elles être rattachées à un camion dès la saisie ? Les charges fixes par véhicule (assurance, vignette, géolocalisation) sont-elles réelles ou budgétées ?",
         DAF, ""),
        ("Quel est le kilométrage aller-retour et la durée standard de chaque route ? Souhaitez-vous relever le compteur à chaque rotation ?",
         EXP, "Liste des routes"),
        ("Les charges du siège imputées au transport se répartissent aujourd'hui au kilomètre parcouru. Préférez-vous une autre clé (rotations, volume, chiffre d'affaires) ?",
         DAF, ""),
    ]),
    ("Conformité des véhicules", [
        ("Quels documents suivez-vous par véhicule (assurance, visite technique, vignette, licences de transport) et avec quelles échéances ? Que signifie « non conforme » dans Datakö ?",
         EXP, "Documents et échéances par véhicule"),
    ]),
    ("Saisie et validation", [
        ("Qui saisira les rotations : les chauffeurs sur téléphone (application Rotations, hors réseau), le parc ou le bureau ?",
         EXP, ""),
        ("Le destinataire doit-il confirmer la livraison (code, signature, portail) ?",
         DIR, ""),
    ]),
    ("Les autres activités du pôle", [
        ("Quelles autres activités intégrer (minerais, conteneurs, transport du personnel, location tout-terrain, taxis), et dans quel ordre ? Ce module est hors de l'offre et sera chiffré à part.",
         DIR, ""),
        ("Pour chacune : unité de facturation (tonne, conteneur, jour, mois, course), tarifs, pièces émises (bons, lettres de voiture, contrats) et volume mensuel ?",
         EXP, "Exemples de contrats et de factures"),
        ("Le carburant et l'entretien de toute la flotte doivent-ils être suivis dans ce module ou dans un module « Parc » à part ?",
         DIR, ""),
    ]),
]

TITLE = "Questionnaire de paramétrage : transport"
SUBTITLE = "EGUITRA GROUP SARLU · plateforme NIMOVA"
NOTE = "Répondez dans la colonne Réponse ; une phrase suffit. Les premiers thèmes sont les plus urgents."
INTRO = ("Transport et logistique d'EGUITRA GROUP : système actuel, camions de tiers, volumes, manquants, taxes, coûts, "
         "conformité et autres activités du pôle. Les réponses fixent le réglage du module Transport et la reprise des "
         "rotations ; le dernier thème prépare un module à chiffrer, hors de l'offre. Une phrase par réponse suffit, de "
         "préférence dans le classeur « Questionnaire_parametrage_transport.xlsx ».")

if __name__ == "__main__":
    total = write_xlsx(XLSX, THEMES, TITLE, SUBTITLE, NOTE)
    write_markdown(MD, THEMES, "Questionnaire de paramétrage : transport", INTRO)
    print(f"{total} questions : {XLSX.name}, {MD.name}")
