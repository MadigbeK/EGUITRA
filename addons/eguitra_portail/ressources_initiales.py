"""Rubriques du centre de ressources et contenus proposés au cabinet à l'installation du module.

Les contenus sont créés en brouillon : le cabinet les relit, les complète et les publie lui-même.
Mise en forme simple du texte : # titre, **gras**, *italique*, - liste, 1. liste numérotée, > encadré.
"""

RUBRIQUES = [
    ("Préparer son dossier", "Pièces, data room et passage en comité", "FileCheck2", "azur"),
    ("Financer son projet", "Banques, bailleurs, garanties et offres de prêt", "Landmark", "or"),
    ("Business plan et prévisions", "Chiffrer son projet de façon crédible", "TrendingUp", "lagon"),
    ("Juridique et fiscalité", "Société, contrats, obligations déclaratives", "Scale", "violet"),
    ("Gestion et organisation", "Piloter son entreprise au quotidien", "Building2", "jade"),
    ("Questions fréquentes", "Le portail et l'accompagnement du cabinet", "Info", "corail"),
]

ARTICLES = [
    {
        "rubrique": "Préparer son dossier", "kind": "guide", "gates": "G0, G1", "featured": True,
        "tags": "data room, pièces, banque",
        "name": "Les pièces qu'une banque demande toujours",
        "summary": "Constituez dès le départ un dossier complet : c'est le premier signal de sérieux que reçoit votre banquier.",
        "body": """Un dossier incomplet ne dit pas « non » : il dit « plus tard ». Chaque pièce manquante ajoute un aller-retour et des semaines d'attente. Voici ce que demandent presque toutes les banques et tous les bailleurs.

# L'entreprise
- Statuts à jour et extrait du Registre du commerce (RCCM) de moins de trois mois
- Numéro d'identification fiscale (NIF) et attestation de situation fiscale
- Procès-verbaux des décisions importantes (nomination du gérant, augmentation de capital)

# Le dirigeant
- Pièce d'identité et curriculum vitae du ou des promoteurs
- Justificatifs de l'expérience dans le secteur (contrats, références, attestations)

# Le projet
- Plan d'affaires et prévisions financières sur la durée du prêt
- Devis ou factures pro forma des investissements
- Titres fonciers, baux ou promesses de bail pour le site
- Autorisations d'exploiter, permis et études d'impact quand le secteur l'exige

# Les finances
- États financiers des trois derniers exercices, ou bilan d'ouverture pour une création
- Relevés bancaires des douze derniers mois
- Preuve de l'apport personnel (relevé, attestation de dépôt)

> Déposez chaque pièce dans votre espace « Pièces » : le cabinet la vérifie et vous dit si elle est validée ou à reprendre. Formats acceptés : PDF, JPEG, PNG, Word (.docx) et Excel (.xlsx).""",
    },
    {
        "rubrique": "Financer son projet", "kind": "article", "gates": "G2, G3", "featured": True,
        "tags": "DSCR, remboursement, banque",
        "name": "Le DSCR : la question que se pose votre banquier",
        "summary": "Votre projet dégagera-t-il assez de trésorerie pour rembourser ? Un ratio y répond.",
        "body": """Le DSCR (*Debt Service Coverage Ratio*, ou ratio de couverture du service de la dette) compare ce que votre activité dégage chaque année à ce que vous devez rembourser la même année.

# Le calcul
**DSCR = trésorerie disponible pour la dette ÷ (intérêts + capital remboursés dans l'année)**

La trésorerie disponible est en général l'excédent brut d'exploitation, diminué des impôts et des investissements de renouvellement.

# Comment le lire
- **En dessous de 1** : l'activité ne suffit pas à rembourser, il faudra puiser ailleurs.
- **Entre 1 et 1,2** : le remboursement passe, mais sans marge en cas d'imprévu.
- **Au-dessus de 1,3** : la plupart des prêteurs sont rassurés. Le seuil exact dépend de chaque banque et du secteur.

> Le cabinet calcule votre DSCR année par année dans le modèle financier du dossier : c'est la plus faible de ces valeurs que regarde le comité.

# Comment l'améliorer
1. Allonger la durée du prêt, pour réduire chaque échéance.
2. Négocier un différé de remboursement pendant la montée en charge.
3. Augmenter l'apport, pour emprunter moins.
4. Revoir les charges d'exploitation et le calendrier des investissements.

Utilisez l'outil **Capacité de remboursement** de votre portail pour tester ces leviers.""",
    },
    {
        "rubrique": "Financer son projet", "kind": "fiche", "gates": "G3, G4",
        "tags": "prêt, taux, différé, garantie",
        "name": "Lire une offre de prêt : taux, durée, différé, garanties",
        "summary": "Quatre éléments à comparer avant de signer, et les questions à poser.",
        "body": """# Le taux
Comparez le **taux effectif global**, qui inclut frais de dossier, assurances et commissions, et pas seulement le taux nominal.

# La durée
Une durée plus longue réduit l'échéance mais augmente le coût total. Elle doit rester cohérente avec la durée de vie des équipements financés.

# Le différé
- **Différé partiel** : vous ne payez que les intérêts pendant quelques mois.
- **Différé total** : vous ne payez rien, mais les intérêts s'ajoutent au capital.

Le différé couvre la période où le projet ne produit pas encore : construction, installation, premières ventes.

# Les garanties
Hypothèque, nantissement du matériel, caution personnelle, fonds de garantie : demandez lesquelles sont exigées, et ce qu'elles coûtent.

> Simulez vos échéances avec l'outil **Simulateur de prêt** du portail, puis discutez l'offre avec votre consultant avant de signer.""",
    },
    {
        "rubrique": "Business plan et prévisions", "kind": "guide", "gates": "G1, G2",
        "tags": "prévisions, chiffre d'affaires, hypothèses",
        "name": "Cinq règles pour des prévisions crédibles",
        "summary": "Un banquier ne croit pas un chiffre : il croit une hypothèse qu'il peut vérifier.",
        "body": """1. **Partez des volumes, pas du chiffre d'affaires.** Combien d'unités, de clients, de rotations par mois ? Le prix vient ensuite.
2. **Justifiez chaque hypothèse.** Contrat signé, lettre d'intention, prix du marché relevé, capacité de la machine : chaque chiffre a sa source.
3. **Prévoyez une montée en charge.** Peu de projets tournent à pleine capacité la première année : 50 à 70 % est souvent plus réaliste.
4. **N'oubliez aucune charge.** Salaires et charges sociales, entretien, assurances, loyers, énergie, impôts : les oublis font les mauvaises surprises.
5. **Construisez un scénario prudent.** Que se passe-t-il si les ventes baissent de 20 % ou si les coûts montent de 10 % ? Un projet qui résiste rassure.

> Votre consultant reprend ces hypothèses dans le modèle financier du dossier et vous signale celles qu'il faut étayer.""",
    },
    {
        "rubrique": "Business plan et prévisions", "kind": "article", "gates": "G1, G2, G3",
        "tags": "BFR, trésorerie, stocks, délais de paiement",
        "name": "Le besoin en fonds de roulement, grand oublié des plans de financement",
        "summary": "Un projet rentable peut manquer de trésorerie : la faute au décalage entre dépenses et encaissements.",
        "body": """Vous achetez vos matières, payez vos salaires, puis vous attendez que vos clients paient. Pendant ce temps, l'argent est immobilisé : c'est le **besoin en fonds de roulement** (BFR).

# Ce qui le fait grossir
- Des clients qui paient à 60 ou 90 jours
- Des stocks importants de matières ou de produits finis
- Des fournisseurs qui exigent un paiement comptant

# Ce qui le réduit
- Des acomptes à la commande
- Des délais négociés avec les fournisseurs
- Une gestion serrée des stocks

> Le BFR doit figurer dans votre plan de financement initial, au même titre que les machines. Estimez-le avec l'outil **Besoin en fonds de roulement** du portail.""",
    },
    {
        "rubrique": "Préparer son dossier", "kind": "guide", "gates": "G3, G4, G5",
        "tags": "comité, présentation, décision",
        "name": "Préparer son passage en comité",
        "summary": "Le comité décide en peu de temps : arrivez avec des réponses, pas avec des promesses.",
        "body": """# Avant le comité
- Vérifiez avec votre consultant que toutes les pièces attendues sont validées.
- Relisez les points faibles identifiés dans votre plan d'actions : ce sont les questions qu'on vous posera.
- Préparez une présentation courte : le projet, le marché, les chiffres clés, le financement demandé.

# Pendant le comité
- Répondez précisément ; si vous ne savez pas, dites quand vous apporterez la réponse.
- Mettez en avant vos garanties de sérieux : contrats, apport, expérience.

# Après le comité
La décision peut être un accord, un accord sous conditions, une mise en attente ou un refus. En cas de conditions, elles deviennent des actions de votre plan : traitez-les vite, elles conditionnent la suite.""",
    },
    {
        "rubrique": "Questions fréquentes", "kind": "faq",
        "tags": "pièces, formats",
        "name": "Quels fichiers puis-je déposer ?",
        "summary": "PDF, JPEG, PNG, Word (.docx) et Excel (.xlsx), 20 Mo au plus par fichier.",
        "body": """Le portail accepte les fichiers **PDF, JPEG, PNG, Word (.docx) et Excel (.xlsx)**, de 20 Mo au plus.

Les anciens formats Word (.doc) et Excel (.xls), les archives ZIP et les fichiers à macros sont refusés pour votre sécurité : enregistrez le document dans l'un des formats acceptés avant de le déposer.

> Une photo nette d'un document papier, prise à plat et bien éclairée, est acceptée au format JPEG.""",
    },
    {
        "rubrique": "Questions fréquentes", "kind": "faq",
        "tags": "confidentialité, accès",
        "name": "Qui voit mes documents ?",
        "summary": "Vous et l'équipe du cabinet qui suit votre dossier, personne d'autre.",
        "body": """Vos documents ne sont visibles que par vous et par les consultants de MB AxisPro Consulting chargés de votre dossier. Les autres porteurs n'y ont jamais accès.

Le cabinet ne transmet un document à une banque ou à un bailleur qu'avec votre accord, dans le cadre de la recherche de financement.

Chaque connexion est enregistrée. Si vous constatez une activité que vous ne reconnaissez pas, changez votre mot de passe et prévenez votre consultant.""",
    },
    {
        "rubrique": "Questions fréquentes", "kind": "faq",
        "tags": "messagerie, rendez-vous, consultant",
        "name": "Comment joindre mon consultant ?",
        "summary": "Par la messagerie du portail, ou en demandant un rendez-vous.",
        "body": """- **Messagerie** : écrivez depuis l'espace « Messages ». Vous pouvez joindre un fichier ; il est aussi rangé dans vos pièces.
- **Rendez-vous** : proposez jusqu'à trois créneaux depuis l'espace « Rendez-vous » ; votre consultant confirme celui qui lui convient.
- **Urgence** : les coordonnées de votre consultant figurent sur la page « Mon projet ».

Vous êtes prévenu dans le portail de chaque réponse, de chaque pièce validée et de chaque nouvelle action.""",
    },
]
