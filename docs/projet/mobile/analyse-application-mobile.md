# Application mobile NIMOVA pour téléphone et tablette : analyse

Analyse du 25 octobre 2026, à partir des documents remis par la Direction générale d'EGUITRA GROUP
(spécification du module HSSEQ v1.0 du 24 octobre 2026, deux classeurs d'indicateurs HSSE, arrêté
n° A/2019/816/MH et classeur de tarifs SONAP) et de l'état du code de la plateforme.

## 1. Ce que les documents demandent au mobile

La spécification HSSEQ fait du terrain le cœur du module. Trois formulaires doivent fonctionner sans
réseau, avec photos et position GPS : le **contrôle avant départ**, l'**alcootest** et la
**déclaration d'événement ou de situation dangereuse**. Le **verrou de départ**, évalué par le
serveur, empêche une rotation de partir tant qu'un motif bloquant reste ouvert (V01 à V09).

Les classeurs d'indicateurs ajoutent les besoins du reporting HSSE attendu par les donneurs d'ordre
(format « EASY LOGISTICS », transporteur T.G.H-PLUS SA) :
- des centaines de presque-accidents à déclarer chaque mois (cible de 504 par mois) : la
  déclaration doit prendre moins de 30 secondes ;
- contrôles inopinés sur la route et en station, alcootests à 100 % des départs, réunions de
  sécurité (« TBM »), exercices d'urgence, port des EPI ;
- violations des « règles de survie » et des boîtiers embarqués (OBC, GPS, IVMS), qui relèvent de la
  télématique (lot 3 de la spécification) et non de la saisie.

## 2. Qui l'utilise, sur quel appareil

| Utilisateur | Appareil | Usage principal |
|---|---|---|
| Conducteur | Téléphone personnel ou de service | Ses rotations, contrôle avant départ, alcootest, déclaration en moins de 30 s, ses habilitations |
| Chef de parc | Tablette au dépôt | Contrôles de la flotte du jour, levée des non-conformités avec photo, demande de dérogation, alcootests en série |
| Responsable HSSEQ | Tablette et téléphone | Inspections et contrôles inopinés, réunions de sécurité avec émargement, classement des événements, validation des dérogations, seul accès aux résultats d'alcootest |
| Exploitation, maintenance | Téléphone | Rotations, immobilisations, actions qui leur sont confiées |
| Direction | Tablette | Lecture du cockpit, départs bloqués, alertes de criticité élevée |

Une tablette de dépôt est **partagée** entre plusieurs personnes : il faut un changement
d'utilisateur rapide (code personnel ou badge QR) et ne jamais laisser une session ouverte.

## 3. L'existant à réutiliser

- **Rotations** (`/mobile`) est déjà une application web installable, hors ligne : file d'attente
  locale (IndexedDB), envoi groupé idempotent (`client_uuid`), délais d'attente, pastille « réseau
  faible ». Elle ne gère ni photo, ni GPS, ni signature, et n'a qu'une mise en page portrait pour
  téléphone.
- L'**API** `/api/v1` sait déjà ouvrir une session longue pour Rotations, déposer des pièces jointes
  contrôlées (`eguitra_api/files.py`) et appliquer les droits par profil.
- Les **sauvegardes**, la **journalisation des accès** et le **contrôle des fichiers** sont en place.

## 4. Choix technique

| Option | Atouts | Limites |
|---|---|---|
| A. Étendre l'application web installable actuelle | Un seul code, mises à jour immédiates, rien à publier en boutique | Sur iPhone, stockage hors ligne purgeable et pas d'envoi en arrière-plan ; pas d'appareil Bluetooth (éthylotest connecté) ; tablette partagée mal maîtrisée |
| B. Même application web, emballée en application Android (TWA) | Distribution par Google Play ou fichier APK, mêmes écrans | Mêmes limites que A pour l'arrière-plan et le Bluetooth |
| C. Application native multiplateforme (React Native avec Expo) | Hors ligne robuste (base SQLite locale), photos et GPS natifs, envoi en arrière-plan, notifications push, Bluetooth possible, mise en page téléphone et tablette, mises à jour sans boutique (EAS Update) | Second code à maintenir ; publication en boutique ; il faut une passerelle d'accès pour les applications (aujourd'hui le noyau n'est joint que par l'application web) |

**Recommandation : option C, une application « NIMOVA Terrain » en React Native (Expo)**, pour le
téléphone et la tablette, en TypeScript comme l'application web : les types de l'API se partagent.
C'est la seule option qui tient les exigences de la spécification sur un réseau guinéen instable :
photos stockées en local jusqu'à l'envoi, horodatage de saisie distinct de celui de la
synchronisation, envoi en arrière-plan, alertes push pour les criticités élevées, éthylotest
connecté le jour où l'appareil est choisi. Rotations rejoint cette application ; l'application web
`/mobile` reste en service le temps de la transition.

Pour la plupart des conducteurs, les téléphones seront des Android. La première diffusion se fait
donc en Android, par Google Play en accès restreint ou par fichier APK géré, avec une gestion de
flotte (MDM) recommandée pour les tablettes de dépôt. L'iPhone suit avec le même code.

## 5. Architecture

- **Passerelle d'accès pour les applications** : l'application native appelle la passerelle
  publique existante, avec des jetons d'accès et de renouvellement (déjà fournis par
  `/api/v1/auth/login`), stockés dans le coffre sécurisé du téléphone. Le noyau Odoo reste fermé à
  internet. La passerelle doit accepter un en-tête `Authorization` pour les applications, en plus des
  cookies du navigateur.
- **Hors ligne** : base SQLite locale, file d'envoi par formulaire, photos compressées (environ
  200 Ko), pièces envoyées après la fiche, reprise après coupure, aucun doublon (`client_uuid`).
- **Données de référence en cache** : véhicules et leur profil, grilles de contrôle par profil,
  rotations du jour, habilitations du conducteur.
- **Sécurité** : double authentification à l'inscription de l'appareil, puis code personnel sur
  l'appareil ; résultat d'alcootest chiffré sur l'appareil et visible du seul Responsable HSSEQ ;
  effacement à distance ; journal des accès.
- **Tablette partagée** : mode dépôt avec changement d'utilisateur par code ou badge QR, verrouillage
  automatique, aucune donnée personnelle laissée entre deux utilisateurs.

## 6. Ce qui manque côté serveur (bloquant pour le mobile)

| Besoin | État actuel | Session concernée |
|---|---|---|
| Module HSSEQ : événements, enquêtes, actions, grilles de contrôle, contrôles, alcootests, dérogations, verrou | Absent | À créer (session dédiée recommandée) |
| Statut « en route » d'une rotation, et appel obligatoire du verrou avant ce statut | Absent : une rotation est saisie, validée, facturée ou annulée | TRANSPORT |
| Profil du véhicule (citerne ou benne) | Absent : la flotte ne connaît que les ensembles tracteur et citerne | TRANSPORT |
| Documents du véhicule avec échéance (assurance, visite technique, barémage, étanchéité) | Absent : seule la validité du permis du conducteur existe | TRANSPORT |
| Charge utile, ticket de pesée, tonnage (profil benne, motif V07) | Absent : le transport est pensé en litres et en m³ | TRANSPORT |
| Plan de trajet, axes interdits la nuit, temps de conduite (motif V08) | Absent | TRANSPORT |
| Habilitations avec échéance (permis, conduite défensive, matières dangereuses, accès site minier, secourisme), aptitude médicale en statut seul, EPI remis | Absent | RH |
| Heures réellement travaillées et absences pour accident du travail (taux de fréquence et de gravité) | Absent : aucun type d'absence « accident du travail », pas de pointage | RH |
| Notifications par courriel | Aucun serveur de courriel configuré en production | Gérant (compte d'envoi) |
| Double authentification | Suspendue en production | Gérant (rétablir avant la reprise des données réelles) |

## 7. Écarts et points à corriger dans la spécification

- L'application « Rotations mobile » de la spécification ne sait aujourd'hui saisir que des
  rotations : les trois formulaires HSSEQ, les photos et le GPS sont à construire (section 13 de la
  spécification, deuxième point : réponse non, pas encore).
- Le contrat `POST /api/hsseq/verrou/evaluer` est à aligner sur les conventions de l'API :
  `POST /api/v1/hsseq/lock/evaluate`, champs en `snake_case`, réponse
  `{allowed, reasons[{code, label, source, since, waivable}], active_waiver}`.
- Les « maquettes d'écrans fournies séparément » (cockpit, fiche événement, contrôle avant départ
  mobile, registre des risques) n'ont pas été reçues.
- La spécification suppose la double authentification et les notifications par courriel en place :
  ce n'est pas le cas aujourd'hui en production (voir le tableau ci-dessus).
- Le profil benne (minerais en vrac, sites miniers) étend le Transport au-delà des produits
  pétroliers : c'est un chantier en soi, à planifier avec le lot 2.

## 8. Phasage proposé

| Étape | Contenu | Critère de fin |
|---|---|---|
| 0. Cadrage (1 semaine) | Choix confirmé (option C), appareils cibles (modèles Android, tablettes), éthylotest, mode dépôt, comptes de publication | Décisions écrites |
| 1. Socle (3 semaines) | Application Expo téléphone et tablette, connexion par jetons, coffre sécurisé, base locale et file d'envoi, mise à jour à distance, reprise de Rotations | Rotations saisies hors ligne depuis l'application, sans doublon |
| 2. HSSEQ lot 1 terrain (6 semaines, en parallèle du module HSSEQ) | Contrôle avant départ (deux profils), alcootest, déclaration en 30 s, photos, GPS, signature, verrou affiché avant le départ | Sur un site pilote, 100 % des départs contrôlés pendant 4 semaines, aucun départ avec un motif ouvert |
| 3. Tablette de dépôt et HSSE (4 semaines) | Mode dépôt, levée des non-conformités, dérogations, contrôles inopinés, réunions de sécurité avec émargement, notifications push | Reporting mensuel HSSE produit sans ressaisie |

## 9. Décisions du gérant (25 octobre 2026)

- **Option C** : application native React Native avec Expo, **Android d'abord**, iPhone ensuite avec
  le même code.
- **Pas de solution d'attente** : les trois formulaires HSSEQ sont construits directement dans
  l'application native, pas dans Rotations web, qui reste en service pour les rotations pendant la
  transition. Les maquettes et le système de conception « terrain » viennent de la session DESIGN.
- **Téléphones de service** pour les conducteurs, fournis par EGUITRA et gérés à distance ; tablette
  partagée au dépôt pour le chef de parc.
- **Périmètre** : l'offre couvre la saisie des rotations hors réseau, déjà livrée (Rotations web).
  L'application native et les formulaires HSSEQ forment un nouveau module, facturable selon le
  chapitre des évolutions de l'offre : avenant à chiffrer avec le module HSSEQ.
- Socle réalisé le même jour : `apps/terrain` (voir son `README.md`).

## 10. Autres documents reçus

- **Arrêté n° A/2019/816/MH du 19 mars 2019** (en vigueur au 1er avril 2019) : tarifs officiels de
  transport des hydrocarbures **en GNF par litre**, par dépôt et par destination (et non par
  kilomètre, malgré le nom du fichier). Quatre dépôts : Conakry SGP (116 destinations), Kankan SGP
  (51), N'Zérékoré SGP (19), Kamsar CBG (14), soit 200 tarifs.
- **Classeur SONAP « Tarifs Zones de Livraisons 2019 »** : reprend le seul dépôt de Conakry, avec des
  écarts de saisie par rapport à l'arrêté, sur ses deux feuilles. Exemples relevés : Balandougouba
  1 253,14 au lieu de 1 252,14, Tougnifily 313,45 au lieu de 213,45, Garafiri 325,18 au lieu de
  325,16, Gbenko 1 205,72 au lieu de 1 205,70 (comparaison complète à faire ligne à ligne). Sa colonne
  « Distance/KM » n'est pas une distance mesurée : c'est le tarif divisé par 1,05 (Tougnifily :
  203,29 = 213,45 ÷ 1,05, ce qui confirme la valeur de l'arrêté). L'arrêté fait foi ; il faut
  confirmer qu'aucun arrêté plus récent ne l'a remplacé depuis 2019.
- Ces tarifs relèvent de l'application Transport (référentiel des routes tarifées), pas du mobile.
