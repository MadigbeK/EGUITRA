// Génère docs/projet/Engagement_de_confidentialite.docx : engagement du prestataire, signé avant la
// remise des données réelles du client (complète l'accord de confidentialité réciproque).
// Deux pages au plus, à l'identité d'E-VOLUTION XP : logo, bleu nuit et sarcelle du logo, titres en
// Century Gothic (proche du lettrage du logo), texte en Garamond.
// Usage : node docs/projet/engagement-de-confidentialite.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, VerticalAlign, Header, Footer, PageNumber, TabStopType, TableLayoutType,
} = require('docx');

const NUIT = '1D1D69', SARCELLE = '00A89C', ENCRE = '2B2B33', GRIS = '7A7F8C', PALE = 'A3A8B3', FILET = 'D9DDE3';
const TITRE = 'Century Gothic', TEXTE = 'Garamond';
const A4 = { width: 11906, height: 16838 };
const MARGE = 1080;
const W = A4.width - 2 * MARGE; // largeur utile, en DXA

// Apostrophe typographique partout.
const run = (text, o = {}) => new TextRun({
  text: text.replace(/'/g, '’'), font: o.font ?? TEXTE, size: o.size ?? 20, bold: o.bold, italics: o.italics,
  color: o.color ?? ENCRE, characterSpacing: o.espace, allCaps: o.caps,
});
const para = (enfants, o = {}) => new Paragraph({
  children: Array.isArray(enfants) ? enfants : [enfants],
  alignment: o.align ?? AlignmentType.JUSTIFIED,
  spacing: { before: o.avant ?? 0, after: o.apres ?? 80, line: o.interligne ?? 246 },
  keepNext: o.keepNext, border: o.border, tabStops: o.tabs,
});
// Petite étiquette en capitales espacées : la signature typographique du document.
// Capitales écrites (et non le format « majuscules » de Word) : les accents restent visibles.
const etiquette = (text, o = {}) => run(text.toLocaleUpperCase('fr-FR'), { font: TITRE, size: o.size ?? 13, color: o.color ?? SARCELLE, espace: 50, bold: o.bold });

const aucun = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const sansBord = { top: aucun, bottom: aucun, left: aucun, right: aucun };
const cellule = (enfants, largeur, o = {}) => new TableCell({
  children: enfants, width: { size: largeur, type: WidthType.DXA }, verticalAlign: o.valign ?? VerticalAlign.TOP,
  borders: o.borders ?? sansBord, margins: { top: o.haut ?? 0, bottom: o.bas ?? 0, left: o.gauche ?? 0, right: o.droite ?? 0 },
});
const grille = (lignes, largeurs) => new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: largeurs, layout: TableLayoutType.FIXED,
  borders: { top: aucun, bottom: aucun, left: aucun, right: aucun, insideHorizontal: aucun, insideVertical: aucun },
  rows: lignes,
});

const PRESTATAIRE = 'E-volution Experience';
const CLIENT1 = 'EGUITRA GROUP SARLU';
const CLIENT2 = 'MB AxisPro';
const logo = fs.readFileSync(path.join(__dirname, 'assets', 'logo-evolution-xp.png'));

const c = [];

// En-tête de la première page : le logo, et à droite la référence du document.
c.push(grille([new TableRow({ children: [
  cellule([new Paragraph({ children: [new ImageRun({
    type: 'png', data: logo, transformation: { width: 116, height: 68 },
    altText: { title: 'E-VOLUTION XP', description: 'Logo E-VOLUTION XP, Transformation numérique', name: 'logo' },
  })] })], W / 2, { valign: VerticalAlign.BOTTOM }),
  cellule([
    para(etiquette('Engagement de confidentialité', { color: GRIS }), { align: AlignmentType.RIGHT, apres: 30 }),
    para(etiquette('Réf. EC-EGUITRA-2026-01', { color: NUIT, bold: true }), { align: AlignmentType.RIGHT, apres: 30 }),
    para(etiquette('Conakry · octobre 2026', { color: GRIS }), { align: AlignmentType.RIGHT, apres: 0 }),
  ], W / 2, { valign: VerticalAlign.BOTTOM }),
] })], [W / 2, W / 2]));

// Titre : grand, sobre, souligné d'un filet sarcelle.
c.push(para(etiquette('Protection des données du client'), { avant: 180, apres: 30, align: AlignmentType.LEFT }));
c.push(para(run('Engagement de confidentialité', { font: TITRE, size: 40, color: NUIT }), { apres: 40, align: AlignmentType.LEFT, interligne: 240 }));
c.push(para(run('Données d\'EGUITRA GROUP SARLU et de MB AxisPro confiées pour la plateforme NIMOVA', { italics: true, size: 22, color: GRIS }), {
  align: AlignmentType.LEFT, apres: 150,
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: SARCELLE, space: 10 } },
}));

// Les parties, côte à côte.
const partie = (titre, nom, detail, contact) => [
  para(etiquette(titre), { apres: 30, align: AlignmentType.LEFT }),
  para(run(nom, { font: TITRE, size: 18, bold: true, color: NUIT }), { apres: 20, align: AlignmentType.LEFT }),
  para(run(detail, { size: 20, color: GRIS }), { apres: 0, align: AlignmentType.LEFT, interligne: 240 }),
  ...(contact ? [para(run(contact, { size: 19, color: NUIT }), { avant: 20, apres: 0, align: AlignmentType.LEFT, interligne: 240 })] : []),
];
const tiers = Math.round(W * 0.5);
c.push(grille([new TableRow({ children: [
  cellule(partie('Le prestataire', 'E-VOLUTION XP', `${PRESTATAIRE}, représentée par M. Madigbè KOUYATÉ, gérant`, '+224 628 86 22 55 · emkouyate@e-volutionxp.com'), tiers, { droite: 240 }),
  cellule(partie('Le client', `${CLIENT1} et ${CLIENT2}`, 'Représentées par M. Mohamed NIMAGA, directeur général'), W - tiers, { gauche: 240 }),
] })], [tiers, W - tiers]));

c.push(para([
  run('Pour la plateforme NIMOVA (offre OTF-EGUITRA-2026-37 du 29 septembre 2026), le prestataire s\'engage, pour lui-même et pour toute personne travaillant sous sa responsabilité, à protéger les données que le Client lui remet ou lui rend accessibles, selon les huit règles ci-dessous. Cet engagement complète l\'accord de confidentialité réciproque ; en cas de différence, la règle la plus protectrice pour le Client s\'applique.'),
], { avant: 200, apres: 120 }));

// Les huit règles : un numéro en marge, le titre, le texte. Un filet fin sépare chaque règle.
const regles = [
  ['Les données protégées', 'Toute donnée du Client, quel qu\'en soit le support : comptabilité, banque et trésorerie ; transport (rotations, véhicules, chauffeurs, tarifs, exports du logiciel actuel) ; contrats, clients et fournisseurs ; données personnelles des salariés, chauffeurs et porteurs de projets ; dossiers et méthode d\'évaluation AxisPro ; identifiants et accès.'],
  ['Un seul usage : le projet', 'Reprise de l\'historique, paramétrage, essais et support de la plateforme. Aucune vente, communication à un tiers, réutilisation pour un autre client, publication ni usage personnel ou commercial.'],
  ['Un accès limité et tracé', 'Seules les personnes nommément désignées, liées par un engagement identique, accèdent aux données ; leur liste est remise au Client sur demande. Dans la plateforme, chaque compte est nominatif, protégé par un mot de passe personnel et une double authentification ; chaque modification est tracée.'],
  ['Où vivent les données', 'Plateforme : serveur dédié dans l\'Union européenne, connexion chiffrée, sauvegardes chiffrées. Copies de travail : ce serveur ou un poste au disque chiffré, le temps strictement nécessaire. Jamais dans le code source, sur un support amovible non chiffré, une messagerie personnelle ou un espace de partage public. Démonstrations et recette : données fictives ; un essai sur données réelles se fait sur une base temporaire, effacée ensuite.'],
  ['Les outils logiciels', 'Les outils d\'assistance, y compris d\'intelligence artificielle, ne sont utilisés que dans un cadre professionnel, réglés pour que les données ne servent pas à entraîner leurs modèles et ne soient pas accessibles à des tiers. Leur liste est remise sur demande.'],
  ['En cas d\'incident', 'Perte, vol, erreur d\'envoi ou accès non autorisé : le Client est prévenu par écrit dans les 48 heures, avec les données touchées et les mesures prises ; le prestataire coopère pour en limiter les conséquences.'],
  ['À la fin de la mission', 'Les copies de travail sont supprimées dans les 30 jours suivant la validation de la reprise, ou à la demande écrite du Client, et la suppression est confirmée par écrit ; les sauvegardes s\'effacent selon leur cycle, en 12 mois au plus. Les données de la plateforme restent la propriété du Client : une copie complète lui est remise avant toute suppression.'],
  ['Durée', 'Dès la signature, y compris pour les données déjà reçues ; pendant tout le projet, hébergement et maintenance compris, puis 5 ans après la fin de la relation ; sans limite de durée pour la méthode AxisPro, les dossiers des porteurs de projets et les secrets d\'affaires du Client.'],
];
const MARGE_NUM = 700;
const filet = { style: BorderStyle.SINGLE, size: 2, color: FILET };
c.push(grille(regles.map(([titre, texte], i) => new TableRow({ cantSplit: true, children: [
  cellule([para(run(String(i + 1).padStart(2, '0'), { font: TITRE, size: 24, color: SARCELLE }), { align: AlignmentType.LEFT, apres: 0, interligne: 240 })],
    MARGE_NUM, { borders: { ...sansBord, top: filet }, haut: 64, bas: 44 }),
  cellule([
    para(run(titre, { font: TITRE, size: 17, bold: true, color: NUIT }), { align: AlignmentType.LEFT, apres: 20 }),
    para(run(texte), { apres: 0 }),
  ], W - MARGE_NUM, { borders: { ...sansBord, top: filet }, haut: 64, bas: 44 }),
] })), [MARGE_NUM, W - MARGE_NUM]));

// Signatures : pas de cadre, un filet sous lequel on signe.
c.push(para([etiquette('Fait à Conakry, le', { color: GRIS }), run('  ____________________, en deux exemplaires originaux.', { size: 20, color: GRIS })], {
  avant: 120, apres: 110, align: AlignmentType.LEFT, border: { top: { style: BorderStyle.SINGLE, size: 2, color: FILET, space: 10 } },
}));
const ligneSignature = { ...sansBord, bottom: { style: BorderStyle.SINGLE, size: 4, color: NUIT } };
const signature = (role, societe, nom) => [
  para(etiquette(role), { apres: 30, align: AlignmentType.LEFT }),
  para(run(societe, { font: TITRE, size: 17, bold: true, color: NUIT }), { apres: 20, align: AlignmentType.LEFT }),
  para(run(nom, { size: 20, color: GRIS }), { apres: 0, align: AlignmentType.LEFT }),
];
const espace = 480;
const col = (W - espace) / 2;
c.push(new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [col, espace, col], layout: TableLayoutType.FIXED,
  borders: { top: aucun, bottom: aucun, left: aucun, right: aucun, insideHorizontal: aucun, insideVertical: aucun },
  rows: [
    new TableRow({ cantSplit: true, children: [
      cellule(signature('Le prestataire', 'E-VOLUTION XP', 'Madigbè KOUYATÉ, gérant'), col),
      cellule([new Paragraph({ children: [] })], espace),
      cellule(signature('Pris connaissance, pour le client', `${CLIENT1} et ${CLIENT2}`, 'Mohamed NIMAGA, directeur général'), col),
    ] }),
    // L'espace de signature, fermé par un filet bleu nuit ; la mention discrète en tête de l'espace.
    new TableRow({ cantSplit: true, height: { value: 600, rule: 'atLeast' }, children: [
      cellule([para(etiquette('Signature et cachet', { color: PALE, size: 11 }), { avant: 90, apres: 0, align: AlignmentType.RIGHT })], col, { borders: ligneSignature }),
      cellule([new Paragraph({ children: [] })], espace),
      cellule([para(etiquette('Signature et cachet', { color: PALE, size: 11 }), { avant: 90, apres: 0, align: AlignmentType.RIGHT })], col, { borders: ligneSignature }),
    ] }),
  ],
}));

// Word exige un paragraphe après le dernier tableau : minuscule, il ne pousse rien en page 2.
c.push(new Paragraph({ children: [run('', { size: 2 })], spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' } }));

const pied = (texte) => run(texte, { font: TITRE, size: 13, color: GRIS, espace: 30 });
const doc = new Document({
  creator: 'E-VOLUTION XP', title: 'Engagement de confidentialité', description: 'Engagement de confidentialité du prestataire envers EGUITRA GROUP SARLU et MB AxisPro',
  styles: { default: { document: { run: { font: TEXTE, size: 21, color: ENCRE } } } },
  sections: [{
    properties: { titlePage: true, page: { size: A4, margin: { top: 760, bottom: 820, left: MARGE, right: MARGE, header: 400, footer: 400 } } },
    headers: {
      first: new Header({ children: [new Paragraph({ children: [] })] }),
      default: new Header({ children: [para([etiquette('E-VOLUTION XP', { color: NUIT, bold: true }), etiquette('\tEngagement de confidentialité · Réf. EC-EGUITRA-2026-01', { color: GRIS })], {
        align: AlignmentType.LEFT, apres: 0, tabs: [{ type: TabStopType.RIGHT, position: W }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: FILET, space: 6 } },
      })] }),
    },
    footers: { first: piedDePage(), default: piedDePage() },
    children: c,
  }],
});

function piedDePage() {
  return new Footer({ children: [para([
        pied('E-VOLUTION XP · TRANSFORMATION NUMÉRIQUE · CONAKRY'),
        pied('\tRÉF. EC-EGUITRA-2026-01 · PAGE '),
        new TextRun({ children: [PageNumber.CURRENT], font: TITRE, size: 13, color: NUIT, bold: true }),
        new TextRun({ children: [' / ', PageNumber.TOTAL_PAGES], font: TITRE, size: 13, color: GRIS }),
      ], { align: AlignmentType.LEFT, apres: 0, tabs: [{ type: TabStopType.RIGHT, position: W }],
        border: { top: { style: BorderStyle.SINGLE, size: 2, color: FILET, space: 6 } } })] });
}
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(path.join(__dirname, 'Engagement_de_confidentialite.docx'), b); console.log('OK'); });
