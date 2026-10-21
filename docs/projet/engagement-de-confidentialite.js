// Génère docs/projet/Engagement_de_confidentialite.docx : engagement court du prestataire, signé avant la
// remise des données réelles du client (complète l'accord de confidentialité réciproque).
// Usage : node docs/projet/engagement-de-confidentialite.js
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, VerticalAlign, LevelFormat, Header, Footer, PageNumber } = require('docx');

const NAVY = '1C1E6B', TEAL = '1A9E9E', GREY = '888888', FONT = 'Calibri', W = 9638;
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size || 21, bold: o.bold, color: o.color, italics: o.italics });
const para = (t, o = {}) => new Paragraph({ children: [run(t, o)], spacing: { after: o.after ?? 120, before: o.before ?? 0, line: 276 }, alignment: o.align ?? AlignmentType.JUSTIFIED });
const art = (t) => new Paragraph({ children: [run(t, { size: 23, bold: true, color: NAVY })], spacing: { before: 220, after: 100 }, keepNext: true });
const li = (t) => new Paragraph({ numbering: { reference: 'puces', level: 0 }, children: [run(t)], spacing: { after: 60, line: 264 }, alignment: AlignmentType.JUSTIFIED });
const liRich = (parts) => new Paragraph({ numbering: { reference: 'puces', level: 0 }, children: parts.map(([t, s]) => run(t, s)), spacing: { after: 60, line: 264 }, alignment: AlignmentType.JUSTIFIED });

const PRESTATAIRE = 'E-volution Experience';
const CLIENT1 = 'EGUITRA GROUP SARLU';
const CLIENT2 = 'MB AxisPro';

const c = [];
c.push(new Paragraph({ children: [run('ENGAGEMENT DE CONFIDENTIALITÉ', { size: 34, bold: true, color: NAVY })], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 } }));
c.push(new Paragraph({ children: [run('Données d\'entreprise remises pour la plateforme EGUITRA Finance et AxisPro Suite', { size: 22, color: TEAL, bold: true })], alignment: AlignmentType.CENTER, spacing: { after: 320 } }));

c.push(para(`Je soussigné, Madigbè KOUYATÉ, Gérant de ${PRESTATAIRE} (E-VOLUTION XP), prestataire de la plateforme de gestion intégrée EGUITRA Finance et AxisPro Suite (offre OTF-EGUITRA-2026-37 du 29 septembre 2026), m'engage, au nom de ma société et de toute personne qui travaille sous ma responsabilité, à respecter les règles ci-dessous pour toutes les données que ${CLIENT1} et ${CLIENT2} (ensemble « le Client ») me remettent ou me rendent accessibles.`));
c.push(para('Cet engagement complète l\'accord de confidentialité réciproque conclu entre les parties. En cas de différence entre les deux textes, la règle la plus protectrice pour le Client s\'applique.'));

c.push(art('1. Les données concernées'));
c.push(para('Toutes les données du Client, quel que soit leur support (fichier, papier, accès à un logiciel, échange oral), notamment :', { after: 80 }));
c.push(li('la comptabilité, les finances, la banque, la trésorerie, les budgets et les emprunts ;'));
c.push(li('le transport : rotations, véhicules, chauffeurs, routes, tarifs et exports du logiciel actuel ;'));
c.push(li('les contrats, les clients, les fournisseurs, les baux et les tarifs ;'));
c.push(li('les données personnelles des salariés, des chauffeurs, des clients et des porteurs de projets ;'));
c.push(li('les dossiers des porteurs de projets et la méthode d\'évaluation AxisPro ;'));
c.push(li('les identifiants, les mots de passe et les accès aux systèmes.'));

c.push(art('2. Un seul usage : le projet'));
c.push(para('Les données servent uniquement à reprendre l\'historique dans la plateforme, à la paramétrer, à la tester et à assurer le support. Elles ne sont jamais vendues, communiquées à un tiers, réutilisées pour un autre client, publiées, ni utilisées à des fins personnelles ou commerciales.'));

c.push(art('3. Un accès limité et tracé'));
c.push(para('Seules les personnes qui en ont besoin pour le projet accèdent aux données : moi-même et, si nécessaire, des collaborateurs nommément désignés, qui signent un engagement identique avant tout accès. Leur liste est communiquée au Client sur simple demande.'));
c.push(para('Dans la plateforme, chaque compte est nominatif, protégé par un mot de passe personnel et une double authentification. Chaque création, modification ou suppression y est enregistrée dans une piste d\'audit.'));

c.push(art('4. Où les données sont conservées'));
c.push(liRich([['Dans la plateforme : ', { bold: true }], ['sur le serveur dédié au projet, situé dans l\'Union européenne, accessible uniquement par connexion chiffrée (HTTPS), avec des sauvegardes chiffrées.']]));
c.push(liRich([['Copies de travail ', { bold: true }], ['(fichiers reçus, conversions, contrôles) : sur ce serveur ou sur mon poste de travail, protégé par mot de passe et par chiffrement du disque, le temps strictement nécessaire.']]));
c.push(liRich([['Jamais ', { bold: true }], ['dans le dépôt du code source, sur une clé USB ou un disque non chiffré, dans une messagerie personnelle, sur un réseau social ou dans un espace de partage public.']]));
c.push(liRich([['Démonstration et recette : ', { bold: true }], ['données fictives. Un essai sur données réelles se fait sur une base temporaire, effacée après l\'essai.']]));

c.push(art('5. Outils logiciels'));
c.push(para('Pour analyser et convertir les données, je peux utiliser des outils d\'assistance, y compris d\'intelligence artificielle. Je ne les utilise que dans un cadre professionnel, paramétrés pour que les données ne servent pas à entraîner leurs modèles et ne soient pas accessibles à des tiers. La liste des outils utilisés est communiquée au Client sur simple demande.'));

c.push(art('6. En cas d\'incident'));
c.push(para('En cas de perte, de vol, d\'erreur d\'envoi ou d\'accès non autorisé, je préviens le Client par écrit dans les 48 heures qui suivent la découverte. J\'indique les données touchées et les mesures prises, et je coopère pour en limiter les conséquences.'));

c.push(art('7. À la fin du projet'));
c.push(para('Dans les 30 jours qui suivent la validation de la reprise, ou à tout moment sur demande écrite du Client, je supprime les copies de travail, sauf ce que la loi impose de conserver, et je le confirme par écrit. Les sauvegardes s\'effacent selon leur cycle normal, en 12 mois au plus.'));
c.push(para('Les données enregistrées dans la plateforme restent la propriété du Client. À la fin du contrat, une copie complète lui est remise avant toute suppression, conformément à l\'engagement de réversibilité de l\'offre.'));

c.push(art('8. Durée'));
c.push(para('Cet engagement s\'applique dès sa signature, et aux données déjà reçues. Il vaut pendant tout le projet, hébergement et maintenance compris, puis 5 ans après la fin de la relation contractuelle ; sans limite de durée pour la méthode AxisPro, les dossiers des porteurs de projets et les secrets d\'affaires du Client.'));

c.push(para('Contact pour toute question de confidentialité', { bold: true, size: 20, after: 20, before: 120, align: AlignmentType.LEFT }));
c.push(para('M. Madigbè KOUYATÉ, +224 628 86 22 55, emkouyate@e-volutionxp.com', { size: 20, after: 200, align: AlignmentType.LEFT }));
c.push(para('Fait à Conakry, le ____________________, en deux exemplaires originaux.', { before: 120, after: 200 }));

const cb = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8' };
const borders = { top: cb, bottom: cb, left: cb, right: cb };
const cell = (lines, width) => new TableCell({ width: { size: width, type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.TOP, margins: { top: 100, bottom: 100, left: 140, right: 140 },
  children: lines.map(([t, s]) => new Paragraph({ children: [run(t, Object.assign({ size: 20 }, s))], spacing: { after: 60 } })) });
const half = W / 2;
c.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [half, half], rows: [new TableRow({ cantSplit: true, children: [
  cell([['Le Prestataire', { bold: true, color: NAVY }], [`${PRESTATAIRE} (E-VOLUTION XP)`], ['M. Madigbè KOUYATÉ, Gérant'], [''], ['Signature et cachet :'], [''], [''], ['']], half),
  cell([['Pris connaissance, pour le Client', { bold: true, color: NAVY }], [`${CLIENT1} et ${CLIENT2}`], ['M. Mohamed NIMAGA, Directeur Général'], [''], ['Signature et cachet :'], [''], [''], ['']], half),
] })] }));

const doc = new Document({
  creator: 'E-VOLUTION XP', title: 'Engagement de confidentialité',
  styles: { default: { document: { run: { font: FONT, size: 21 } } } },
  numbering: { config: [{ reference: 'puces', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8', space: 4 } }, children: [run(`Engagement de confidentialité, ${PRESTATAIRE} envers ${CLIENT1} et ${CLIENT2}`, { size: 16, color: GREY })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run('Confidentiel. Paraphes : ______  ______      Page ', { size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GREY })] })] }) },
    children: c,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(path.join(__dirname, 'Engagement_de_confidentialite.docx'), b); console.log('OK'); });
