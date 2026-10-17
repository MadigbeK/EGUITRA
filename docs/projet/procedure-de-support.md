# Procédure de support et de maintenance

Plateforme EGUITRA (EGUITRA Finance, AxisPro Suite, portail des porteurs de projets, Rotations).
Document remis avec le procès-verbal de mise en production. Il met en œuvre le chapitre 7 de l'offre
OTF-EGUITRA-2026-37 (garantie, support, évolutions).

## 1. Qui contacter, et comment

| Canal | Coordonnées | Pour |
|---|---|---|
| Espace partagé de suivi des demandes | adresse remise avec le procès-verbal | toute demande : anomalie, question, évolution (canal de référence) |
| Messagerie (WhatsApp) | +224 628 86 22 55 | urgence, en complément d'une demande déposée |
| Téléphone | +224 628 86 22 55 | anomalie bloquante |
| Courriel | emkouyate@e-volutionxp.com | demande écrite, pièces jointes |

Horaires : du lundi au vendredi, de 8 h à 18 h (heure de Conakry), jours fériés guinéens exclus. Les
délais se comptent en heures et jours ouvrés dans ces horaires.

Les demandes sont portées par les référents désignés par le client (un pour EGUITRA GROUP, un pour MB
AxisPro Consulting) : ils qualifient la gêne, reproduisent le problème et suivent la réponse. Les
porteurs de projets s'adressent à leur consultant du cabinet, jamais directement au support.

## 2. Déposer une demande

Une demande précise : qui (identifiant), quand (date et heure), où (application, écran), quoi (ce
qui était attendu, ce qui s'est produit, message affiché), l'urgence ressentie et, si possible, une
capture d'écran. Ne jamais transmettre de mot de passe ni de code de double authentification.

Chaque demande reçoit un numéro et un accusé de réception.

## 3. Gravités et délais (offre, chapitre 7.2)

| Gravité | Définition | Prise en charge | Résolution ou contournement |
|---|---|---|---|
| Bloquante | Application inaccessible ou saisie impossible pour tous | 2 heures ouvrées | 8 heures ouvrées |
| Majeure | Fonction essentielle indisponible pour un profil | 4 heures ouvrées | 2 jours ouvrés |
| Mineure | Gêne sans blocage | 1 jour ouvré | prochaine livraison planifiée |

La gravité proposée par le référent est confirmée à la prise en charge ; un désaccord se règle au
comité de suivi. Une anomalie bloquante détectée par la supervision (application sans réponse,
sauvegardes en retard) est traitée d'office, sans attendre de demande.

## 4. Traitement

1. Prise en charge : accusé de réception, gravité confirmée, premier diagnostic.
2. Contournement si la résolution demande plus de temps que le délai engagé : le référent en est
   informé par écrit.
3. Correction : développée et testée sur la recette, puis mise en production par la procédure de
   livraison (`infra/release.sh` : sauvegarde de la base, mise à jour, contrôle). Une mise en
   production est annoncée 48 heures à l'avance, sauf correctif d'une anomalie bloquante.
4. Clôture : le référent confirme la résolution ; sans réponse sous 5 jours ouvrés, la demande est
   close.

## 5. Escalade

| Niveau | Quand | Qui |
|---|---|---|
| 1 | Toute demande | Support E-VOLUTION XP |
| 2 | Délai de prise en charge ou de résolution dépassé, désaccord sur la gravité | Gérant d'E-VOLUTION XP (Madigbè Kouyaté) et référent du client |
| 3 | Désaccord persistant, anomalies répétées | Comité de suivi : Directeur Général du client et gérant d'E-VOLUTION XP |

## 6. Garantie (offre, chapitre 7.1)

Six mois à compter du procès-verbal de mise en production, couvrant la première clôture annuelle
(états financiers annuels, déclarations fiscales de fin d'exercice) : toute anomalie par rapport au
périmètre recetté est corrigée sans frais, dans les délais ci-dessus. Les erreurs de saisie relèvent
du support (aide à la correction), les évolutions du chapitre 7.

## 7. Évolutions (offre, chapitre 7.4)

- Le référent dépose la demande dans l'espace partagé de suivi.
- E-VOLUTION XP la qualifie par écrit sous 2 jours ouvrés : incluse ou facturable, charge estimée,
  date de livraison proposée.
- Une évolution incluse (2 jours-homme au plus, sur les écrans et données existants) est imputée sur
  le crédit du trimestre (6 jours, cumulables à l'intérieur du trimestre, non reportables) et livrée
  en recette puis en production.
- Une évolution facturable fait l'objet d'un devis selon le chapitre 7.4 de l'offre, engagé seulement
  après accord écrit du client.
- Un décompte du crédit consommé et restant est communiqué chaque trimestre, avec la liste des
  demandes traitées.

## 8. Comptes rendus remis au client

| Quoi | Rythme | Source |
|---|---|---|
| Disponibilité de la production (engagement 99,5 %) | mensuel | `infra/availability-report.py` |
| Test de restauration à un instant donné | trimestriel | `infra/backup/restore-test.sh --report` |
| Décompte des évolutions et des demandes | trimestriel | espace partagé de suivi |
| Mises en production | à chaque livraison | `infra/releases/HISTORY` |

## 9. Ce que le client garde la main sur

Comptes des utilisateurs et profils (Administration), seuils d'alerte et d'approbation, grille
AxisPro (versions), identité des sociétés : ces réglages se font dans les applications, sans
demande au support. Les guides par profil (`docs/guides/word/`) et le guide intégré de Finance
(`/finance/guide`) en décrivent l'usage.
