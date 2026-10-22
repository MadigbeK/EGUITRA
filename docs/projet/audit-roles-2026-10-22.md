# Audit des rôles utilisateurs, 22 octobre 2026

Audit en lecture seule du code (branche `claude/bold-shannon-gpg2hv`, commit 29f45d9) et des comptes de la production et de la recette. Demandé par le gérant après la création des comptes de test RH. Les constats C1, I1 et I4 ont été revérifiés dans le code.

## Ce qui tient

- Les 458 routes de l'API sont filtrées par profil. Les 11 routes ouvertes à tout compte connecté (`profiles=None`) sont celles du compte lui-même (`/auth/me`, `/auth/password`), le libre-service RH (`/rh/me*`) et les décisions d'absence, chacune avec un contrôle de propriété.
- Aucune lecture croisée : un porteur ne voit pas le dossier d'un autre, un salarié ne voit pas le bulletin d'un autre (contrôles dans `eguitra_rh/controllers/me.py`, `eguitra_portail/controllers/porteur.py`, `eguitra_axispro/controllers/portal.py`, testés).
- Un mot de passe provisoire ne laisse passer que trois routes.
- L'espace RH n'apparaît que si son module est installé.

## Critique

**C1. Un même compte peut approuver seul les deux étapes d'un circuit d'approbation.** `addons/eguitra_approval/models/approval.py:149-157` (`_can_decide`) n'écarte que le demandeur. Le profil admin porte aussi finance et direction : il approuve l'étape finance puis l'étape direction d'une pièce de 100 M GNF, sans second regard. Correction : refuser une étape à un compte qui a déjà tranché une étape de la même demande.

**C2. Le profil RH peut se payer lui-même sans blocage.** Il modifie son propre dossier et ses éléments fixes (`eguitra_rh/controllers/rh.py:312-342`, éléments fixes absents de l'historique du salaire), ses éléments variables (`paie.py:126-145`), se crée une avance (`rh.py:666-680`) ou un salarié fictif (`rh.py:323-331`), puis prépare et valide la paie seul (`paie.py:73-120`). La piste d'audit enregistre tout mais ne bloque rien. Correction : interdire à la RH de toucher à son propre dossier, ses bulletins et ses avances ; faire valider la paie par la direction ou par un autre compte que celui qui l'a préparée. **Décision du gérant attendue : qui valide la paie.**

## Important

**I1. La RH peut approuver sa propre absence.** `POST /rh/leaves` avec `approve` et `force` (`rh.py:601-613`) appelle `approve()` sans le contrôle `can_decide`. Correction d'une ligne.

**I2. AxisPro : un seul consultant peut évaluer, forcer un gate, rendre et verrouiller la décision du comité, puis la rouvrir** (`eguitra_axispro/controllers/axispro.py`, profil cabinet seul). L'affectation des compartiments n'est qu'informative. Correction : réserver l'évaluation d'un compartiment à son titulaire, et faire verrouiller le comité par un autre compte que l'auteur de l'évaluation. **Décision du gérant attendue : confidentialité et séparation entre consultants.**

**I3. L'ouverture du portail rattache un porteur existant à n'importe quel dossier** sur son seul identifiant (`axispro.py:364-382`). Une erreur de saisie lui ouvre le dossier d'un autre promoteur. Correction : refuser si le compte suit déjà les dossiers d'un autre promoteur, ou demander confirmation.

**I4. L'accueil de Finance tombe en erreur pour les profils exploitation, chantiers et immobilier.** Ils ouvrent Finance, mais `accueilFinance` (`apps/web/lib/nav.ts:211-214`) les envoie au tableau de bord, réservé à la finance et à la direction. Correction : les envoyer vers leur premier écran, et utiliser `accueilFinance` dans le sélecteur d'applications.

**I5. Des boutons sont montrés à des profils que l'API refuse :**
- Transport : « Facturer la sélection » à l'exploitation et à la direction ; « Valider » et « Nouvelle rotation » à la direction (`components/transport/Rotations.tsx`).
- BTP : « Facturer » et « Libérer les retenues » au profil chantiers (`app/finance/chantiers/page.tsx`).
- AxisPro : les commandes d'écriture (nouveau dossier, temps, messages, facture, comités, data room, risques, financements, modèle financier) à l'admin et à la direction, qui n'ont que la lecture.

Correction : masquer ces commandes selon le profil.

**I6. Facturation des honoraires AxisPro par l'admin :** la route l'accepte mais le modèle le refuse (`axispro.py:672`, droits de `timesheet`). Correction : retirer l'admin de la route ou lui donner le droit, avec un test.

**I7. Aucun compte de test pour le profil Achats.**

## À améliorer

1. La direction et l'admin approuvent leurs propres absences (choix écrit dans `eguitra_rh/controllers/common.py:122-123`).
2. La paie est validée par le compte qui l'a préparée (`eguitra_rh/models/payroll.py:77-88`).
3. L'exploitation saisit et valide seule ses rotations ; la facturation par la finance atténue.
4. Trois routes ouvertes à tout compte connecté le sont aussi au porteur (types d'absence, jours fériés) : exiger un compte interne.
5. L'exploitation peut supprimer des tarifs et taxes de rotation au niveau du modèle, alors que l'API le réserve à la finance ; le modèle des tarifs n'a pas de règle de société.
6. Des modèles RH enfants (lignes de bulletin, éléments fixes et variables) n'ont pas de règle de société propre.
7. Le profil cabinet a accès à des routes d'engagements et d'approbations sans écran ni rôle d'approbateur.
8. La messagerie de l'ancien portail ne vérifie pas que le dossier est clos.
9. Le porteur voit le nom des critères de ses cinq premiers écarts, alors que la règle dit « jamais les critères de la grille » : à confirmer avec le cabinet.
10. Tout le cabinet voit tous les dossiers : à trancher si la confidentialité entre consultants est attendue.

## Tests de refus manquants

| Module | Ce qui manque |
|---|---|
| RH | Direction en écriture ; auto-approbation par la RH et par la direction ; chef d'équipe sur une autre équipe ; porteur sur `/rh/me` ; aucun test de refus sur la paie |
| Approbations | Même compte sur deux étapes |
| AxisPro | Rattachement d'un porteur existant ; consultant hors de son compartiment ; facture par l'admin |
| Portail | Direction sur les routes d'écriture du cabinet |
| Transport | Direction en écriture |
| BTP, immobilier | Aucun test de refus |
| Web | Aucune vérification de cohérence entre menus et API |

## Comptes

**Production (9 comptes) :**
- aucun compte n'a le profil RH alors que le module est installé ;
- deux comptes d'administration pour le gérant, dont un jamais utilisé (`m.kouyate`) ;
- `salihou.drammeh` a les profils exploitation et cabinet, à confirmer ;
- le directeur général lit la paie et les salaires (profil direction) ;
- 7 comptes sur 9 ont encore leur mot de passe provisoire ; la double authentification est coupée.

**Recette :** comptes de test présents pour tous les profils sauf Achats. À ajouter pour tester l'étanchéité :
- un second porteur créé par script ;
- un second consultant ;
- un chef d'équipe au cabinet ;
- un compte RH ouvert à une seule société.

## Tableau des rôles

| Profil | Applications | Lecture | Écriture | Validation |
|---|---|---|---|---|
| admin (porte aussi direction et finance) | Toutes | Tout | Finance, Transport, RH, administration | Toutes les étapes (C1), paie, absences, y compris les siennes |
| direction | Finance, Transport, AxisPro, Analyse, RH | Tout le périmètre, salaires compris | Presque rien | Étape direction, absences, y compris les siennes |
| finance | Finance, Transport, Analyse | Finance, Transport, Analyse | Finance, paramètres et facturation Transport et BTP | Étape finance, comptabilisation de la paie |
| achats | Finance | Ses pièces d'achat, fournisseurs, engagements | Pièces d'achat, fournisseurs, engagements | Aucune |
| exploitation | Finance, Transport, Rotations | Transport sans comptabilité | Rotations, flotte, chauffeurs, routes | Ses rotations |
| chantiers | Finance (BTP) | BTP | Chantiers, situations | Aucune |
| immobilier | Finance (Immobilier) | Immobilier | Biens, baux, loyers | Aucune |
| cabinet | AxisPro, Analyse cabinet | Tous les dossiers | Dossiers, évaluations, data room, portail, temps, factures | Gates, comités, révisions, seul (I2) |
| rh | RH | Personnel et paie des deux sociétés | Dossiers, absences, avances, paie | Absences des autres, paie, seul (C2) |
| salarié (sans profil, lié à un dossier) | RH, Mon espace | Son dossier, son solde, ses bulletins | Ses demandes d'absence | Aucune |
| chef d'équipe | RH, Mon espace | + absences de son équipe | — | Absences de son équipe |
| porteur | Portail | Ses dossiers | Dépôts, messages, rendez-vous, avis | Aucune |

## Ordre de correction proposé

1. C1, puis I1 (une ligne).
2. C2 et I2, après décision du gérant.
3. I4 et I5 (cohérence des écrans), puis I3 et I6.
4. Les tests de refus pour la direction et l'admin.
5. Le compte `test.achats`.
