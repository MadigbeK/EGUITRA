# Audit des rôles utilisateurs, 22 octobre 2026

Demandé par le gérant après la création des comptes de test RH. Audit en lecture seule du code de la branche `claude/bold-shannon-gpg2hv` (458 routes de l'API, règles d'accès, menus du web, tests, comptes de test) et des comptes réels de la production et de la recette. Les constats critiques et importants ont été vérifiés dans le code.

Rappel : une route `profiles=None` est ouverte à tout compte connecté, porteur compris (`eguitra_api/controllers/framework.py`). Le profil admin implique direction et finance.

## Ce qui est sain

- Un porteur ne voit que ses dossiers (contrôle `_own` du portail et règles AxisPro), testé.
- Un salarié ne voit jamais le bulletin d'un autre ni un bulletin de paie non validée, testé.
- Les 11 routes ouvertes à tout compte connecté (`/auth/me`, `/auth/password`, libre-service RH) contrôlent bien la propriété.

## Critique

**C1. Un même compte peut approuver toutes les étapes d'un circuit.** `eguitra_approval/models/approval.py`, `_can_decide` refuse le demandeur mais ne regarde pas qui a décidé les étapes précédentes. Une pièce d'achat de 100 M GNF (circuit finance puis direction) peut être approuvée deux fois par un administrateur, ou par tout compte qui a les profils finance et direction. Correction : refuser un compte qui a déjà décidé une étape de la même demande ; test à ajouter.

**C2. La paie se fait de bout en bout par un seul compte RH, y compris sur son propre dossier.** `eguitra_rh/controllers/rh.py` (`update_employee` sans garde sur son propre dossier : salaire, éléments fixes, compte bancaire, mobile money) et `controllers/paie.py` (préparer, calculer, valider, rouvrir, comptabiliser : mêmes profils admin et rh). Un compte RH peut changer son salaire ou le numéro mobile money d'un chauffeur, puis valider et comptabiliser seul. Correction : interdire d'écrire sur son propre dossier ; faire valider la paie (ou au moins les changements de salaire et de coordonnées de paiement) par la direction. **Décision du gérant.**

## Important

**I1. La RH approuve sa propre absence à la création.** `rh.py`, `POST /rh/leaves` avec `approve` et `force` n'appelle pas `can_decide`, alors que la route d'approbation l'interdit. Correction : n'approuver à la création que si le compte peut décider.

**I2. AxisPro : un seul consultant évalue, force le gate, scelle la décision du comité et rouvre le dossier.** `eguitra_axispro/controllers/axispro.py` : l'écriture est réservée au profil cabinet sans autre distinction ; l'affectation des compartiments n'est qu'informative. Correction : réserver le verrouillage du comité, le passage forcé et la nouvelle révision à un rôle distinct (associé ou direction) ; refuser l'écriture hors de ses compartiments si l'affectation doit compter. **Décision du gérant.**

**I3. Un porteur existant peut être rattaché à n'importe quel dossier.** `axispro.py`, rattachement par identifiant sans contrôle de l'entreprise. Correction : exiger le même porteur (`promoter_id`) ou une confirmation, et journaliser.

**I4. Engagements de dépense : tout métier voit et annule ceux des autres.** `eguitra_approval/controllers/commitments.py` et `models/commitment.py`. Un conducteur de travaux peut annuler un engagement approuvé de l'exploitation. Correction : visibilité comme les approbations ; soumission et annulation au demandeur, à la finance et à la direction.

**I5. L'accueil de Finance s'ouvre en erreur pour exploitation, chantiers et immobilier.** `apps/web/lib/nav.ts`, `accueilFinance` ne renvoie ailleurs que le profil Achats ; le tableau de bord est réservé à admin, direction et finance. Correction : renvoyer ces profils vers leur écran (engagements, BTP, immobilier).

**I6. Des boutons d'écriture sont montrés à des profils que l'API refuse.** AxisPro : « Nouveau dossier », temps, comités, data room, risques, financements, modèle financier, montrés à admin et direction (écriture réservée au cabinet) ; « Créer la facture » montré à la direction. Transport : « Valider », « Facturer », « Nouvelle rotation » et « Ajouter » (flotte) montrés à la direction ; « Facturer » montré à l'exploitation. Correction : `useCabinet` existe déjà côté AxisPro ; exposer `can_write` et `can_invoice` côté transport.

**I7. Des référentiels RH communs aux deux sociétés sont modifiables par un compte RH ouvert à une seule.** Jours fériés, rubriques de paie, types d'absence (`rh.py`). Correction : même garde que pour les départements communs (compte ouvert à toutes les sociétés).

## À améliorer

- **A1.** Direction et admin approuvent leur propre absence ; le réserver à un autre compte de direction.
- **A2.** Transport : le même compte saisit, valide, modifie après validation et remet en brouillon ses rotations, qui alimentent les manquants imputés aux chauffeurs. Réserver la validation à un autre compte. **Décision du gérant.**
- **A3.** Routes ouvertes à des profils qui ne peuvent jamais s'en servir : approbation et refus ouverts aux métiers (aucune étape ne leur revient) ; onglet « Circuits » en erreur pour les métiers ; API des engagements ouverte au cabinet sans écran.
- **A4.** Le formulaire d'engagement des métiers appelle la liste des comptes comptables, refusée (erreur silencieuse) ; les métiers peuvent envoyer n'importe quel compte (seul le profil Achats est contrôlé). Passer tous les métiers par les catégories de dépense.
- **A5.** Les fiches tiers des salariés (téléphone, e-mail) apparaissent dans la liste des partenaires pour les profils métiers. Les exclure.
- **A6.** Modèles sans règle de société (tarifs du transport ; rubriques, types d'absence, barème RH) et droits d'accès plus larges que l'API (exploitation sur tarifs et taxes). Aligner.
- **A7.** Un comptable règle seul les décaissements sous 100 M GNF. Seuil à confirmer en atelier.

## Tests de refus

Aucun test transversal « profil × route ». Proposition : un test qui appelle chaque route avec chaque profil non autorisé et attend un refus. Trous principaux : RH (direction en écriture, auto-approbation, porteur sur `/rh`), transport (direction en écriture, rh, achats et cabinet refusés), AxisPro (admin en écriture, compartiment d'un autre consultant, rattachement d'un porteur), approbations (même compte sur deux étapes), chantiers et immobilier (aucun test de refus).

## Comptes de test de la recette

Présents : test.dg, test.daf, test.comptable, test.exploitation (aussi chef d'équipe), test.parc (aussi chauffeur), test.chantiers, test.immobilier, test.consultant (salarié du cabinet), test.rh, test.salarie (sans profil, Mon espace seul), test.admin, test.porteur, porteur.demo.

Manquants : un compte Achats ; un second consultant (compartiments) ; un compte RH lié à un dossier (auto-approbation) ; un chef d'équipe côté cabinet ; des comptes RH et finance ouverts à une seule société (tous les comptes ont aujourd'hui les deux, le cloisonnement n'est pas testable).

## Comptes réels de la production

| Compte | Profils | Applications | Sociétés | État |
|---|---|---|---|---|
| emkouyate | tous sauf rh (admin compris) | toutes | les deux | double authentification activée |
| m.kouyate | admin, direction, finance | toutes | les deux | mot de passe provisoire, jamais utilisé |
| mohamed.nimaga@eguitragroup.com | direction | finance, axispro, transport, analyse, rh | les deux | mot de passe provisoire |
| souleymane.kalissa@eguitragroup.com | finance | finance, transport, analyse | les deux | mot de passe provisoire |
| mamadou.bah@eguitragroup.com | exploitation | finance, rotations, transport | groupe | mot de passe provisoire |
| salihou.drammeh@eguitragroup.com | exploitation, cabinet | finance, rotations, transport, axispro, analyse | les deux | mot de passe définitif |
| tenin.traore@eguitragroup.com | achats | finance | groupe | mot de passe provisoire |
| bintou.nimaga@eguitragroup.com | cabinet | axispro, analyse | cabinet | mot de passe provisoire |
| abdoulaye.alsenydiallo@mbaxisproconsulting.com | cabinet | axispro, analyse | cabinet | mot de passe provisoire |

Questions au gérant : qui tient le profil RH chez le client (personne ne l'a) ; archiver m.kouyate (second compte d'administration) ; le double profil exploitation et cabinet de salihou.drammeh est-il voulu ; la direction doit-elle lire la paie et les salaires (lecture seule aujourd'hui). La double authentification est suspendue en production et 7 comptes sur 9 ont encore leur mot de passe provisoire.

## Profil × application × droits

L = lecture, E = écriture, V = validation.

| Profil | Finance | Transport | Rotations | AxisPro | Portail | Analyse | RH |
|---|---|---|---|---|---|---|---|
| admin | L E V | L E V | E | L, facture | écrans cabinet en L | les deux sociétés | L E V |
| direction | L, V (étape direction), E engagements | L | – | L | écrans cabinet en L | les deux sociétés | L, V absences |
| finance | L E V (étape finance) | L E, paramètres, facturation | – | – | – | groupe, activité du cabinet | – |
| achats | E pièces d'achat, fournisseurs, engagements | – | – | – | – | – | – |
| exploitation | E engagements | L E, validation | E | – | – | – | – |
| chantiers | BTP L E, E engagements | – | – | – | – | – | – |
| immobilier | Immobilier L E, E engagements | – | – | – | – | – | – |
| cabinet | (API engagements sans écran) | – | – | L E V | écrans cabinet L E | cabinet | – |
| rh | – | – | – | – | – | – | L E V |
| porteur | – | – | – | – | L de ses dossiers, E échanges et pièces | – | – |
| salarié lié | – | – | – | – | – | – | Mon espace |
| chef d'équipe | – | – | – | – | – | – | Mon espace, V des absences de son équipe |
