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
| `rotations.csv` | `date_chargement;date_livraison;ensemble;chauffeur;client;route;produit;bl;volume_charge;volume_livre;tarif;carburant;peages;frais_chauffeur;entretien;taxes;autres;facturee;observations` | `facturee` = oui pour une rotation déjà facturée dans l'ancien système : elle sert à l'analyse de rentabilité, jamais refacturée. Les ensembles, chauffeurs et routes inconnus sont créés (le contrôle les signale). |

Les relevés bancaires se chargent depuis l'écran Trésorerie (CSV ou XLSX), puis se rapprochent ;
les emprunts et les immobilisations, peu nombreux, se saisissent dans les écrans Dette et
Immobilisations (échéanciers et plans d'amortissement calculés par la plateforme).

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
