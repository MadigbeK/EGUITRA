"""Questionnaire de paramétrage d'AxisPro destiné à la direction et aux consultants de MB AxisPro.

    python docs/projet/questionnaire-axispro.py     # Questionnaire_parametrage_axispro.xlsx et .md
    node docs/projet/questionnaire-axispro.js       # version Word, depuis le .md

Version courte, même mise en page que le questionnaire finance (questionnaire_commun.py). Les
questions partent des réglages en place : grille officielle reprise du prototype (111 critères,
15 domaines, 8 gates, 42 pièces, 9 critères éliminatoires), seuils de recommandation, modèle
financier, portail, temps et honoraires. Les thèmes sont rangés par urgence.
"""

from pathlib import Path

from questionnaire_commun import write_markdown, write_xlsx

HERE = Path(__file__).parent
XLSX = HERE / "Questionnaire_parametrage_axispro.xlsx"
MD = HERE / "questionnaire-axispro.md"

DIR, CONS, ADM = "Direction", "Consultants", "Administration"

# (thème, [(question, destinataire, pièce à fournir)])
THEMES = [
    ("La grille et la méthode", [
        ("La grille officielle reprise du prototype (111 critères, 15 domaines, 8 gates, 42 pièces, 9 critères éliminatoires) est-elle la version à appliquer ? Des critères, des pièces ou des règles de passage sont-ils à revoir avant la mise en service ?",
         DIR, "Grille à jour si elle a changé"),
        ("Les seuils de recommandation conviennent-ils : BANKABLE CANDIDATE à 80, APD READY à 65, CONDITIONAL GO à 50, HOLD à 30 (sur 100), et DSCR bancaire de 1,3 ?",
         DIR, ""),
        ("Tous les critères comptent aujourd'hui de la même façon dans les scores. Certains domaines doivent-ils peser davantage ?",
         DIR, ""),
        ("Quelles pièces ont une durée de validité (attestations fiscales et sociales, RCCM, assurances), et de combien de mois ? Une pièce périmée rend le critère incomplet.",
         CONS, ""),
        ("Qui peut modifier la grille et qui la met en vigueur ? Une nouvelle version ne s'applique qu'aux dossiers ouverts ensuite.",
         DIR, ""),
    ]),
    ("Les dossiers en cours", [
        ("Combien de dossiers suivez-vous aujourd'hui, et où (prototype, classeurs, dossiers papier) ? Faut-il les reprendre dans AxisPro avec leurs évaluations ?",
         DIR, "Liste des dossiers"),
        ("Où sont rangées les pièces des porteurs (disque, courriel, cloud), et quel est leur volume ?",
         CONS, ""),
        ("Pour chaque dossier en cours : promoteur, consultant responsable, étape atteinte, devise du projet ?",
         CONS, ""),
        ("Les dossiers clos ou abandonnés doivent-ils être repris pour l'historique ?",
         DIR, ""),
    ]),
    ("Comités et décisions", [
        ("Qui siège au comité, à quelle fréquence, et qui peut sceller une décision ?",
         DIR, ""),
        ("Une décision GO sous conditions laisse 30 jours au porteur pour lever chaque condition. Ce délai convient-il ?",
         DIR, ""),
        ("Le rapport de décision doit-il suivre votre modèle (logo, mentions, signataires) ?",
         DIR, "Un rapport de comité actuel"),
    ]),
    ("Modèle financier", [
        ("Valeurs de départ d'un modèle : horizon de 7 ans, taux d'actualisation de 12 %, impôt sur les sociétés de 25 %, DSCR exigé de 1,3, apport minimal de 20 %. Lesquelles adapter au contexte guinéen ?",
         CONS, ""),
        ("Avec quelles banques et quels fonds travaillez-vous, et quelles sont leurs exigences (apport, DSCR, garanties, taux) ?",
         DIR, "Liste des financeurs"),
        ("Faut-il des modèles types par secteur (agro-industrie, énergie, transport, BTP) pour démarrer plus vite ?",
         CONS, ""),
    ]),
    ("Portail des porteurs", [
        ("Le porteur voit l'avancement de son dossier, les pièces demandées, ses actions et ses échanges, jamais le score ni les notes internes. Faut-il lui montrer davantage, ou moins ?",
         DIR, ""),
        ("Le portail doit-il porter l'adresse du cabinet (mbaxisproconsulting.com) ou celle de NIMOVA (nimova.gn) ?",
         DIR, ""),
        ("Le porteur et le consultant doivent-ils recevoir un courriel à chaque nouveau message, pièce ou action ? Avec quelle adresse d'envoi ?",
         DIR, ""),
    ]),
    ("Temps et honoraires", [
        ("Comment facturez-vous : au temps passé, au forfait par dossier ou par étape, avec acompte, avec honoraire de réussite ?",
         DIR, "Lettre de mission type"),
        ("Un taux horaire unique ou un taux par consultant ? Quel coût de revient horaire retenir pour la marge du cabinet ?",
         DIR, ""),
        ("Les consultants saisissent-ils leurs temps chaque jour ou chaque semaine, et sur tous les dossiers, facturables ou non ?",
         DIR, ""),
    ]),
    ("Les autres activités du cabinet", [
        ("Formation et coaching, audit des transporteurs, certification : ces activités doivent-elles être suivies dans AxisPro (dossiers, temps, facturation), ou seulement en comptabilité ?",
         DIR, ""),
        ("Vos clients sont-ils seulement des porteurs de projets, ou aussi des entreprises (transporteurs, organisations à certifier) ?",
         DIR, ""),
    ]),
    ("Utilisateurs et confidentialité", [
        ("Qui utilisera AxisPro, avec quel rôle (consultant, associé, administration) ?",
         ADM, "Liste nominative"),
        ("Chaque consultant doit-il voir tous les dossiers du cabinet, ou seulement les siens ?",
         DIR, ""),
    ]),
]

TITLE = "Questionnaire de paramétrage : AxisPro"
SUBTITLE = "MB AxisPro · plateforme NIMOVA"
NOTE = "Répondez dans la colonne Réponse ; une phrase suffit. Les premiers thèmes sont les plus urgents."
INTRO = ("Méthode, dossiers, comités, modèle financier, portail et honoraires de MB AxisPro. Les réponses fixent le "
         "réglage d'AxisPro avant sa mise en service ; les premiers thèmes sont les plus urgents. Une phrase par réponse "
         "suffit, de préférence dans le classeur « Questionnaire_parametrage_axispro.xlsx ».")

if __name__ == "__main__":
    total = write_xlsx(XLSX, THEMES, TITLE, SUBTITLE, NOTE)
    write_markdown(MD, THEMES, "Questionnaire de paramétrage : AxisPro", INTRO)
    print(f"{total} questions : {XLSX.name}, {MD.name}")
