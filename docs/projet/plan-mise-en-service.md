# Plan de mise en service : ce qu'il reste, qui fait quoi

Établi le 6 novembre 2026. À tenir à jour jusqu'au procès-verbal de mise en production.

Ordre retenu : d'abord ce qui protège et ne dépend que du prestataire (étape 1), puis ce qui protège
contre les pénalités (étapes 2 et 3), enfin ce qui dépend du client (étapes 4 et 5).

Décision attendue du gérant : le lien unique `https://nimova.cloud`. Si elle est prise, l'adresse de
production de NIMOVA Terrain et l'adresse publique du service client suivent ; à trancher avant de
construire l'APK de production (l'APK de démonstration vise la recette et n'en dépend pas).

## Étape 1. Services techniques : 30 minutes du gérant, quand il veut

Chaque geste demande un compte ou un mot de passe : le gérant le fait, le prestataire finit derrière.
Les commandes se lancent dans un terminal du poste. Les secrets s'y collent masqués.

| N° | Sujet | Geste du gérant | Coût | Ensuite, sans le gérant |
|---|---|---|---|---|
| 1.1 | Alertes | Installer l'application ntfy sur le téléphone, lancer `alerte`, s'abonner au sujet affiché | gratuit | Contrôle de la réception |
| 1.2 | Sonde externe | Créer un compte sur healthchecks.io, un contrôle de période 5 minutes et de tolérance 15 minutes, puis lancer `sonde` | gratuit | Contrôle du signal |
| 1.3 | Copie hors site | Créer un compte Backblaze **en région EU Central**, un bucket privé, une clé limitée à ce bucket, puis lancer `hors-site`, puis ranger les deux mots de passe au coffre | gratuit jusqu'à 10 Go, ensuite 6,95 $ par To et par mois | Restauration d'essai depuis la copie, `OFFSITE_REQUIRED`, compte rendu |
| 1.4 | Courriel | Chez OVH, commander une boîte Zimbra Starter `notifications@nimova.cloud` et choisir son mot de passe, puis lancer `courriel` | 0,30 € HT par mois | DKIM et DMARC dans la zone DNS, envoi d'essai, parcours du service client et des relances sur la recette |
| 1.5 | Application Terrain | Dans `apps/terrain`, se connecter à son compte Expo : `npx eas-cli@latest login` | gratuit pour l'essai | Construction de l'APK de démonstration, lien d'installation |

Commandes :

```bash
ssh -t eguitra-vps "cd ~/eguitra && bash infra/poser-secrets.sh alerte"
```

```bash
ssh -t eguitra-vps "cd ~/eguitra && bash infra/poser-secrets.sh sonde"
```

```bash
ssh -t eguitra-vps "cd ~/eguitra && bash infra/poser-secrets.sh hors-site"
```

```bash
ssh -t eguitra-vps "cd ~/eguitra && bash infra/poser-secrets.sh courriel notifications@nimova.cloud"
```

Détail de la copie hors site (1.3) :

1. Inscription sur backblaze.com, offre B2. La région se choisit à l'inscription et conditionne
   l'article 5.1 de l'accord de confidentialité (Union européenne) : choisir EU Central.
2. Buckets, créer un bucket : privé, nom unique du type `nimova-sauvegardes-2026`, chiffrement par
   défaut désactivé (la plateforme chiffre avant l'envoi).
3. Réglages du cycle de vie du bucket : garder les versions précédentes 30 jours.
4. Application Keys, nouvelle clé : limitée à ce bucket, lecture et écriture. L'écran ne permet pas
   d'exclure le droit de suppression : point à durcir ensuite par l'interface de programmation.
5. Coller l'identifiant, la clé et le nom du bucket dans `hors-site`.

## Étape 2. Chiffres et dates : 15 minutes du gérant

Le prestataire a besoin de trois réponses pour finaliser les documents.

| Réponse | Sert à | Repère |
|---|---|---|
| Date d'encaissement de l'acompte et T0 retenu | Avenant à l'offre (article 5), comité n° 1 | Le T0 fixe la date contractuelle et les pénalités |
| Charge ou montant de chaque ajout, échéancier, forfait annuel | Avenant à l'offre (articles 2 à 4) | Tarif de l'offre : 750 000 GNF HT par jour-homme. HSSEQ, note de cadrage : 69 jours-homme pour les lots 1 à 3, soit 51 750 000 GNF HT, à ajuster au livré |
| Qui porte la clé d'Anthropic et son coût | Avenant à la confidentialité (article 2.5) | Facturation à l'usage |

Relire aussi la ligne « AxisPro V2.0 » de l'avenant à l'offre : garder ou retirer. Ces deux avenants sont
des projets à faire relire par un juriste si le montant le justifie.

## Étape 3. Avec le client : semaine du 9 novembre 2026

Priorité la plus haute : tant que T0 et le premier comité manquent, les retards du client ne sont pas
opposables et les pénalités courent potentiellement contre E-VOLUTION XP (0,1 % par jour, plafond
2 500 000 GNF).

| N° | Action | Document |
|---|---|---|
| 3.1 | Tenir le comité n° 1 : T0, référents, jour du comité | `Comite_de_pilotage_01.docx` |
| 3.2 | Faire contresigner le registre des prérequis, avec une date attendue pour chaque ligne | section 5 du comité |
| 3.3 | Signer l'avenant à l'offre | `Avenant_offre.docx` |
| 3.4 | Signer l'avenant à la confidentialité | `Avenant_confidentialite.docx` |
| 3.5 | Présenter le lot 2 de simplicité (environ 40 jours) pour décision | `audit-ux-2026-11-04.md` |

## Étape 4. Après signature de l'avenant à la confidentialité

| N° | Action | Qui |
|---|---|---|
| 4.1 | Créer les clés sur console.anthropic.com et lancer `poser-secrets.sh ia` | Gérant |
| 4.2 | Lire un business plan d'essai sur la recette, contrôler la fiche | Prestataire |
| 4.3 | WhatsApp : compte Meta Business vérifié, numéro dédié par société, modèles approuvés | Client et gérant |
| 4.4 | Variables `WHATSAPP_*`, parcours du service client sur la recette | Prestataire |

## Étape 5. Reprise des données et mise en production

Conditions de feu vert : `plan-de-bascule.md`, chapitre 1. La reprise se déroule ainsi.

| N° | Action | Qui | Il faut |
|---|---|---|---|
| 5.1 | Remettre les pièces | Client | P3 relevés, P6 plan de comptes, P7 classeur et date d'arrêté, E1 identité, V2 à V4 choix comptables |
| 5.2 | Saisir l'identité des sociétés, reprise rejouée en recette, écarts traités | Prestataire | 5.1 |
| 5.3 | Valider les balances d'ouverture et de clôture, société par société | Responsable financier | 5.2 |
| 5.4 | Former les référents, dérouler le cahier de recette | Prestataire, référents | 5.2 |
| 5.5 | Rétablir la double authentification en production, enrôler chaque compte | Prestataire, utilisateurs | avant toute donnée réelle |
| 5.6 | Comité : feu vert, gel du classeur, reprise en production, contrôles | Tous | 5.3 à 5.5, 1.1 à 1.4 |
| 5.7 | Procès-verbaux de recette et de mise en production | Direction, prestataire | 5.6 |
| 5.8 | Effacer la base d'essai `eguitra_reprise_essai` et `~/reprise-essai` (données réelles sur la recette) | Prestataire, sur accord du gérant | convention d'amortissement décidée (V2) |
| 5.9 | Rétablir la double authentification sur la recette, renouveler ses secrets | Prestataire | fin des tests |

## Fait le 6 novembre 2026

- `nimova.cloud` et `www` pointés vers le serveur, redirigés vers `finance.nimova.cloud`, certificats
  obtenus.
- Chaîne de copie hors site essayée en conditions réelles, vers un dossier jetable : `offsite.sh full`,
  chiffrement, relecture déchiffrée identique. Reste à la jouer vers Backblaze.
- Profils `recette` et `production` de NIMOVA Terrain corrigés : sans adresse de serveur, l'application
  aurait refusé de démarrer.
- NIMOVA Terrain prêt à construire : dépendances alignées sur le SDK 58 (19 mises à jour de correction).
  Types, 79 tests sur 79, `expo-doctor` 20 sur 20, export Android : tout passe.
- `infra/poser-secrets.sh` : pose masquée des secrets.
- Projets des deux avenants et du comité n° 1, rendu contrôlé.

Le canal d'alerte n'a pas pu être créé par la session de travail : le contrôle automatique de
l'environnement a refusé l'envoi vers `ntfy.sh` depuis le serveur. D'où le geste 1.1.
