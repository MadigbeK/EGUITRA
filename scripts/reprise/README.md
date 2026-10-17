# Reprise des données

Les données du classeur 2026 (et des relevés bancaires) entrent dans le noyau par des fichiers CSV
simples, remplis à partir du classeur, contrôlés puis enregistrés par `reprise.sh`. Chaque fichier
est facultatif ; la reprise se rejoue autant de fois que nécessaire sur la base de recette avant
la production. Le dossier JSON du prototype de la direction se convertit en ces fichiers par
`dossier_json.py` (voir plus bas).

## Fichiers

Modèles dans `modeles/` (séparateur point-virgule, montants en GNF, dates JJ/MM/AAAA) :

| Fichier | Contenu | Remarques |
|---|---|---|
| `comptes.csv` | `code;libelle;type` | Comptes du plan de l'ancien système. Un compte absent du plan de la société est créé sous sa racine, avec la nature et le lettrage du compte voisin (clients 41 et fournisseurs 40 toujours lettrables, 585 lettrable), comme l'écran Plan comptable ; le compte rendu liste les comptes créés. `type` est indicatif. |
| `axes.csv` | `axe;code;libelle` | Activités (`activite`) et centres de coût (`centre_cout`) : créés avec leur code, que les autres fichiers peuvent citer à la place du libellé. |
| `journaux.csv` | `code;libelle;type;compte;devise;numero` | Comptes de banque (`bank`) et de caisse (`cash`) : un journal par compte de trésorerie (code de 5 caractères au plus), sur le compte du plan indiqué ; devise du compte si ce n'est pas le franc guinéen (la devise doit être active). Un journal déjà présent (même code) est gardé. |
| `tiers.csv` | `type;code;nom;nif;rccm;telephone;email;adresse;ville;delai;fin_de_mois;limite_credit;non_assujetti;secteur;contact` | type : client, fournisseur, client_fournisseur, preteur. `code` devient la référence de la fiche ; les autres fichiers peuvent désigner le tiers par son code ou son nom. `delai` : condition de paiement à N jours (`fin_de_mois` = oui : N jours après la fin du mois) ; `limite_credit` (clients) ; `non_assujetti` = oui : factures sans TVA. Un tiers existant (même code et même nom, sinon même nom) est mis à jour ; un code déjà porté par la fiche pour l'autre société est conservé. |
| `soldes_ouverture.csv` | `compte;libelle;tiers;debit;credit;echeance;reference` | Une seule écriture d'à-nouveaux, équilibrée, à la date d'ouverture. Comptes de tiers (411, 401…) : tiers obligatoire ; une ligne par facture non réglée, avec son échéance (balance âgée) et sa référence (lettrage avec les règlements de l'exercice). |
| `immobilisations.csv` | `code;libelle;profil;date_mise_en_service;valeur_brute;cumul;duree;activite;localisation;responsable;compte_immobilisation;compte_amortissement;compte_dotation;non_amortissable` | Biens en service : `profil` = nom d'une catégorie de l'écran Immobilisations ; absente, elle est créée si ses comptes sont donnés (2x, 28x, 68x ; dotations mensuelles au prorata de la mise en service ; `non_amortissable` = oui pour un terrain). `cumul` = amortissements cumulés à la veille de la date d'ouverture (31/12) ; `duree` en années (à défaut, celle de la catégorie). Les dotations antérieures à l'ouverture deviennent des lignes de reprise, sans écriture ; celles de l'exercice sont calculées et comptabilisées par la plateforme (ne pas les reprendre dans `ecritures.csv`). Contrôle bloquant : par compte, cumul du registre = solde d'ouverture créditeur du 28x et valeur brute = solde d'ouverture débiteur du 2x. Un bien déjà présent (même code) est ignoré. |
| `routes.csv` | `nom;origine;destination;distance_km;distance_ar_km;duree_jours;tarif_m3` | Routes tarifées (tarif de la route par m³, appliqué aux rotations sans tarif client). Mise à jour d'une route de même nom. |
| `chauffeurs.csv` | `nom;telephone;permis` | Chauffeurs. |
| `ensembles.csv` | `code;immatriculation;marque;capacite_litres;chauffeur;annee;mise_en_service;etat;immobilisation` | Ensembles routiers : chauffeur habituel (déclaré dans `chauffeurs.csv`), état (service, maintenance, off, sold), immobilisation liée (code du registre : ses dotations entrent dans les charges de structure du transport). |
| `ecritures.csv` | `piece;date;journal;compte;tiers;libelle;debit;credit;activite;centre_cout;chantier;ensemble;route;bien;echeance;lettrage;devise;montant_devise` | Écritures de l'exercice (ventes, achats, trésorerie, OD), une pièce par numéro et par journal (codes FAC, FACTU, OD, journaux de trésorerie…), équilibrée et datée d'un seul jour. Chaque ligne s'impute sur les axes renseignés (nom ou code du compte analytique) : activités et centres de coût inconnus sont créés, ensembles routiers et routes aussi (avec leur fiche) ; chantiers et biens doivent exister dans l'application (le contrôle signale les autres). Une colonne `dossier` facultative sert à MB AxisPro Consulting. Facultatif : `echeance` (date d'échéance de la ligne), `lettrage` (référence de la facture), `devise` et `montant_devise` (ligne en devise, débit et crédit restant en GNF). Lettrage : une ligne qui porte une référence se lettre avec les lignes de même compte, même tiers et même référence, à-nouveaux compris (facture et ses règlements) ; les autres lignes des comptes de tiers se compensent par tiers. Une pièce déjà reprise est ignorée. |
| `emprunts.csv` | `reference;preteur;nature;objet;montant;date_deblocage;premiere_echeance;duree_mois;compte_dette;compte_interets;journal;taux;periodicite` | Emprunts et crédits-bails en cours (nature emprunt ou credit-bail ; taux annuel en %, 0 s'il manque, signalé). Échéancier calculé par la plateforme ; échéances antérieures à l'ouverture marquées réglées (ancien système) ; financement mis en cours. Aucune écriture : les règlements sont dans `ecritures.csv`. |
| `echeances.csv` | `reference;date;capital;interets;pieces` | Échéances de l'exercice réglées en trésorerie : l'échéance du même mois prend ces montants et passe réglée ; le capital restant se répartit sur les échéances à venir. Le compte rendu compare le capital restant dû des échéanciers aux comptes 16 et 17. |
| `budget.csv` | `compte;mois;montant;activite;centre_cout;ligne` | Budget mensuel (montants positifs), année `REPRISE_BUDGET_ANNEE` : une ligne budgétaire par compte ou préfixes de compte (« 6611, 664 »), ou « résiduel » (charges de la classe 6 qu'aucune autre ligne ne couvre), activité et centre de coût (nature déduite de la classe : 7 produits, 2 investissements, sinon charges ; libellé `ligne`, à défaut celui du compte). Rejouer le fichier met à jour les lignes. |
| `rotations.csv` | `date_chargement;date_livraison;ensemble;chauffeur;client;route;produit;bl;volume_charge;volume_livre;tarif;carburant;peages;frais_chauffeur;entretien;taxes;autres;facturee;observations;date_retour;litres;km;pneus` | `facturee` = oui pour une rotation déjà facturée dans l'ancien système : elle sert à l'analyse de rentabilité, jamais refacturée. Les ensembles, chauffeurs et routes inconnus sont créés (le contrôle les signale). `produit` : code ou libellé d'un produit de Finance > Transport > Paramètres (gasoil par défaut). `taxes` : total des taxes spécifiques de l'ancien classeur, repris comme forfait hors barème ; la rotation ne reçoit alors pas les taxes du barème (sinon, le barème s'applique ; 0 : aucune taxe). Volumes en m³, tarif par m³. Colonnes facultatives : `date_retour` (retour au dépôt, durée de la rotation), `litres` (carburant), `km` (à défaut, aller-retour de la route), `pneus` (GNF). |

Ordre de chargement : comptes, axes, journaux, tiers, soldes d'ouverture, immobilisations, routes,
chauffeurs, ensembles, écritures (puis lettrage), emprunts, budget, rotations (un seul passage
suffit, le script les traite dans cet ordre). Une immobilisation isolée peut aussi se reprendre dans
l'écran Immobilisations (« Bien déjà en service »), un emprunt dans l'écran Dette.

Relevés bancaires : les opérations de trésorerie reprises par `ecritures.csv` mouvementent déjà les
comptes de banque. Ne pas importer les relevés de la même période depuis l'écran Trésorerie (les
mouvements seraient comptés deux fois) : importer les relevés à partir du lendemain de la date
d'arrêté de la reprise, puis les rapprocher.

## Déroulement

```bash
# sur le serveur, fichiers déposés dans ~/reprise
scripts/reprise/reprise.sh recette ~/reprise                  # contrôle : anomalies listées, rien n'est enregistré
scripts/reprise/reprise.sh recette ~/reprise --appliquer      # enregistrement, seulement si aucune anomalie
```

Variables : `REPRISE_DATE_OUVERTURE=2026-01-01` (date des à-nouveaux), `REPRISE_SOCIETE=groupe`
ou `cabinet`, `INIT_DB=eguitra_recette` pour viser une autre base que celle de `.env`.

Contrôles après reprise, avec le département Finance : balance d'ouverture (écran Balance et
états) comparée à la balance de clôture de l'ancien système, soldes des comptes de tiers,
nombre et chiffre d'affaires des rotations par mois.

## Dossier JSON du prototype de la direction

Le prototype « EGUITRA Finance, moteur comptable » enregistre un dossier JSON (schéma 1 : plan de
comptes, référentiels, ventes, achats, trésorerie, transport, immobilisations, journal des OD,
dettes, budget). Dossier et prototype sont des documents du client : ils se lisent comme des données
(`python -I`, depuis un autre répertoire que celui des téléchargements), et les fichiers produits ne
se versionnent pas.

```bash
# 1. Valeurs de référence du prototype (vue « Validation face au classeur »)
python -I scripts/reprise/extraire_reference.py chemin/EGUITRA_App.html sortie/reference.json
# 2. Conversion du dossier en fichiers de reprise (+ parametres.json, rapport_conversion.txt)
python -I scripts/reprise/dossier_json.py chemin/EGUITRA_dossier_2026.json sortie
#    --taux-implicites : reprend le taux des emprunts déduit des échéances (sinon 0, signalé)
# 3. Recalcul des valeurs de référence sur les fichiers, comme la plateforme les comptabilisera
python -I scripts/reprise/controle_reference.py sortie sortie/reference.json --rapport=sortie/controle.txt
#    --relatif : écarts en pourcentage, sans montants ; --ecart-reprise=derniere : variante des amortissements
# 4. Sur le serveur : simulation, puis enregistrement
scripts/reprise/reprise.sh recette ~/reprise
REPRISE_DATE_OUVERTURE=2026-01-01 REPRISE_BUDGET_ANNEE=2026 scripts/reprise/reprise.sh recette ~/reprise --appliquer
```

La conversion suit l'imputation du moteur du prototype : ventes (client 411000, produit de
l'activité, TVA collectée si le client est assujetti), achats (charge ou immobilisation de la
catégorie, TVA récupérable si la catégorie l'ouvre, compte fournisseur ou, hors 401100, OD contre le
compte de la catégorie), trésorerie (contrepartie du type d'opération, montant × taux, lettrage par
la référence de facture), à-nouveaux du journal AN avec les comptes client et fournisseur éclatés par
facture de l'exercice précédent (écart d'arrondi soldé sur la dernière), cumul des amortissements au
31/12 calculé comme le prototype (écart d'arrondi avec l'à-nouveau du 28x soldé sur un bien du
compte), OD reprises telles quelles sauf les dotations (calculées par la plateforme), rotations en
m³ et tarif par m³.

Le contrôle (`controle_reference.py`) recalcule les indicateurs avec les formules du prototype sur
les fichiers produits, dotations comprises telles que la plateforme les calculera depuis le registre
(module d'immobilisations : prorata temporis au jour de la mise en service, écart de reprise porté
sur la première dotation de l'exercice). Le prototype, lui, amortit en mois entiers à compter du mois
suivant l'acquisition : la différence des deux conventions se lit dans le détail des dotations par
bien, et se retrouve dans les dotations, les résultats, les capitaux propres et les totaux de la
balance et du bilan. Elle relève d'une décision avec l'expert-comptable (accepter le rattrapage de la
première dotation, ou porter l'écart de reprise en fin de plan).

Mesure de la permanence des méthodes : `dossier_json.py --convention=prototype` produit un registre
dont le plan suit la convention du prototype (méthode « mois » : 12 × durée dotations égales du
module, `method_time` « nombre de dotations », à compter du 1er du mois qui suit l'acquisition) ;
`controle_reference.py` la reproduit. Aucun réglage d'une catégorie en « durée en années » (prorata
ou non, calcul au jour, années bissextiles) ne donne des mois entiers ; la méthode se poserait bien
par bien (le module la porte sur chaque immobilisation), pas sur la catégorie dont la durée resterait
en années pour les acquisitions nouvelles. Il reste des écarts d'arrondi au-delà de la tolérance du
prototype (dotation mensuelle constante arrondie au franc, là où le prototype arrondit le cumul) :
variante de mesure seulement, que `reprise.py` refuse tant que la convention n'est pas décidée.
