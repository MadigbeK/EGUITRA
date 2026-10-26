# Procédure de support et de maintenance

Plateforme EGUITRA (EGUITRA Finance, AxisPro Suite, portail des porteurs de projets, Rotations).
Document remis avec le procès-verbal de mise en production. Il met en œuvre le chapitre 7 de l'offre
OTF-EGUITRA-2026-37 (garantie, support, évolutions).

## 1. Qui contacter, et comment

| Canal | Coordonnées | Pour |
|---|---|---|
| Espace partagé de suivi des demandes | « Mes demandes », dans le menu du compte de chaque application (initiales en haut à droite de l'écran) | toute demande : anomalie, remarque de recette, question, évolution (canal de référence) |
| Messagerie (WhatsApp) | +224 628 86 22 55 | urgence, en complément d'une demande déposée |
| Téléphone | +224 628 86 22 55 | anomalie bloquante |
| Courriel | emkouyate@e-volutionxp.com | pièces jointes (captures, fichiers), en citant le numéro de la demande |

Horaires : du lundi au vendredi, de 8 h à 18 h (heure de Conakry), jours fériés guinéens exclus. Les
délais se comptent en heures et jours ouvrés dans ces horaires.

Les demandes sont portées par les référents désignés par le client (un pour EGUITRA GROUP, un pour MB
AxisPro Consulting) : ils qualifient la gêne, reproduisent le problème et suivent la réponse. Les
porteurs de projets s'adressent à leur consultant du cabinet, jamais directement au support : le
portail n'ouvre pas l'espace de suivi.

Dans « Mes demandes », chaque compte interne voit les demandes qu'il a déposées ; la direction voit
aussi celles de ses sociétés, sans les modifier ; E-VOLUTION XP (profil Administration) les voit toutes
et seul les fait avancer.

## 2. Déposer une demande

Dans « Mes demandes », bouton « Nouvelle demande » : type (anomalie, remarque de recette, demande
d'évolution, question), application concernée, gravité proposée (anomalie ou remarque de recette),
société concernée pour un compte ouvert aux deux, titre et description.

La description précise : qui (identifiant), quand (date et heure), où (application, écran), quoi (ce
qui était attendu, ce qui s'est produit, message affiché) et l'urgence ressentie. Une capture d'écran
s'envoie par courriel en citant le numéro de la demande. Ne jamais transmettre de mot de passe ni de
code de double authentification.

Chaque demande reçoit son numéro dès le dépôt (DEM-AAAA-NNNN, suivi sans trou, repris à 1 chaque
année), puis un accusé de réception dans son fil à sa prise en charge.

## 3. Gravités et délais (offre, chapitre 7.2)

| Gravité | Définition | Prise en charge | Résolution ou contournement |
|---|---|---|---|
| Bloquante | Application inaccessible ou saisie impossible pour tous | 2 heures ouvrées | 8 heures ouvrées |
| Majeure | Fonction essentielle indisponible pour un profil | 4 heures ouvrées | 2 jours ouvrés |
| Mineure | Gêne sans blocage | 1 jour ouvré | prochaine livraison planifiée |

La gravité proposée par le référent est confirmée à la prise en charge (« Gravité retenue » dans le
fil de la demande) ; un désaccord se règle au comité de suivi. Une anomalie bloquante détectée par la
supervision (application sans réponse, sauvegardes en retard) est traitée d'office, sans attendre de
demande. Les délais constatés (heures ouvrées entre le dépôt et la prise en charge, puis la
résolution) s'affichent sur chaque demande, et « hors délai » quand l'engagement est dépassé.

## 4. Traitement

Chaque étape s'inscrit dans le fil de la demande, où le référent et le support échangent ; l'état de la
demande la suit : déposée, prise en charge, en cours, résolue, close (ou refusée).

1. Prise en charge : accusé de réception, gravité confirmée, premier diagnostic.
2. Contournement si la résolution demande plus de temps que le délai engagé : le référent en est
   informé par écrit, dans le fil.
3. Correction : développée et testée sur la recette, puis mise en production par la procédure de
   livraison (`infra/release.sh` : sauvegarde de la base, mise à jour, contrôle). Une mise en
   production est annoncée 48 heures à l'avance, sauf correctif d'une anomalie bloquante. La demande
   passe « résolue » avec une réponse écrite.
4. Clôture : le référent confirme la résolution (« Confirmer la résolution ») ou rouvre la demande en
   disant ce qui ne fonctionne toujours pas ; sans réponse sous 5 jours ouvrés, la demande est close
   d'office (tâche de nuit). Une demande hors périmètre ou sans objet est refusée, motif écrit dans la
   réponse. Une demande close ou refusée ne change plus : un nouveau besoin fait une nouvelle demande.

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

- Le référent dépose la demande dans « Mes demandes », type « Demande d'évolution ».
- E-VOLUTION XP la qualifie par écrit sous 2 jours ouvrés, dans la demande : incluse ou facturable,
  charge estimée, date de livraison proposée.
- Une évolution incluse (2 jours-homme au plus, sur les écrans et données existants) est imputée sur
  le crédit du trimestre (6 jours, cumulables à l'intérieur du trimestre, non reportables) et livrée
  en recette puis en production. La plateforme refuse d'imputer plus de 2 jours sur une évolution ou
  de dépasser le crédit du trimestre ; une évolution refusée rend son crédit. La fiche d'une évolution
  montre le crédit consommé et restant du trimestre.
- Une évolution facturable fait l'objet d'un devis selon le chapitre 7.4 de l'offre, engagé seulement
  après accord écrit du client.
- Un décompte du crédit consommé et restant est communiqué chaque trimestre, avec la liste des
  demandes traitées (synthèse de « Mes demandes », profil Administration).

## 8. Comptes rendus remis au client

| Quoi | Rythme | Source |
|---|---|---|
| Disponibilité de la production (engagement 99,5 %) | mensuel | `infra/availability-report.py` |
| Test de restauration à un instant donné | trimestriel | `infra/backup/restore-test.sh --report` |
| Décompte des évolutions et des demandes | trimestriel | « Mes demandes », onglet Synthèse (demandes par état, délais de prise en charge, crédit par trimestre) |
| Mises en production | à chaque livraison | `infra/releases/HISTORY` |

## 9. Ce que le client garde la main sur

Comptes des utilisateurs et profils (Administration), seuils d'alerte et d'approbation, grille
AxisPro (versions), identité des sociétés : ces réglages se font dans les applications, sans
demande au support. Les guides par profil (`docs/guides/word/`) et le guide intégré de Finance
(`/finance/guide`) en décrivent l'usage.
