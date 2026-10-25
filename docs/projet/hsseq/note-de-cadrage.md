# NIMOVA · HSSEQ : note de cadrage

25 octobre 2026. Pour le gérant d'E-VOLUTION XP. Réponse aux « points à confirmer » de la spécification NIMOVA HSSEQ v1.0 du 24 octobre 2026 (Direction générale d'EGUITRA GROUP), avec la charge et le calendrier proposés.

## Hors du périmètre de l'offre

Le module HSSEQ ne figure pas dans l'offre OTF-EGUITRA-2026-37, dont le périmètre est fixé à son chapitre 3. C'est un module complet, avec de nouveaux écrans, une interface avec la télématique au lot 3 et des ajouts au modèle de données de Transport et de RH : il dépasse les évolutions incluses du chapitre 7.4 (2 jours-homme au plus, sans nouveau module). Il relève donc d'un avenant chiffré (chapitre 8 : « toute évolution de périmètre fait l'objet d'un avenant chiffré »). Recommandation : signer l'avenant du lot 1 avant d'en commencer la réalisation, puis un avenant par lot.

## 1. Technologie et appel du verrou

- **Même socle que le reste de NIMOVA.** Un module Odoo 19 `eguitra_hsseq`, une API métier sous `/api/v1/hsseq/…` exécutée sous l'identité de l'utilisateur, et des écrans dans l'application web existante sous `/hsseq`. HSSEQ devient la huitième application, ouverte aux deux sociétés. Elle reprend l'authentification, la double authentification, la journalisation et la charte en place.
- **Contrat d'interface.** Il est repris tel quel, aux conventions de l'API : `POST /api/v1/hsseq/verrou/evaluer` avec `{ rotation_id }`. La réponse est `{ autorise, motifs: [{ code, libelle, source, depuis, derogeable }], derogation_active }`.
- **Le verrou ne vit pas dans l'écran.** Transport ne connaît aujourd'hui que quatre états de rotation : saisie, validée, facturée, annulée. On ajoute l'étape « en route ». Son passage appelle, dans le noyau, une méthode de contrôle que Transport déclare vide et que HSSEQ remplit. Conséquences :
  - quel que soit le client (écran, téléphone, appel direct), un départ avec un motif ouvert est refusé ;
  - sans HSSEQ installé, Transport fonctionne comme aujourd'hui ;
  - Transport ne dépend pas de HSSEQ.
- **Paramétrage.** L'activation de chaque motif par profil de véhicule et par site se fait dans une table modifiable sans développement. La notion de site (dépôt, base) n'existe pas encore : HSSEQ en crée une liste, rattachée aux véhicules.

## 2. Formulaires hors ligne dans Rotations

- **Existe :** l'application installable, son fonctionnement sans réseau, une file d'attente sur le téléphone avec une clé qui évite les doublons à la synchronisation, et l'heure de saisie distincte de l'heure de synchronisation.
- **À ajouter :**
  - les trois formulaires (contrôle pré-départ, alcootest, déclaration) ;
  - les photos : compressées sur le téléphone (environ 200 Ko), gardées dans la file, envoyées à la synchronisation ;
  - la position GPS et la signature.

  C'est faisable dans la même architecture. Le risque à suivre est la place disponible sur les téléphones d'entrée de gamme lors de longues coupures : nombre de photos limité par formulaire, purge après envoi.
- **Profil « conducteur » à créer.** Rotations exige aujourd'hui le profil exploitation. Il faut un profil limité au téléphone : ses propres formulaires et ses habilitations, rien d'autre.

## 3. Ce que Transport contient déjà

- **Rotations :** kilomètres, carburant en litres, volumes chargés et livrés à 15 °C, manquants.
- **Véhicules :** l'ensemble routier (tracteur et citerne), sa capacité en litres et son état (en service, en maintenance, hors service).
- **Chauffeurs :** le numéro et la date de validité du permis. Le dossier salarié de la RH est déjà relié au chauffeur.
- **Manque pour le lot 1 :** les documents du véhicule avec leur date d'expiration (assurance, visite technique), nécessaires au motif V05. On les ajoute à la fiche véhicule de Transport.
- **Manque pour le lot 2 :**
  - le profil citerne ou benne. Tous les véhicules sont aujourd'hui des citernes ; le transport de minerais en benne n'existe pas ;
  - la charge utile en tonnes et le ticket de pesée (motif V07) ;
  - le barémage et l'étanchéité de la citerne (motif V06) ;
  - le plan de trajet et les temps de conduite (motif V08).

  Le transport en benne est un vrai ajout à Transport, à chiffrer avec le lot 2.

## 4. Ce que RH contient déjà

- **Existe :**
  - le personnel ;
  - les postes ;
  - les documents du salarié avec leur date d'expiration ;
  - les absences ;
  - les jours payés de chaque mois.
- **Heures réellement travaillées.** Elles ne sont pas saisies : il n'y a pas de pointage. Sans pointage, le taux de fréquence et le taux de gravité se calculent sur les heures payées (jours payés × durée journalière), ce que le cockpit affiche comme approximation. Un pointage ferait un chantier à part.
- **Accidents du travail.** Il n'existe pas de type d'absence « accident du travail » : on l'ajoute, pour compter les jours perdus.
- **Habilitations (lot 2).** Il faut les types d'habilitation (permis, conduite défensive, matières dangereuses, accès site minier, secourisme) et l'aptitude médicale, en statut seulement. On les ajoute aux documents du salarié, sans détail médical.

## 5. Points à trancher par EGUITRA GROUP avant le lot 1

1. **Le site pilote et la liste des sites.**
2. **Le geste du départ.** Qui passe la rotation « en route » : le chef de parc ou le conducteur sur son téléphone ? Les conducteurs ont-ils un téléphone et un compte ?
3. **L'éthylotest utilisé.** Le résultat est saisi par le contrôleur, sauf appareil connecté à préciser.
4. **La confidentialité de l'alcootest.**
   - Ce qui est prévu : le résultat chiffré est enregistré à part, lisible par le seul responsable HSSEQ, et chaque consultation est journalisée. Les autres écrans ne lisent qu'un statut.
   - Le chiffrement au niveau du champ demande un dispositif de clé à valider.
5. **Les maquettes annoncées par la spécification**, non reçues. Les écrans suivront la charte NIMOVA en attendant.
6. **Les SMS pour les criticités élevées**, si l'option est retenue. Il faut choisir un fournisseur.

## 6. Charge et calendrier proposés

Estimation à confirmer au terme d'une semaine de cadrage, comme le prévoit la spécification.

| Lot | Contenu | Charge | Calendrier |
|---|---|---|---|
| 1 | Événements, enquêtes et plan d'actions ; grilles et contrôles pré-départ (citerne, puis benne au lot 2), alcootest ; verrou V01 à V05, étape « en route » de Transport, documents du véhicule ; trois formulaires hors ligne ; cockpit de base ; profils HSSEQ et conducteur ; tests | 26 jours-homme | 6 semaines de réalisation, puis 4 semaines de pilote (critère de recette : 100 % des départs contrôlés pendant 4 semaines) |
| 2 | Registre des risques ; habilitations reliées à RH ; transport en benne ; motifs V06 à V09 ; audits et conformité ; tous les sites ; rapport mensuel au format du donneur d'ordre (indicateurs proactifs et réactifs, plan contre réalisé) | 25 jours-homme | 6 semaines, puis audit interne |
| 3 | Environnement et qualité ; documents et plans d'urgence ; revue de direction | 18 jours-homme | 5 semaines |
| 3 bis | Intégration des données télématiques (OBC, GPS, IVMS) | selon le fournisseur et son interface | à chiffrer avec lui |

Total hors télématique : environ 69 jours-homme sur six à sept mois, pilote et audit compris. La spécification prévoyait 30 semaines.

## 7. Règles de NIMOVA appliquées au module

- **Droits par profil.** Chaque fonction du serveur est réservée aux rôles de la spécification. Sont prévus :
  - un test de refus par rôle ;
  - un compte de test de la recette par rôle ;
  - les écrans alignés sur ces droits.
- **Deux validations distinctes pour une dérogation :** le chef de parc puis le responsable HSSEQ, deux personnes différentes, comme pour les approbations.
- **Données réservées.** L'alcootest et l'aptitude ne sont lisibles en détail que par le responsable HSSEQ.
- **Aucune ressaisie.** HSSEQ lit les véhicules, les rotations, le personnel et les absences là où ils sont. Il n'écrit dans Transport que par le verrou et par l'immobilisation d'un véhicule.
