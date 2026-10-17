# Reprise des données

Les données du classeur 2026 (et des relevés bancaires) entrent dans le noyau par des fichiers CSV
simples, remplis à partir du classeur, contrôlés puis enregistrés par `reprise.sh`. Chaque fichier
est facultatif ; la reprise se rejoue autant de fois que nécessaire sur la base de recette avant
la production.

## Fichiers

Modèles dans `modeles/` (séparateur point-virgule, montants en GNF, dates JJ/MM/AAAA) :

| Fichier | Contenu | Remarques |
|---|---|---|
| `tiers.csv` | `type;nom;nif;rccm;telephone;email;adresse;ville` | type : client, fournisseur, client_fournisseur, preteur. Un tiers existant (même nom) est mis à jour. |
| `soldes_ouverture.csv` | `compte;libelle;tiers;debit;credit` | Une seule écriture d'à-nouveaux, équilibrée, à la date d'ouverture. Comptes de tiers (411, 401…) : nom du tiers obligatoire, une ligne par tiers. |
| `immobilisations.csv` | `code;libelle;profil;date_mise_en_service;valeur_brute;cumul;duree;activite;localisation;responsable` | Biens en service : `profil` = nom d'une catégorie créée dans l'écran Immobilisations (comptes 2x, 28x, 68x) ; `cumul` = amortissements cumulés à la veille de la date d'ouverture (31/12) ; `duree` en années (à défaut, celle de la catégorie) ; les trois dernières colonnes sont facultatives. Les dotations antérieures à l'ouverture deviennent des lignes de reprise, sans écriture ; celles de l'exercice sont calculées et comptabilisées par la plateforme (ne pas les reprendre dans `ecritures.csv`). Contrôle bloquant : par compte, cumul du registre = solde d'ouverture créditeur du 28x et valeur brute = solde d'ouverture débiteur du 2x. Un bien déjà présent (même code) est ignoré. |
| `ecritures.csv` | `piece;date;journal;compte;tiers;libelle;debit;credit;activite;centre_cout;chantier;ensemble;route;bien` | Écritures de l'exercice (ventes, achats, trésorerie, OD), une pièce par numéro et par journal (codes FAC, FACTU, BNK1, OD…), équilibrée et datée d'un seul jour. Chaque ligne s'impute sur les axes renseignés (nom ou code du compte analytique) : activités et centres de coût inconnus sont créés, ensembles routiers et routes aussi (avec leur fiche) ; chantiers et biens doivent exister dans l'application (le contrôle signale les autres). Une colonne `dossier` facultative sert à MB AxisPro Consulting. Les comptes de tiers sont ensuite lettrés : factures et règlements d'un même tiers se compensent. Une pièce déjà reprise est ignorée. |
| `budget.csv` | `compte;mois;montant;activite;centre_cout;ligne` | Budget mensuel (montants positifs), année `REPRISE_BUDGET_ANNEE` : une ligne budgétaire par compte ou préfixe de compte, activité et centre de coût (nature déduite de la classe : 7 produits, 2 investissements, sinon charges ; libellé `ligne`, à défaut celui du compte). Rejouer le fichier met à jour les lignes. |
| `rotations.csv` | `date_chargement;date_livraison;ensemble;chauffeur;client;route;produit;bl;volume_charge;volume_livre;tarif;carburant;peages;frais_chauffeur;entretien;taxes;autres;facturee;observations;date_retour;litres;km;pneus` | `facturee` = oui pour une rotation déjà facturée dans l'ancien système : elle sert à l'analyse de rentabilité, jamais refacturée. Les ensembles, chauffeurs et routes inconnus sont créés (le contrôle les signale). `produit` : code ou libellé d'un produit de Finance > Transport > Paramètres (gasoil par défaut). `taxes` : total des taxes spécifiques de l'ancien classeur, repris comme forfait hors barème ; la rotation ne reçoit alors pas les taxes du barème (sinon, le barème s'applique). Colonnes facultatives : `date_retour` (retour au dépôt, durée de la rotation), `litres` (carburant), `km` (à défaut, aller-retour de la route), `pneus` (GNF). |

Ordre de chargement : tiers, soldes d'ouverture, immobilisations, écritures, budget, rotations (un seul passage
suffit, le script les traite dans cet ordre). Les relevés bancaires se chargent depuis l'écran
Trésorerie (CSV ou XLSX), puis se rapprochent ;
les emprunts, peu nombreux, se saisissent dans l'écran Dette (échéanciers calculés par la plateforme) ;
une immobilisation isolée peut aussi se reprendre dans l'écran Immobilisations (« Bien déjà en service »).

## Déroulement

```bash
# sur le serveur, fichiers déposés dans ~/reprise
scripts/reprise/reprise.sh ~/reprise                  # contrôle : anomalies listées, rien n'est enregistré
scripts/reprise/reprise.sh ~/reprise --appliquer      # enregistrement, seulement si aucune anomalie
```

Variables : `REPRISE_DATE_OUVERTURE=2026-01-01` (date des à-nouveaux), `REPRISE_SOCIETE=groupe`
ou `cabinet`, `INIT_DB=eguitra_recette` pour viser une autre base que celle de `.env`.

Contrôles après reprise, avec le département Finance : balance d'ouverture (écran Balance et
états) comparée à la balance de clôture de l'ancien système, soldes des comptes de tiers,
nombre et chiffre d'affaires des rotations par mois.
