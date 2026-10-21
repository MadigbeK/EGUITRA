"""Questionnaire de paramétrage destiné à la direction financière et au comptable.

    python docs/projet/questionnaire-finance.py     # Questionnaire_parametrage_finance.xlsx et .md
    node docs/projet/questionnaire-finance.js       # version Word, depuis le .md

Chaque question dit à qui elle s'adresse, pourquoi on la pose (le réglage de la plateforme qu'elle
fixe), la valeur actuellement retenue par défaut quand il y en a une, et sa priorité : avant la
reprise des données 2026, avant la mise en production, ou ajustement en cours d'exploitation.
Source unique des questions : la liste THEMES ci-dessous.
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).parent
XLSX = HERE / "Questionnaire_parametrage_finance.xlsx"
MD = HERE / "questionnaire-finance.md"

DAF, CPT, LES2, DG = "DAF", "Comptable", "DAF et comptable", "Direction"
R, P, A = "Avant la reprise", "Avant la production", "Ajustement"

# (thème, [(question, destinataire, priorité, pourquoi : réglage concerné, valeur actuelle par défaut, pièce à fournir)])
THEMES = [
    ("Les deux sociétés et l'exercice", [
        ("Raison sociale exacte, forme juridique, capital, adresse, NIF, RCCM et numéro de TVA de chacune des deux sociétés ?",
         DAF, R, "Identité imprimée en tête et au pied des factures et des états financiers.", "", "Extrait RCCM, attestation NIF"),
        ("L'exercice va-t-il du 1er janvier au 31 décembre pour les deux sociétés ? MB AxisPro Consulting a démarré en février 2025 : quelle est la date de son premier exercice et a-t-il été clôturé ?",
         DAF, R, "Exercices et périodes de chaque société, bornes des états et des clôtures.", "Janvier à décembre", "Statuts, derniers états financiers"),
        ("Quel est le régime fiscal de chaque société (réel normal, simplifié) ? Les deux sont-elles assujetties à la TVA ?",
         DAF, R, "Taxes de vente et d'achat de chaque société, déclarations à produire.", "TVA 18 % pour les deux", "Attestation de régime"),
        ("Qui est l'expert-comptable de chaque société, et y a-t-il un commissaire aux comptes ? Qui produit la liasse fiscale (DSF) ?",
         DG, R, "Validation du plan de comptes et des balances de reprise ; format des états annuels.", "", "Coordonnées"),
        ("Qui saisit, qui contrôle, qui approuve et qui paie, pour chaque société ? Une même personne cumule-t-elle plusieurs de ces rôles ?",
         DAF, P, "Profils des utilisateurs, circuit d'approbation, séparation des tâches (personne n'approuve sa propre pièce).", "", "Organigramme du service"),
        ("Les salariés sont-ils propres à chaque société ou partagés ? Par quelle société le directeur général et l'équipe finance sont-ils rémunérés ?",
         DAF, P, "Répartition des charges de personnel et refacturations entre sociétés.", "", ""),
    ]),
    ("Opérations entre EGUITRA GROUP et MB AxisPro Consulting", [
        ("Le bâtiment commun appartient-il à l'une des sociétés ou est-il loué ? Qui paie loyer, électricité, eau, internet, gardiennage, et l'autre société en rembourse-t-elle une part ? Selon quelle clé ?",
         LES2, P, "Refacturation des frais communs : comptes 18x ou 45x, écritures périodiques, analytique.", "Aucune refacturation paramétrée", "Bail, factures types"),
        ("Le temps du directeur général, de la finance, du secrétariat ou des véhicules est-il refacturé d'une société à l'autre (frais de gestion) ? Existe-t-il une convention ?",
         DG, P, "Facturation intragroupe et éliminations dans la vue consolidée.", "", "Convention de prestations"),
        ("Y a-t-il des prêts, avances ou comptes courants entre les deux sociétés ? Avec quels taux et quelle convention de trésorerie ?",
         DAF, R, "Comptes de liaison entre sociétés, soldes de reprise, éliminations.", "", "Conventions, soldes au 31/12/2025"),
        ("MB AxisPro Consulting réalise-t-elle des prestations pour EGUITRA GROUP (audit des transporteurs, formation des chauffeurs, conseil) ? Sont-elles facturées ?",
         DG, P, "Ventes et achats réciproques à éliminer de la vue « Groupe consolidé ».", "", ""),
        ("Quels sont les liens en capital entre les deux sociétés (même actionnaire, participation de l'une dans l'autre) ?",
         DG, P, "Nature de la vue consolidée : consolidation comptable avec éliminations, ou simple combinaison des deux sociétés.", "Simple addition des deux sociétés", "Répartition du capital"),
        ("Pour la vue « Groupe consolidé », la direction attend-elle l'élimination des opérations entre les deux sociétés (ventes, prêts, refacturations), ou une simple addition suffit-elle ?",
         DG, P, "Calcul de la vue consolidée du tableau de bord et du rapport mensuel.", "Simple addition", ""),
    ]),
    ("Plan de comptes et analytique", [
        ("Utilisez-vous des sous-comptes propres au-delà du plan SYSCOHADA révisé (fournisseurs locaux et étrangers, clients pétroliers et miniers, comptes de charges détaillés) ? Pouvez-vous transmettre le plan utilisé en 2026 ?",
         CPT, R, "Plan de comptes de chaque société, correspondance avec le classeur pour la reprise.", "Plan SYSCOHADA Guinée standard", "Plan de comptes 2026"),
        ("Les clients et fournisseurs sont-ils suivis individuellement sous un compte collectif (411, 401), ou ont-ils chacun un compte ? Les tiers étrangers sont-ils séparés ?",
         CPT, R, "Fiche tiers et comptes collectifs, balance âgée, relances.", "Comptes collectifs 411 et 401, tiers individualisés", ""),
        ("Quelles sont exactement les activités d'EGUITRA GROUP à suivre en résultat (transport pétrolier, minier, conteneurs, transport du personnel, location de véhicules, taxis, BTP, immobilier, négoce de véhicules et d'engins) ?",
         DG, R, "Axe analytique « Activité » : chiffre d'affaires et résultat par activité.", "Activités du classeur 2026", "Liste validée"),
        ("Le site d'EGUITRA GROUP présente aussi un pôle Agriculture et Élevage (ananas, acajou, riz, aviculture, pisciculture). Ce pôle a-t-il une activité et une comptabilité à suivre dans la plateforme ?",
         DG, R, "Activité analytique supplémentaire ; un suivi métier propre à l'agriculture serait une évolution à chiffrer.", "Non prévu", ""),
        ("Quelles activités de MB AxisPro Consulting suivre séparément (gestion de projets, formation et coaching, conseil, audit des transporteurs, certification) ?",
         DG, P, "Axe « Activité » du cabinet ; aujourd'hui une seule activité.", "« Conseil et accompagnement de projets »", ""),
        ("Quels sont les centres de coût (neuf dans le classeur) et leurs responsables ? Les frais généraux sont-ils répartis entre activités, et selon quelle clé ?",
         DAF, R, "Axe « Centre de coût », répartition des charges communes, rentabilité par activité.", "", "Liste et clés de répartition"),
        ("Pour la rentabilité par camion, suivez-vous l'ensemble routier (tracteur et citerne ensemble) ou chaque véhicule séparément ? Quelles charges imputez-vous au camion (carburant, pneus, entretien, assurance, chauffeur, péages, amortissement) ?",
         LES2, R, "Axe « Ensemble routier » et marge par rotation, par camion, par route.", "Ensemble routier", "Liste des 15 ensembles"),
    ]),
    ("TVA, retenues et autres impôts", [
        ("Certaines ventes sont-elles exonérées de TVA ou à un taux particulier (transport pour des sociétés minières sous convention, exportations, prestations à des projets exonérés) ? Disposez-vous des attestations par client ?",
         DAF, R, "Taxes par client ou par produit, mentions d'exonération sur les factures.", "TVA 18 % sur toutes les ventes", "Attestations d'exonération"),
        ("La TVA sur vos prestations (transport, BTP, conseil) est-elle exigible à la facturation ou à l'encaissement ?",
         DAF, R, "Exigibilité de la TVA, calcul de la déclaration mensuelle.", "À la facturation", ""),
        ("Avez-vous des activités hors champ ou exonérées qui imposent un prorata de déduction de la TVA ?",
         DAF, P, "Prorata de déduction de la TVA sur achats.", "Aucun prorata", ""),
        ("Quelles TVA d'achat ne sont pas récupérables chez vous (carburant, véhicules de tourisme, réception, cadeaux) ?",
         CPT, R, "Taxes d'achat non déductibles par catégorie de dépense.", "TVA déductible par défaut", ""),
        ("Quelles retenues à la source pratiquez-vous comme payeur (prestataires non domiciliés, loyers, prestations de services), et lesquelles vos clients opèrent-ils sur vos factures ? Natures, taux, comptes, calendrier de reversement ?",
         DAF, R, "Écran Fiscalité > Retenues : chaque retenue est créée avec sa nature et son taux.", "Aucune retenue créée", "Exemples de déclarations"),
        ("Quels autres impôts et taxes payez-vous (impôt minimum forfaitaire, acomptes d'impôt sur les sociétés, contribution des patentes, contribution foncière, taxes sur salaires) ? Avec quel calendrier ?",
         DAF, P, "Échéancier fiscal, alertes et comptes de charges et de dettes fiscales.", "", "Calendrier fiscal"),
        ("Les sociétés bénéficient-elles d'exonérations ou de régimes particuliers (code des investissements, convention minière, zone franche) ?",
         DG, R, "Taxes et mentions particulières.", "", "Agréments"),
        ("Sous quelle forme déposez-vous les déclarations de TVA et de retenues (formulaire, télédéclaration) ? Quelles annexes l'administration ou l'auditeur demandent-ils ?",
         CPT, P, "Format de la déclaration de TVA et des exports pour l'auditeur.", "Déclaration de TVA du mois et export Excel", "Dernière déclaration déposée"),
    ]),
    ("Ventes et facturation", [
        ("Quelle numérotation des factures voulez-vous (préfixe par société, par activité, remise à zéro chaque année) ? Quel est le dernier numéro émis en 2026 pour chaque série ?",
         CPT, R, "Séquences des journaux de vente, continuité de la numérotation après la bascule.", "Une série par société", "Dernière facture émise"),
        ("Quelles mentions doivent figurer sur vos factures (conditions de paiement, pénalités de retard, coordonnées bancaires, NIF du client, bon de commande) ? Pouvez-vous fournir un modèle actuel ?",
         CPT, P, "Modèle de facture imprimé par la plateforme.", "Identité, NIF et RCCM au pied", "Facture type"),
        ("Quels délais de paiement accordez-vous, par client ou en standard (comptant, 30, 45, 60 jours) ?",
         DAF, R, "Conditions de paiement des clients, échéances, balance âgée et relances.", "", "Liste des clients et délais"),
        ("Transport pétrolier : facturez-vous le volume chargé ou le volume livré, en litres ambiants ou corrigés à 15 °C ? Quelle tolérance de manquant acceptez-vous, et le manquant est-il refacturé au client ou retenu au chauffeur ?",
         LES2, R, "Base de facturation des rotations, traitement des écarts de volume.", "Volume livré, sinon volume chargé", "Contrat type d'un distributeur"),
        ("Transport : les tarifs sont-ils fixés par route et par client, révisables (prix du gasoil) ? Facturez-vous des frais d'attente, d'escorte ou de retour à vide ?",
         LES2, R, "Routes et tarifs, lignes de facture des rotations.", "Tarif par route", "Grille tarifaire 2026"),
        ("Transport : facturez-vous rotation par rotation, par lot mensuel par client, ou par bon de livraison ? Quelles pièces accompagnent la facture (bons de chargement, de livraison) ?",
         LES2, P, "Regroupement des rotations à facturer, références imprimées.", "Une facture par client, rotations validées regroupées", ""),
        ("Comment facturez-vous les autres activités de transport (minerais à la tonne, conteneurs, transport du personnel, location de véhicules à la journée, taxis) ?",
         DAF, R, "Le module Transport est bâti sur les rotations de citernes : ces activités peuvent demander un réglage ou une évolution.", "Factures de vente simples", "Factures types"),
        ("Avez-vous des clients facturés en devises (dollar, euro) ? Quel taux retenez-vous (BCRG du jour de la facture, taux contractuel), et réévaluez-vous les créances en fin de mois ?",
         DAF, R, "Devises et taux de change, écarts de change, réévaluation.", "Franc guinéen seulement", "Contrats en devises"),
        ("Qui peut émettre un avoir, et un avoir doit-il être approuvé ?",
         DAF, P, "Droits sur les avoirs, circuit d'approbation.", "Profil finance, sans approbation", ""),
        ("Négoce de véhicules, citernes et engins : comment est-il comptabilisé aujourd'hui (achat pour revente, stock, marge par véhicule) ?",
         DAF, P, "La gestion de stock n'est pas dans l'offre : comptabilisation simple, ou évolution.", "Achats et ventes sans stock", ""),
        ("Chantiers : retenue de garantie (taux, durée, caution de remplacement), avance de démarrage remboursée sur les situations, révision de prix, TVA sur les situations ?",
         LES2, R, "Paramètres de chaque chantier et facturation des situations.", "Retenue de 5 %, pas d'avance", "Marchés en cours"),
        ("Immobilier : loyers payables d'avance chaque mois ou chaque trimestre ? TVA sur les loyers selon le type de bail ? Dépôts de garantie, révision annuelle, charges refacturées, retenue à la source opérée par les locataires ?",
         LES2, R, "Baux, quittancement automatique de nuit, TVA et retenues sur loyers.", "Mensuel d'avance, TVA sur bail commercial", "Baux en cours"),
        ("AxisPro : les honoraires sont-ils facturés au temps passé (taux horaire par consultant), au forfait par dossier, avec acompte, avec honoraire de réussite ? Sont-ils soumis à la TVA ?",
         DG, P, "Facturation des honoraires depuis les temps passés, taux, TVA.", "Taux horaire saisi à la facture, TVA 18 %", "Lettre de mission type"),
    ]),
    ("Achats, dépenses et approbations", [
        ("Quelles sont vos catégories de dépense courantes (carburant, pneus, pièces, entretien, péages, frais de route, primes chauffeurs, assurances, fournitures) et leur compte ? L'imputation à un camion ou à un chantier est-elle obligatoire ?",
         CPT, R, "Catégories de dépense : compte, analytique obligatoire, immobilisation éventuelle.", "", "Liste des dépenses 2026"),
        ("À partir de quel montant un bon de commande (engagement de dépense) est-il obligatoire avant l'achat ? Quel écart toléré entre la facture et l'engagement ?",
         DAF, P, "Engagements de dépense, rapprochement avec la facture.", "Tolérance de 5 %", ""),
        ("Circuit d'approbation : la finance contrôle toute pièce d'achat et la direction approuve au-delà de 50 M GNF ; la direction approuve les règlements et décaissements au-delà de 100 M GNF. Ces seuils conviennent-ils, et sont-ils les mêmes pour les deux sociétés ?",
         DG, P, "Règles d'approbation par société, par nature de document et par montant.", "50 M GNF (achats), 100 M GNF (paiements)", ""),
        ("En l'absence du directeur général, qui approuve à sa place ? Les paiements exigent-ils deux signatures à la banque ?",
         DG, P, "Profils approbateurs et suppléances.", "", ""),
        ("Le carburant est-il acheté en station avec des bons, par cartes carburant, ou stocké en cuve au parc ? Suivez-vous la consommation par camion ?",
         LES2, R, "Imputation du carburant aux ensembles routiers ; le stock de carburant serait une évolution.", "Achat imputé au camion", ""),
        ("Les frais de route des chauffeurs sont-ils avancés puis justifiés, ou payés au forfait par voyage ? Comment sont-ils comptabilisés ?",
         CPT, R, "Avances au personnel (421), justification, charge par rotation.", "Avance au personnel", ""),
        ("Achetez-vous à l'étranger (pièces, pneus, équipements) ? En quelle devise, avec quels droits de douane et quel transitaire ?",
         CPT, P, "Fournisseurs en devises, frais d'approche, coût des immobilisations.", "", ""),
    ]),
    ("Trésorerie et banques", [
        ("Quels sont les comptes bancaires de chaque société (banque, numéro, devise) ? Lesquels sont en dollars ou en euros ?",
         DAF, R, "Journaux de banque et comptes 521 par société, soldes de reprise.", "", "RIB et relevés au 31/12/2025"),
        ("Combien de caisses tenez-vous (siège, parc, chantiers), qui les tient, avec quel plafond et à quelle fréquence sont-elles arrêtées ?",
         DAF, R, "Journaux de caisse, alertes de caisse négative.", "", "Derniers arrêtés de caisse"),
        ("Utilisez-vous des comptes de monnaie électronique (Orange Money, MTN MoMo) pour encaisser ou payer ?",
         DAF, P, "Comptes de trésorerie et mode de paiement « Mobile money ».", "Mode de paiement prévu", ""),
        ("Sous quel format pouvez-vous obtenir vos relevés bancaires (Excel, CSV, PDF, banque en ligne) et à quelle fréquence ?",
         CPT, R, "Import des relevés et rapprochement assisté.", "Import Excel ou CSV", "Un relevé par banque"),
        ("Quels types d'opérations reviennent sur vos relevés au-delà des encaissements et paiements (frais, agios, avances au personnel, salaires, cotisations, impôts, virements internes, emprunts) ?",
         CPT, P, "Types d'opérations de trésorerie et leur contrepartie comptable.", "13 types usuels déjà créés", ""),
        ("Quel solde de trésorerie minimum la direction veut-elle surveiller ?",
         DG, A, "Alerte « trésorerie minimale ».", "Désactivée (0)", ""),
    ]),
    ("Immobilisations", [
        ("Pouvez-vous fournir le fichier des immobilisations de chaque société (date d'acquisition, valeur d'origine, durée, amortissements cumulés au 31/12/2025) ?",
         CPT, R, "Reprise des immobilisations et calcul des dotations mensuelles.", "", "Tableau des immobilisations"),
        ("Quelles durées et méthodes d'amortissement appliquez-vous par catégorie (tracteurs, citernes, véhicules légers, engins de BTP, bâtiments, informatique, mobilier) ? Linéaire ou dégressif ? Valeur résiduelle ? Les pneus sont-ils amortis à part ?",
         CPT, R, "Profils d'amortissement des catégories d'immobilisation.", "Linéaire", ""),
        ("En dessous de quel montant un achat est-il passé en charge plutôt qu'immobilisé ?",
         CPT, P, "Seuil d'immobilisation des catégories de dépense.", "", ""),
        ("Avez-vous des contrats de crédit-bail ou de location financière en cours ?",
         DAF, R, "Traitement du crédit-bail (SYSCOHADA révisé : immobilisation et dette).", "", "Contrats"),
    ]),
    ("Emprunts et financements", [
        ("Quels emprunts sont en cours (banque, montant, taux, durée, échéancier, garanties, devise) ?",
         DAF, R, "Fiches de financement, échéanciers, service de la dette et DSCR.", "", "Contrats et tableaux d'amortissement"),
        ("Disposez-vous de découverts autorisés, de lignes de crédit ou de cautions bancaires (chantiers, douane) ?",
         DAF, P, "Suivi des engagements hors bilan et de la trésorerie disponible.", "", ""),
        ("Vos banques imposent-elles un ratio de couverture de la dette minimal (DSCR) ou d'autres engagements financiers ?",
         DAF, A, "Seuil d'alerte du DSCR.", "Alerte sous 1,2", "Clauses des contrats"),
    ]),
    ("Clients, relances et provisions", [
        ("Votre politique de relance : à combien de jours de retard un rappel, une relance ferme, une mise en demeure ? Qui signe chaque niveau ?",
         DAF, P, "Niveaux et délais des relances clients, jamais envoyées sans décision.", "1, 15 et 30 jours", "Modèles de lettres"),
        ("Comment dépréciez-vous les créances douteuses (client par client, par ancienneté, à quel pourcentage) ? Les banques ou des investisseurs demandent-ils des comptes en IFRS ?",
         DAF, P, "Dépréciations statutaires ; matrice des pertes de crédit attendues (passerelle IFRS 9).", "Matrice IFRS hors livres, 50 % au-delà de 90 jours", ""),
        ("Avez-vous aujourd'hui des clients en litige ou douteux, et des créances à passer en perte ?",
         DAF, R, "Reprise des créances, dépréciations d'ouverture.", "", "Liste"),
        ("Accordez-vous un plafond d'encours par client ?",
         DAF, A, "Alerte de concentration et suivi des encours.", "Alerte si un client dépasse 40 % des créances", ""),
    ]),
    ("Clôtures, budget et pilotage", [
        ("À quelle date chaque mois doit être clôturé, et par qui ?",
         DAF, P, "Clôtures mensuelles, verrouillage, alerte de retard de clôture.", "Alerte 10 jours après la fin du mois", ""),
        ("Quelles écritures d'inventaire passez-vous chaque mois ou en fin d'année (charges à payer, produits à recevoir, charges constatées d'avance, provisions) ?",
         CPT, P, "Contrôles avant clôture et écritures récurrentes.", "Amortissements mensuels automatiques", ""),
        ("Quels indicateurs la direction attend-elle chaque mois, sous quelle forme, et pour qui ?",
         DG, P, "Rapport mensuel de gestion et tableau de bord.", "Rapport mensuel standard", "Rapport actuel s'il existe"),
        ("Le budget 2027 sera-t-il établi par activité, par centre de coût, par mois ? Qui l'élabore, et pour quelle date ?",
         DAF, P, "Budget et suivi des écarts.", "", "Budget 2026"),
        ("Ces seuils d'alerte vous conviennent-ils : délai clients cible de 60 jours, 20 % de créances échues, marge transport minimale de 30 %, dépassement de budget de 10 %, approbation en attente depuis 3 jours ?",
         DG, A, "Seuils d'alerte de chaque société (Administration > Seuils et taux).", "Valeurs citées", ""),
        ("Quel format d'états annuels déposez-vous (SYSCOHADA système normal ou minimal de trésorerie), avec quelles annexes ?",
         CPT, P, "Bilan, compte de résultat, tableau des flux et notes.", "Système normal", "Derniers états déposés"),
    ]),
    ("Reprise des données 2026", [
        ("Le classeur 2026 transmis est-il la version définitive ? À quelle date est-il arrêté, et qui le valide ?",
         DAF, R, "Reprise intégrale de l'exercice 2026, contrôles de balances.", "", "Classeur définitif"),
        ("Les soldes au 1er janvier 2026 (bilan 2025) sont-ils définitifs et approuvés, pour les deux sociétés ?",
         DAF, R, "Écritures d'ouverture.", "", "Balance au 31/12/2025"),
        ("Quelles factures clients et fournisseurs restaient non réglées à la date de bascule, avec leurs échéances ?",
         CPT, R, "Balance âgée et relances dès le premier jour.", "", "Listes des impayés"),
        ("Les rapprochements bancaires 2026 sont-ils à jour ? Pouvez-vous fournir le dernier état de rapprochement de chaque compte ?",
         CPT, R, "Point de départ du rapprochement dans la plateforme.", "", "États de rapprochement"),
        ("À quelle date souhaitez-vous basculer (début de mois), et faut-il une période de double saisie ?",
         DG, R, "Plan de bascule et date de mise en production.", "", ""),
    ]),
    ("Paie et social", [
        ("Avec quel outil la paie est-elle calculée ? Pouvez-vous fournir chaque mois l'écriture de paie (ou un fichier) par société et par activité ?",
         CPT, P, "Import de l'écriture de paie, charges de personnel par activité (la paie elle-même n'est pas dans l'offre).", "", "Journal de paie d'un mois"),
        ("Quelles cotisations et retenues sur salaires déclarez-vous (CNSS, RTS, versement forfaitaire, ONFPP) et à quelles échéances ?",
         CPT, P, "Comptes sociaux et fiscaux, alertes d'échéances.", "", ""),
    ]),
    ("Utilisateurs et droits", [
        ("Qui utilisera la plateforme, avec quel rôle et pour quelle société (finance, direction, exploitation, chantiers, immobilier, cabinet) ?",
         DG, P, "Comptes, profils et sociétés de chaque utilisateur.", "", "Liste nominative"),
        ("Quelles informations doivent rester confidentielles au sein de la finance (salaires nominatifs, comptes de la direction, dossiers du cabinet) ?",
         DG, P, "Droits d'accès et cloisonnement entre sociétés et profils.", "", ""),
    ]),
]

COLONNES = [("N°", 6), ("Thème", 26), ("Question", 70), ("À qui", 15), ("Priorité", 18),
            ("Pourquoi : réglage concerné", 48), ("Valeur actuelle par défaut", 28), ("Pièce à fournir", 26),
            ("Réponse", 60), ("Répondu par", 16), ("Date", 12)]
FOREST, GREEN, GREY = "142F29", "22634C", "F2F4F2"
THIN = Side(style="thin", color="D5DBD7")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def rows():
    n = 0
    for theme, questions in THEMES:
        for q in questions:
            n += 1
            yield [n, theme, *q[:3], q[3], q[4], q[5]]


def xlsx():
    book = Workbook()
    intro = book.active
    intro.title = "Mode d'emploi"
    lignes = [
        ("Questionnaire de paramétrage : finance et comptabilité", Font(bold=True, size=16, color=FOREST)),
        ("EGUITRA GROUP SARLU et MB AxisPro Consulting · plateforme NIMOVA · E-VOLUTION XP", Font(italic=True, color="666666")),
        ("", None),
        ("Chaque question fixe un réglage de la plateforme : la colonne « Pourquoi » dit lequel, la colonne « Valeur actuelle » "
         "ce qui est retenu par défaut tant que vous n'avez pas répondu.", None),
        ("Répondez dans la colonne « Réponse » (une phrase suffit souvent), joignez les pièces demandées, indiquez votre nom et la date.", None),
        ("Priorités : « Avant la reprise » bloque la reprise des données 2026 ; « Avant la production » doit être réglé avant la mise "
         "en service ; « Ajustement » peut être affiné ensuite.", None),
        ("Une question qui ne vous concerne pas : écrivez « sans objet ». Un doute : écrivez-le, nous en parlerons en atelier.", None),
    ]
    for r, (text, font) in enumerate(lignes, start=1):
        cell = intro.cell(row=r, column=1, value=text)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        if font:
            cell.font = font
    intro.column_dimensions["A"].width = 120

    sheet = book.create_sheet("Questions")
    for c, (titre, largeur) in enumerate(COLONNES, start=1):
        cell = sheet.cell(row=1, column=c, value=titre)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=GREEN if c >= 9 else FOREST)
        cell.border, cell.alignment = BORDER, Alignment(wrap_text=True, vertical="center")
        sheet.column_dimensions[get_column_letter(c)].width = largeur
    data = list(rows())
    for r, values in enumerate(data, start=2):
        for c, value in enumerate(values + ["", "", ""], start=1):
            cell = sheet.cell(row=r, column=c, value=value)
            cell.border, cell.alignment = BORDER, Alignment(wrap_text=True, vertical="top")
            if r % 2 == 1:
                cell.fill = PatternFill("solid", fgColor=GREY)
        sheet.cell(row=r, column=11).number_format = "DD/MM/YYYY"
    sheet.freeze_panes = "D2"
    sheet.auto_filter.ref = f"A1:{get_column_letter(len(COLONNES))}{len(data) + 1}"
    dv = DataValidation(type="list", formula1=f'"{R},{P},{A}"', allow_blank=False)
    sheet.add_data_validation(dv)
    dv.add(f"E2:E{len(data) + 1}")

    summary = book.create_sheet("Synthèse")
    summary.cell(row=1, column=1, value="Avancement des réponses").font = Font(bold=True, size=14, color=FOREST)
    heads = ["Priorité", "Questions", "Répondues", "Reste"]
    for c, h in enumerate(heads, start=1):
        cell = summary.cell(row=3, column=c, value=h)
        cell.font, cell.fill, cell.border = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor=FOREST), BORDER
    last = len(data) + 1
    for i, prio in enumerate((R, P, A), start=4):
        values = [prio, f'=COUNTIF(Questions!$E$2:$E${last},A{i})',
                  f'=COUNTIFS(Questions!$E$2:$E${last},A{i},Questions!$I$2:$I${last},"<>")', f"=B{i}-C{i}"]
        for c, v in enumerate(values, start=1):
            summary.cell(row=i, column=c, value=v).border = BORDER
    summary.column_dimensions["A"].width = 22
    book.save(XLSX)
    return len(data)


def markdown():
    out = ["# Questionnaire de paramétrage : finance et comptabilité", "",
           "Destinataires : direction financière (DAF), comptable, et direction générale pour quelques arbitrages. "
           "Chaque question fixe un réglage de la plateforme NIMOVA ; entre parenthèses, la valeur retenue par défaut tant "
           "que la question n'a pas de réponse. Priorités : **R** avant la reprise des données 2026, **P** avant la mise en "
           "production, **A** ajustement ensuite. Les réponses se notent de préférence dans le classeur "
           "« Questionnaire_parametrage_finance.xlsx ».", ""]
    n = 0
    code = {R: "R", P: "P", A: "A"}
    for theme, questions in THEMES:
        out += [f"## {theme}", ""]
        for question, qui, prio, pourquoi, defaut, piece in questions:
            n += 1
            details = f"{qui}, priorité {code[prio]}. Réglage : {pourquoi}"
            if defaut:
                details += f" Par défaut : {defaut}."
            if piece:
                details += f" Pièce : {piece}."
            out += [f"{n}. **{question}** {details}", ""]
    MD.write_text("\n".join(out), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    total = xlsx()
    markdown()
    print(f"{total} questions : {XLSX.name}, {MD.name}")
