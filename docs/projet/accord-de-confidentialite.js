// Génère docs/projet/Accord_de_confidentialite.docx
// Usage : node docs/projet/accord-de-confidentialite.js
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, VerticalAlign, LevelFormat, Header, Footer, PageNumber } = require('docx');

const NAVY = '1C1E6B', TEAL = '1A9E9E', FONT = 'Calibri', W = 9638;
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size || 21, bold: o.bold, color: o.color, italics: o.italics });
const para = (t, o = {}) => new Paragraph({ children: [run(t, o)], spacing: { after: o.after ?? 120, before: o.before ?? 0, line: 276 }, alignment: o.align ?? AlignmentType.JUSTIFIED });
const art = (t) => new Paragraph({ children: [run(t, { size: 24, bold: true, color: NAVY })], spacing: { before: 280, after: 120 }, keepNext: true });
const li = (t) => new Paragraph({ numbering: { reference: 'puces', level: 0 }, children: [run(t)], spacing: { after: 80, line: 276 }, alignment: AlignmentType.JUSTIFIED });
const cb = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8' };
const borders = { top: cb, bottom: cb, left: cb, right: cb };
function table(rows, widths, opts = {}) {
  const mk = (t, i, o = {}) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.TOP,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined, margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: t.split('\n').map((l) => new Paragraph({ children: [run(l, { size: 20, bold: o.bold })], spacing: { after: 60 } })) });
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, ri) => new TableRow({ children: r.map((c, i) => mk(c, i, { bold: opts.boldFirstCol && i === 0, shade: ri === 0 && opts.head ? 'E6F4F4' : undefined })) })) });
}

const PRESTATAIRE = 'E-volution Experience';
const CLIENT1 = 'EGUITRA GROUP SARLU';
const CLIENT2 = 'MB AxisPro Consulting';

const c = [];
c.push(new Paragraph({ children: [run('ACCORD DE CONFIDENTIALITÉ RÉCIPROQUE', { size: 36, bold: true, color: NAVY })], alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 } }));
c.push(new Paragraph({ children: [run('Projet de plateforme de gestion intégrée EGUITRA Finance et AxisPro Suite', { size: 24, color: TEAL, bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }));

c.push(para('Entre les soussignés :', { bold: true }));
c.push(para(`${PRESTATAIRE}, [forme juridique], au capital de [montant] GNF, immatriculée au Registre du commerce et du crédit mobilier de Conakry sous le numéro [RCCM], dont le siège social est situé [adresse], représentée par M. Madigbè KOUYATÉ, Gérant, dûment habilité, exerçant sous le nom commercial E-VOLUTION XP,`));
c.push(para('ci-après désignée « le Prestataire »,', { italics: true }));
c.push(para('d\'une part,', { align: AlignmentType.RIGHT }));
c.push(para('et', { bold: true }));
c.push(para(`${CLIENT1}, société à responsabilité limitée unipersonnelle, immatriculée au Registre du commerce et du crédit mobilier sous le numéro [RCCM], dont le siège social est situé [adresse], et ${CLIENT2}, [forme juridique], immatriculée sous le numéro [RCCM], dont le siège social est situé [adresse], toutes deux représentées par M. Mohamed NIMAGA, Directeur Général, dûment habilité,`));
c.push(para('ci-après désignées ensemble « le Client »,', { italics: true }));
c.push(para('d\'autre part,', { align: AlignmentType.RIGHT }));
c.push(para('le Prestataire et le Client étant ci-après désignés individuellement une « Partie » et ensemble les « Parties ».'));

c.push(art('Préambule'));
c.push(para(`Le Client a retenu le Prestataire, par l'offre technique et financière référencée OTF-EGUITRA-2026-37 du 29 septembre 2026 (ci-après « l'Offre »), pour la conception, la réalisation, l'hébergement et la maintenance d'une plateforme de gestion intégrée comprenant les applications EGUITRA Finance et AxisPro Suite, une application mobile et un portail des porteurs de projets (ci-après « le Projet »).`));
c.push(para('L\'exécution du Projet suppose que chaque Partie communique à l\'autre des informations sensibles : pour le Client, ses données comptables, financières, bancaires et commerciales, les dossiers des porteurs de projets qu\'il accompagne et sa méthode d\'évaluation ; pour le Prestataire, son savoir-faire technique, ses composants logiciels et ses conditions commerciales.'));
c.push(para('Les Parties ont en conséquence convenu de fixer, par le présent accord, les conditions dans lesquelles ces informations sont communiquées, utilisées et protégées. Le présent accord complète l\'engagement de confidentialité figurant à l\'Offre et s\'applique à toute information échangée dans le cadre du Projet, y compris avant sa signature.'));

c.push(art('Article 1. Définitions'));
c.push(para('1.1 « Informations Confidentielles » désigne toute information ou donnée, quels qu\'en soient la nature, le support ou le mode de communication (écrit, oral, électronique, accès à un système), communiquée par une Partie (la « Partie Divulgatrice ») à l\'autre Partie (la « Partie Réceptrice ») dans le cadre du Projet, qu\'elle soit ou non identifiée comme confidentielle. Sont notamment des Informations Confidentielles :'));
c.push(li('pour le Client : les données comptables, financières, fiscales, bancaires et de trésorerie, en particulier le dossier de l\'exercice 2026 et les relevés bancaires ; les contrats, baux, tarifs, listes de clients, de fournisseurs, de chauffeurs et de véhicules ; les budgets, financements et états financiers ; les dossiers des porteurs de projets accompagnés par le cabinet et les pièces de leurs data rooms ; la méthode d\'évaluation AxisPro, sa grille de critères, ses pondérations, ses stage gates et sa politique d\'évaluation ; les éléments de charte graphique non publiés ; les identifiants, mots de passe et accès aux systèmes ;'));
c.push(li('pour le Prestataire : l\'architecture de la plateforme, le code source et la documentation de ses composants génériques, ses méthodes de travail, ses outils, ses conditions tarifaires et le contenu de l\'Offre.'));
c.push(para('1.2 « Projet » a le sens défini au préambule et s\'étend aux prestations d\'hébergement, de support et de maintenance qui lui font suite.'));
c.push(para('1.3 « Personnel Autorisé » désigne les dirigeants, salariés, prestataires et sous-traitants d\'une Partie qui ont strictement besoin d\'accéder aux Informations Confidentielles pour l\'exécution du Projet.'));

c.push(art('Article 2. Objet'));
c.push(para('Le présent accord a pour objet de définir les obligations réciproques des Parties relatives à la protection des Informations Confidentielles échangées à l\'occasion du Projet. Il ne crée aucune obligation de contracter au-delà de l\'Offre, ni aucune exclusivité, ni aucune cession ou licence de droits.'));

c.push(art('Article 3. Exclusions'));
c.push(para('Ne constituent pas des Informations Confidentielles, à charge pour la Partie Réceptrice d\'en apporter la preuve, les informations :'));
c.push(li('qui étaient dans le domaine public au moment de leur communication, ou y sont tombées ultérieurement sans faute de la Partie Réceptrice ;'));
c.push(li('que la Partie Réceptrice détenait légitimement avant leur communication, sans obligation de confidentialité ;'));
c.push(li('qu\'elle a reçues d\'un tiers autorisé à les divulguer sans restriction ;'));
c.push(li('qu\'elle a développées de façon indépendante, sans utiliser les Informations Confidentielles de l\'autre Partie.'));

c.push(art('Article 4. Obligations de la Partie Réceptrice'));
c.push(para('4.1 Non-divulgation. La Partie Réceptrice s\'interdit de divulguer, directement ou indirectement, tout ou partie des Informations Confidentielles à quiconque autre que son Personnel Autorisé, sans l\'accord préalable et écrit de la Partie Divulgatrice.'));
c.push(para('4.2 Usage limité. La Partie Réceptrice n\'utilise les Informations Confidentielles qu\'aux seules fins de l\'exécution du Projet. Toute autre utilisation, notamment à des fins commerciales, concurrentielles ou de comparaison, est interdite.'));
c.push(para('4.3 Personnel Autorisé. La Partie Réceptrice ne communique les Informations Confidentielles à son Personnel Autorisé que dans la mesure nécessaire, après l\'avoir informé de leur caractère confidentiel et lui avoir imposé des obligations au moins équivalentes à celles du présent accord. Elle demeure responsable de tout manquement de son Personnel Autorisé.'));
c.push(para('4.4 Mesures de protection. La Partie Réceptrice protège les Informations Confidentielles avec un soin au moins égal à celui qu\'elle apporte à ses propres informations de même nature, et en tout état de cause avec des mesures raisonnables et conformes à l\'état de l\'art : contrôle des accès par mot de passe et double authentification, chiffrement des échanges et des supports de stockage, journalisation des accès, restriction physique et logique des locaux et des équipements.'));
c.push(para('4.5 Copies. La Partie Réceptrice ne reproduit les Informations Confidentielles que dans la mesure strictement nécessaire au Projet. Toute copie reste soumise au présent accord.'));
c.push(para('4.6 Incident. La Partie Réceptrice informe la Partie Divulgatrice, par écrit et sans délai, au plus tard dans les quarante-huit heures suivant sa découverte, de toute divulgation, perte ou accès non autorisé portant sur des Informations Confidentielles, et coopère pleinement pour en limiter les conséquences.'));

c.push(art('Article 5. Hébergement et sous-traitance'));
c.push(para('5.1 Le Client autorise le Prestataire à stocker et traiter les Informations Confidentielles du Client sur les infrastructures d\'hébergement désignées dans le dossier de conception du Projet, à savoir le serveur dédié de la plateforme et l\'espace de sauvegarde hors site, situés dans l\'Union européenne ou au Royaume-Uni. Les données y sont chiffrées en transit et au repos ; les hébergeurs n\'ont pas accès à leur contenu en clair.'));
c.push(para('5.2 Le Prestataire reste pleinement responsable envers le Client du respect du présent accord par ses hébergeurs et sous-traitants. Tout changement d\'hébergeur ou de pays d\'hébergement est notifié au Client par écrit avant sa mise en œuvre.'));
c.push(para('5.3 Le Prestataire s\'interdit de donner accès aux Informations Confidentielles du Client à tout autre client ou tiers, et de les utiliser pour entraîner, paramétrer ou alimenter un service destiné à des tiers.'));

c.push(art('Article 6. Données à caractère personnel et données de tiers'));
c.push(para('6.1 Les Informations Confidentielles du Client comprennent des données à caractère personnel relatives notamment à ses salariés, chauffeurs, clients, fournisseurs et aux porteurs de projets accompagnés par le cabinet. Le Prestataire ne traite ces données que pour les besoins du Projet, sur instruction du Client, et conformément à la réglementation guinéenne applicable à la protection des données à caractère personnel.'));
c.push(para('6.2 Le Client garantit qu\'il dispose du droit de communiquer ces données au Prestataire pour les finalités du Projet. Le Prestataire assiste le Client, dans la mesure du raisonnable, pour répondre aux demandes d\'exercice de leurs droits par les personnes concernées.'));

c.push(art('Article 7. Propriété'));
c.push(para('7.1 Les Informations Confidentielles demeurent la propriété exclusive de la Partie Divulgatrice. Le présent accord n\'emporte aucune cession ni licence de droits de propriété intellectuelle ou de savoir-faire, au-delà de ce que prévoit l\'Offre.'));
c.push(para('7.2 Conformément à l\'Offre, le Client est propriétaire de ses données et du code développé spécifiquement pour lui ; les composants génériques du Prestataire restent la propriété du Prestataire. Chaque Partie s\'interdit de décompiler, désassembler ou reconstituer les composants de l\'autre Partie en dehors de ce que permet l\'Offre ou la loi.'));

c.push(art('Article 8. Divulgation imposée par la loi'));
c.push(para('Si la Partie Réceptrice est tenue de divulguer des Informations Confidentielles en vertu d\'une loi, d\'une décision de justice ou d\'une demande d\'une autorité compétente, elle en informe préalablement la Partie Divulgatrice, dans la mesure où la loi le permet, afin de lui laisser la possibilité de s\'y opposer ou d\'en limiter la portée, et ne divulgue que la partie strictement exigée.'));

c.push(art('Article 9. Durée'));
c.push(para('9.1 Le présent accord entre en vigueur à la date de sa signature. Il s\'applique également aux Informations Confidentielles échangées entre les Parties depuis le [15 août 2026], date de la première communication de données relative au Projet.'));
c.push(para('9.2 Les obligations de confidentialité demeurent en vigueur pendant toute la durée du Projet, hébergement et maintenance compris, et pendant cinq ans après la fin de la dernière relation contractuelle entre les Parties. Elles subsistent sans limitation de durée pour la méthode d\'évaluation AxisPro, les dossiers des porteurs de projets et tout secret d\'affaires, tant que ces informations n\'ont pas été rendues publiques par la Partie Divulgatrice.'));

c.push(art('Article 10. Restitution et destruction'));
c.push(para('10.1 À la fin du Projet, ou à tout moment sur demande écrite de la Partie Divulgatrice, la Partie Réceptrice restitue ou détruit, dans un délai de trente jours, l\'ensemble des Informations Confidentielles et de leurs copies, et le confirme par écrit.'));
c.push(para('10.2 Par exception, la Partie Réceptrice peut conserver les informations dont la conservation est imposée par la loi, ainsi que les copies contenues dans ses sauvegardes, qui sont effacées selon leur cycle normal de rotation sans excéder douze mois. Ces informations restent soumises au présent accord jusqu\'à leur effacement.'));
c.push(para('10.3 Cette clause s\'articule avec l\'engagement de réversibilité de l\'Offre : la restitution au Client d\'une copie complète de ses données et du code développé pour lui précède toute destruction.'));

c.push(art('Article 11. Responsabilité'));
c.push(para('11.1 Tout manquement au présent accord engage la responsabilité de la Partie défaillante, qui répare l\'intégralité du préjudice direct subi par l\'autre Partie.'));
c.push(para('11.2 Les Parties reconnaissent qu\'une violation du présent accord peut causer un préjudice que des dommages et intérêts ne suffiraient pas à réparer. La Partie Divulgatrice peut en conséquence solliciter de toute juridiction compétente toute mesure d\'urgence visant à faire cesser ou prévenir la divulgation, sans préjudice de toute autre action.'));

c.push(art('Article 12. Dispositions générales'));
c.push(para('12.1 Intégralité. Le présent accord et l\'Offre expriment l\'intégralité des engagements des Parties en matière de confidentialité. En cas de contradiction, la disposition la plus protectrice pour la Partie Divulgatrice prévaut.'));
c.push(para('12.2 Modification. Toute modification du présent accord fait l\'objet d\'un avenant écrit signé des Parties.'));
c.push(para('12.3 Nullité partielle. Si l\'une des stipulations du présent accord est déclarée nulle ou inapplicable, les autres stipulations conservent leur plein effet, et les Parties substituent à la stipulation écartée une stipulation valable d\'effet équivalent.'));
c.push(para('12.4 Non-renonciation. Le fait pour une Partie de ne pas se prévaloir d\'un manquement de l\'autre Partie ne vaut pas renonciation à s\'en prévaloir ultérieurement.'));
c.push(para('12.5 Cession. Aucune Partie ne peut céder ou transférer le présent accord sans l\'accord préalable et écrit de l\'autre Partie.'));
c.push(para('12.6 Notifications. Toute notification au titre du présent accord est faite par écrit, par lettre remise contre décharge ou par courrier électronique avec accusé de réception, aux adresses indiquées en annexe.'));

c.push(art('Article 13. Loi applicable et règlement des litiges'));
c.push(para('13.1 Le présent accord est régi par le droit de la République de Guinée.'));
c.push(para('13.2 Les Parties s\'efforcent de résoudre à l\'amiable tout différend relatif à l\'interprétation ou à l\'exécution du présent accord, dans un délai de trente jours à compter de la notification du différend par la Partie la plus diligente. À défaut d\'accord dans ce délai, le différend est soumis au Tribunal de commerce de Conakry.'));

c.push(para('Fait à Conakry, le [date], en trois exemplaires originaux, un pour chaque signataire.', { before: 300, after: 300 }));
c.push(table([
  [`Pour ${PRESTATAIRE}\n(E-VOLUTION XP)\n\nM. Madigbè KOUYATÉ\nGérant\n\n\nSignature et cachet :\n\n\n« Lu et approuvé »`, `Pour ${CLIENT1}\n\n\nM. Mohamed NIMAGA\nDirecteur Général\n\n\nSignature et cachet :\n\n\n« Lu et approuvé »`, `Pour ${CLIENT2}\n\n\n[Nom du signataire]\n[Qualité]\n\n\nSignature et cachet :\n\n\n« Lu et approuvé »`],
], [3213, 3213, 3212]));

c.push(art('Annexe. Points de contact pour la confidentialité'));
c.push(para('Les notifications prévues aux articles 4.6, 8, 10 et 12.6 sont adressées aux personnes suivantes :'));
c.push(table([
  ['Partie', 'Contact', 'Téléphone et courrier électronique'],
  [PRESTATAIRE, 'M. Madigbè KOUYATÉ, Gérant', '+224 628 86 22 55\nemkouyate@e-volutionxp.com'],
  [CLIENT1, '[Nom, fonction]', '[téléphone]\n[courrier électronique]'],
  [CLIENT2, '[Nom, fonction]', '[téléphone]\n[courrier électronique]'],
], [2800, 3400, 3438], { head: true, boldFirstCol: true }));

const doc = new Document({
  creator: 'E-VOLUTION XP', title: 'Accord de confidentialité réciproque',
  styles: { default: { document: { run: { font: FONT, size: 21 } } } },
  numbering: { config: [{ reference: 'puces', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] }] },
  sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8', space: 4 } }, children: [run(`Accord de confidentialité, ${PRESTATAIRE} / ${CLIENT1} et ${CLIENT2}`, { size: 16, color: '888888' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run('Confidentiel. Paraphes : ______  ______  ______      Page ', { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }) },
    children: c,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(path.join(__dirname, 'Accord_de_confidentialite.docx'), b); console.log('OK'); });
