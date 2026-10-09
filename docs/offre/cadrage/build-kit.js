// Génère docs/offre/cadrage/Kit_reunion_de_cadrage_EGUITRA.docx et .md
// Guide de préparation, fiches d'atelier, listes de décisions et modèle de compte rendu.
// Usage : node docs/offre/cadrage/build-kit.js
const path = require('path');
const { HYP } = require('../contenu-v2');
const { blocs, ecrire, trouverLogo } = require('../rendu');

const logoPath = trouverLogo(path.join(__dirname, '..'), HYP.logoFichiers);
const { B, h1, h2, p, ul, table, callout, pagebreak, cover, toc } = blocs();

cover();
pagebreak();
toc();
pagebreak();

// ================================================================ 1
h1('1. Ce qu\'est une réunion de cadrage');
p('La réunion de cadrage est la première réunion de travail d\'un projet après sa signature. Elle ne sert ni à vendre ni à négocier : le contrat est acquis. Elle sert à transformer une offre, qui décrit un résultat, en un plan de travail que les deux parties exécutent dès le lendemain. On en sort avec trois choses : des décisions, des noms et des dates.');
p('Concrètement, à la fin des deux heures, vous devez pouvoir répondre à ces questions sans hésiter :');
ul([
  'Quelles règles de gestion précises vont dans chaque module, et lesquelles attendent la version suivante.',
  'Qui, chez le client, répond à vos questions chaque jour, domaine par domaine, et à quelle heure.',
  'Quels fichiers, listes et accès vous recevez, de qui, et avant quelle date.',
  'Quand le dossier de conception est signé, ce qui clôt la semaine 1.',
]);
callout('Le livrable de la réunion est le compte rendu envoyé sous 24 heures, puis le dossier de conception signé le vendredi 16 octobre. La réunion dure deux heures ; les ateliers métiers transport, BTP et immobilier se tiennent dans la semaine, trente minutes chacun, avec le seul référent concerné. Tout ce qui n\'est pas écrit dans l\'un ou l\'autre n\'existe pas.');
h2('1.1 Ce qu\'elle n\'est pas');
ul([
  'Ce n\'est pas une démonstration commerciale. Si vous montrez quelque chose, c\'est pour faire réagir sur des règles de gestion, pas pour convaincre.',
  'Ce n\'est pas un atelier de conception d\'écrans. Les écrans se valident en semaine 2 sur l\'environnement de recette.',
  'Ce n\'est pas une renégociation. Toute remarque sur le prix ou le délai renvoie au document signé.',
  'Ce n\'est pas une réunion d\'information. Chaque sujet se termine par une décision, un nom ou une date.',
]);
h2('1.2 Qui doit être présent');
table(
  ['Côté client', 'Pourquoi'],
  [
    ['Le Directeur Général, au moins à l\'ouverture et aux décisions', 'Il arbitre le périmètre et nomme les référents. Sans lui, les décisions sont provisoires.'],
    ['Le responsable financier', 'Il porte l\'atelier Finance, le plan de comptes, les états et les circuits d\'approbation.'],
    ['Le DGA auteur des prototypes', 'Il connaît les règles de gestion mieux que quiconque. Le valoriser : ses prototypes sont la spécification.'],
    ['Les référents transport, chantiers et immobilier', 'Présents à l\'ouverture si possible, pour être nommés et fixer leur atelier de trente minutes dans la semaine. Leur présence sur les deux heures n\'est pas nécessaire.'],
    ['Un référent du cabinet MB AxisPro', 'Grille, gates, data room, portail, dossiers en cours.'],
  ],
  [3600, 6038],
);
p('Côté E-VOLUTION XP : vous animez. Un collègue prend les notes et tient la liste des décisions en temps réel. Si vous êtes seul, enregistrez la réunion avec l\'accord des participants et prenez vos notes dans la fiche de décisions, pas dans un carnet.');

pagebreak();

// ================================================================ 2
h1('2. Avant la réunion');
h2('2.1 La semaine précédente');
table(
  ['Action', 'Pourquoi'],
  [
    ['Obtenir le bon de commande signé et la facture d\'acompte de 50 % émise', 'La date de commande fait courir les quatre semaines et les pénalités. Sans commande, pas de cadrage : c\'est une réunion de vente qui ne dit pas son nom.'],
    ['Envoyer l\'ordre du jour d\'une page et la liste des participants attendus, nommément', 'Le client prépare ses personnes et ses documents. Vous saurez avant la réunion qui manque.'],
    ['Envoyer la liste des éléments à remettre, en demandant d\'en apporter le maximum le jour même', 'Chaque document reçu en séance est un jour gagné sur la reprise des données.'],
    ['Relire les deux prototypes de la direction et noter vos questions', 'Vous devez connaître leurs règles mieux que le client ne s\'en souvient. C\'est ce qui installe votre crédibilité.'],
    ['Préparer la démonstration de cinq minutes sur votre socle SOGUIPREM', 'Montrer un tableau de bord et une saisie guidée rend concret ce que « noyau invisible » veut dire. Pas plus de cinq minutes : le format de deux heures ne laisse pas de place à davantage.'],
    ['Commander le serveur VPS et réserver le nom de domaine de secours', 'Le jalon de la semaine 1 est « serveur en ligne ». Ne pas attendre la réunion pour le lancer.'],
    ['Imprimer les fiches d\'atelier du chapitre 4, une par domaine, et la fiche de décisions', 'Vous remplissez à la main pendant la réunion. Ce qui est écrit devant le client est validé par le client.'],
  ],
  [4200, 5438],
);
h2('2.2 La veille');
ul([
  'Confirmer l\'heure, la salle et la présence du Directeur Général à l\'ouverture.',
  'Tester le projecteur ou l\'écran, prévoir l\'adaptateur et une version PDF de la présentation sur clé.',
  'Préparer deux exemplaires papier de l\'offre signée et de l\'annexe par poste, au cas où.',
  'Relire ce kit et la présentation une dernière fois, à voix haute si possible.',
]);

pagebreak();

// ================================================================ 3
h1('3. Pendant la réunion : déroulé et animation');
h2('3.1 Déroulé des deux heures');
table(
  ['Heure', 'Séquence', 'Ce que vous faites', 'Ce que vous obtenez'],
  [
    ['10 h 00', 'Ouverture, 10 min', 'Vous remerciez, vous présentez l\'équipe, vous posez les trois objectifs et la règle : chaque sujet finit par une décision ou une date.', 'L\'accord de tous sur la méthode.'],
    ['10 h 10', 'Plateforme, planning, organisation, 20 min', 'Diapositives 4 à 7, démonstration de cinq minutes. Vous faites nommer les référents et fixer l\'heure du point quotidien.', 'Cinq noms, une heure, un jour de comité.'],
    ['10 h 30', 'Finance, 35 min', 'Fiche Finance, en allant droit aux onze questions. Le responsable financier parle, vous questionnez, le collègue note. Vous demandez les documents en séance.', 'Plan de comptes et modèles d\'états en main ou datés.'],
    ['11 h 05', 'AxisPro Suite, 15 min', 'Fiche AxisPro avec le référent du cabinet et le DGA, sur la grille, les gates, la data room et le portail.', 'La grille de référence et les dossiers en cours.'],
    ['11 h 20', 'Technique et charte, 15 min', 'Fiche Technique. Nom de domaine, logos, utilisateurs, relevés bancaires, expert-comptable.', 'Les accès et la charte, ou leur date.'],
    ['11 h 35', 'Décisions et prochaines étapes, 20 min', 'Vous lisez les huit décisions et la liste des éléments à voix haute, un par un, et vous obtenez un oui ou une date pour chacun. Vous fixez les créneaux des trois ateliers métiers.', 'La fiche de décisions remplie et validée.'],
    ['11 h 55', 'Clôture, 5 min', 'Vous annoncez le compte rendu sous 24 heures et la signature du dossier de conception vendredi.', 'Une sortie nette, à l\'heure.'],
  ],
  [1000, 2200, 3838, 2600],
);
h2('3.2 Les ateliers métiers de la semaine');
p('Transport, BTP et immobilier se traitent en trois ateliers de trente minutes, mercredi 14 ou jeudi 15 octobre, chacun avec le seul référent concerné, sur place ou à distance. Vous utilisez les fiches 4.2 à 4.4. Vous repartez avec les listes flotte, chantiers et biens, ou leur date de remise. Les créneaux sont fixés en séance le mardi, dans la séquence des décisions.');
h2('3.3 Règles d\'animation');
ul([
  'Vous tenez l\'horaire, et en deux heures il est serré. Un sujet qui déborde se termine par une question ouverte inscrite au compte rendu, avec un responsable et une date, ou par un atelier de trente minutes fixé dans la semaine. Jamais par un dépassement.',
  'Vous reformulez chaque décision à voix haute avant de l\'écrire : « Donc nous retenons que… ». Le silence vaut accord, et vous le dites.',
  'Vous ne dites jamais « on verra ». Vous dites « qui, et quand ».',
  'Vous ne prenez pas de nouveau périmètre. Une demande hors offre va dans la liste des demandes, avec la mention « après mise en production, maintenance évolutive ou devis ». Vous le dites calmement, sans vous justifier.',
  'Vous laissez le client parler de son métier. Vous êtes là pour comprendre ses règles, pas pour expliquer les vôtres.',
  'Vous valorisez le DGA : « votre prototype nous a fait gagner deux semaines de spécification ». C\'est vrai, et cela en fait un allié.',
  'Vous ne prononcez pas de vocabulaire technique devant les référents métier. Le mot « noyau » suffit. Le détail technique se traite avec la personne en charge de l\'informatique, en aparté si nécessaire.',
]);

pagebreak();

// ================================================================ 4
h1('4. Fiches d\'atelier');
p('Une fiche par domaine. Les colonnes « Réponse » et « Décision ou date » se remplissent en séance. Une ligne sans décision ni date à la fin de l\'atelier devient une question ouverte du compte rendu.');

const fiche = (titre, lignes) => {
  h2(titre);
  table(['Question', 'Réponse', 'Décision ou date'], lignes.map((q) => [q, '', '']), [4600, 2838, 2200]);
};
fiche('4.1 Finance', [
  'Quel plan de comptes utilisez-vous aujourd\'hui, et qui le tient à jour ? Pouvez-vous nous le remettre maintenant ?',
  'Quelles activités, quels centres de coût, quels chantiers, quels véhicules et quels biens voulez-vous suivre séparément ?',
  'Comment numérotez-vous vos factures et vos pièces ? Un justificatif est-il obligatoire pour chaque dépense ?',
  'Qui valide un engagement ? Qui valide un paiement ? À partir de quel montant un second niveau intervient-il ?',
  'Quels seuils déclenchent une alerte : trésorerie minimale, marge transport, écart budgétaire, délai client, DSCR ?',
  'Qui lance la clôture mensuelle ? Qui peut rouvrir une période, et dans quelles conditions ?',
  'Quels états produisez-vous aujourd\'hui, à quelle fréquence, pour qui ? Pouvez-vous nous remettre les modèles ?',
  'Quelles devises utilisez-vous ? D\'où viennent les taux, et à quelle fréquence sont-ils mis à jour ?',
  'Quelles banques, quels comptes, et quel format de relevé électronique chaque banque fournit-elle ?',
  'Qui est votre expert-comptable ? Peut-il valider le plan de comptes en semaine 2 ?',
  'Combien d\'utilisateurs en finance, avec quels droits : saisie, validation, consultation, administration ?',
]);
fiche('4.2 Transport', [
  'Combien de véhicules, de chauffeurs, de routes ? Pouvez-vous nous remettre les listes avec les tarifs ?',
  'Quels produits transportez-vous, et les taxes diffèrent-elles selon le produit ou la route ?',
  'Quels coûts rattachez-vous à une rotation : carburant, péages, frais chauffeur, maintenance, pneumatiques, autres ?',
  'Qui saisit une rotation aujourd\'hui, où, sur quel support, et avec quelle qualité de réseau ?',
  'À quel moment une rotation devient-elle une ligne de facture ? Par rotation, par lot, par mois ?',
  'Quelle marge minimale par rotation ou par camion doit déclencher une alerte ?',
]);
fiche('4.3 BTP', [
  'Combien de chantiers en cours ? Pouvez-vous nous remettre la liste avec les contrats ?',
  'Facturez-vous par jalons ou par situations mensuelles ? Qui valide l\'avancement ?',
  'Quel taux de retenue de garantie, quelle durée, et comment suivez-vous sa libération ?',
  'Quels coûts suivez-vous par chantier : matériaux, sous-traitance, main-d\'œuvre, matériel ?',
]);
fiche('4.4 Immobilier', [
  'Combien de biens et de baux ? Pouvez-vous nous remettre la liste ?',
  'Quelle périodicité de loyer, quelles charges, quels dépôts de garantie ?',
  'Comment produisez-vous les quittances aujourd\'hui ?',
  'Comment valorisez-vous le patrimoine, et à quelle fréquence ?',
]);
fiche('4.5 AxisPro Suite', [
  'Quelle est la version de référence de la grille des 111 critères ? Qui la maintiendra après la mise en production ?',
  'Pour chaque gate, qui décide du passage et qui verrouille la revue ?',
  'Quels réglages de la politique d\'évaluation sont en vigueur, et qui a le droit de les modifier ?',
  'Quelles pièces de la data room sont obligatoires, dans quels formats, et qui les dépose : le cabinet ou le porteur ?',
  'Quels modèles de rapports utilisez-vous pour le comité et pour le promoteur ? Pouvez-vous nous les remettre ?',
  'Que doit voir un porteur de projet sur le portail, et que ne doit-il surtout pas voir ?',
  'Combien de dossiers en cours sont à reprendre, et à quel stade ?',
]);
fiche('4.6 Technique, charte et accès', [
  'Disposez-vous d\'un nom de domaine ? Si oui, qui en a l\'accès technique ? Sinon, nous en fournissons un.',
  'Avez-vous une charte graphique ? Pouvez-vous nous remettre les logos en haute définition, les couleurs et les polices ?',
  'Quelle est la liste complète des utilisateurs, avec leur profil et leur adresse e-mail ?',
  'Quelle est la qualité du réseau au siège, au parc et sur les chantiers ?',
  'Qui est votre interlocuteur informatique, s\'il y en a un ?',
]);

pagebreak();

// ================================================================ 5
h1('5. Fiche de décisions et éléments à remettre');
h2('5.1 Les huit décisions');
table(
  ['Décision', 'Résultat', 'Responsable', 'Date'],
  [
    ['Les cinq référents sont nommés, avec leurs créneaux', '', '', ''],
    ['L\'heure du point quotidien et le jour du comité hebdomadaire sont fixés', '', '', ''],
    ['Le nom de domaine est choisi', '', '', ''],
    ['La charte graphique est validée ou l\'atelier charte est daté', '', '', ''],
    ['Le plan de comptes de référence et les modèles d\'états sont identifiés', '', '', ''],
    ['La liste des utilisateurs et de leurs profils est arrêtée', '', '', ''],
    ['Les listes flotte, chantiers, biens et la grille AxisPro ont un propriétaire', '', '', ''],
    ['La validation du plan de comptes par l\'expert-comptable est datée en semaine 2', '', '', ''],
  ],
  [4438, 2000, 1800, 1400],
);
h2('5.2 Les éléments à remettre avant le vendredi 16 octobre');
table(
  ['Élément', 'Responsable', 'Date promise', 'Reçu le'],
  [
    ['Plan de comptes actuel et modèles d\'états financiers', 'Responsable financier', '', ''],
    ['Fichiers de gestion de l\'exercice en cours', 'Responsable financier', '', ''],
    ['Relevés bancaires électroniques, un par banque', 'Responsable financier', '', ''],
    ['Modèles de déclarations fiscales en vigueur', 'Responsable financier', '', ''],
    ['Listes flotte, chauffeurs, routes et tarifs', 'Référent transport', '', ''],
    ['Liste des chantiers et contrats en cours', 'Référent chantiers', '', ''],
    ['Liste des biens et des baux', 'Référent immobilier', '', ''],
    ['Grille AxisPro de référence et dossiers en cours', 'Référent cabinet', '', ''],
    ['Logos, charte, liste des utilisateurs et profils', 'Direction générale', '', ''],
    ['Coordonnées de l\'expert-comptable', 'Responsable financier', '', ''],
  ],
  [4438, 2200, 1500, 1500],
);

pagebreak();

// ================================================================ 6
h1('6. Après la réunion');
h2('6.1 Sous 24 heures : le compte rendu');
p('Le compte rendu est court et n\'a qu\'un but : que personne ne puisse dire plus tard « ce n\'est pas ce que nous avions décidé ». Il reprend les décisions, les responsables, les dates et les questions ouvertes. Il part le lendemain matin au plus tard, à tous les participants, avec le Directeur Général en copie.');
h2('6.2 Modèle de compte rendu');
callout('Objet : Compte rendu de la réunion de cadrage du 13 octobre 2026');
p('Participants : [noms et fonctions].');
p('Décisions :');
ul(['[Décision 1, responsable, date]', '[Décision 2, responsable, date]', '[...]']);
p('Éléments à remettre avant le vendredi 16 octobre :');
ul(['[Élément, responsable, date promise]', '[...]']);
p('Questions ouvertes :');
ul(['[Question, responsable, date de réponse]', '[...]']);
p('Demandes hors périmètre notées pour la suite :');
ul(['[Demande, traitement prévu : maintenance évolutive ou devis]']);
p('Prochaines étapes : serveur en ligne le [date], dossier de conception transmis le [date], signature le vendredi 16 octobre, point quotidien à [heure], comité hebdomadaire le [jour].');
p('Sans retour de votre part sous 48 heures, ce compte rendu est réputé validé.');
h2('6.3 Avant vendredi : le dossier de conception');
p('Le dossier de conception est la version structurée du compte rendu et des fiches d\'atelier. Il tient en une dizaine de pages et devient l\'annexe de référence du contrat. Il contient :');
ul([
  'Le périmètre arrêté, module par module, avec les règles de gestion retenues.',
  'Les référentiels : plan de comptes, axes analytiques, journaux, devises, utilisateurs et profils.',
  'Les circuits d\'approbation et les seuils d\'alerte.',
  'La charte graphique et le nom de domaine.',
  'Le planning des semaines 2 à 4 avec les dates de recette.',
  'La liste des demandes hors périmètre et leur traitement.',
  'La signature des deux parties.',
]);
h2('6.4 Les relances');
p('Chaque élément promis et non reçu à sa date fait l\'objet d\'une relance écrite le jour même, courte et factuelle, avec rappel de son effet sur le planning. C\'est ce qui, le cas échéant, établit qu\'un retard n\'est pas imputable à E-VOLUTION XP.');

pagebreak();

// ================================================================ 7
h1('7. Les pièges et comment les gérer');
table(
  ['Situation', 'Ce qu\'il faut faire'],
  [
    ['Un participant demande une fonction qui n\'est pas dans l\'offre', 'Vous la notez dans la liste des demandes, vous dites qu\'elle sera traitée après la mise en production, et vous passez au point suivant. Pas de débat.'],
    ['Le Directeur Général n\'est pas là', 'Vous tenez la réunion, mais vous marquez chaque décision « à confirmer par la direction » et vous obtenez un créneau de quinze minutes avec lui dans la semaine.'],
    ['Personne ne veut être référent, ou le référent n\'est pas disponible', 'Vous rappelez calmement que le délai de quatre semaines et les pénalités reposent sur cette disponibilité, écrite dans l\'offre, et vous faites trancher par la direction.'],
    ['Le prix ou le délai revient dans la discussion', 'Vous renvoyez à l\'offre signée en une phrase et vous reprenez l\'ordre du jour.'],
    ['Le DGA défend son prototype contre une règle que vous proposez', 'Vous retenez sa règle, sauf si elle contredit la comptabilité. Son prototype est la spécification ; vous êtes là pour la mettre en œuvre.'],
    ['Le réseau au parc est mauvais', 'Vous rappelez que l\'application mobile fonctionne hors ligne et synchronise plus tard. Vous notez le besoin pour la recette.'],
    ['Les relevés bancaires ne sont pas disponibles en électronique', 'Vous notez le format disponible et vous traitez l\'import en semaine 3, sans promettre l\'automatique si la banque ne le permet pas.'],
    ['Quelqu\'un demande « c\'est quoi le noyau exactement ? »', 'Vous répondez en une phrase : un moteur de gestion open source éprouvé, que vos utilisateurs ne verront jamais. Vous ne faites pas de cours.'],
    ['La réunion prend du retard', 'Vous coupez le sujet en cours, vous le notez en question ouverte avec un nom et une date, et vous passez à la séquence suivante.'],
    ['On vous demande une date de mise en production précise', 'Le vendredi 6 novembre, si les éléments de la semaine 1 arrivent à l\'heure. Vous le dites avec la condition.'],
  ],
  [3600, 6038],
);

(async () => {
  await ecrire(B, {
    titre: 'Kit de la réunion de cadrage',
    sousTitre: 'EGUITRA Finance et AxisPro Suite, mardi 13 octobre 2026',
    mentionRevision: 'Document interne E-VOLUTION XP, à ne pas transmettre au client.',
    prestataire: HYP.prestataire, slogan: HYP.slogan, contact: HYP.contact,
    client: HYP.client, client2: HYP.client2, dg: HYP.dg,
    reference: HYP.reference, dateOffre: '9 octobre 2026', validiteJours: 0, logoPath,
  }, __dirname, 'Kit_reunion_de_cadrage_EGUITRA');
  console.log('OK : kit');
})();
