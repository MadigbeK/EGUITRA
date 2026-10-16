// Construit la planche de la charte (index.html) à partir de modele.html, en y insérant le
// monogramme, un compteur et le jeu d'icônes tiré de apps/web/components/icons.tsx.
// Usage, depuis la racine du dépôt : node docs/design/planche/construire.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, "..", "..", "..");

/** Monogramme NIMOVA : mêmes tracés que components/brand.tsx. */
function monogramme(taille, tuile = true) {
  return `<svg viewBox="0 0 100 100" width="${taille}" height="${taille}" aria-hidden="true">${
    tuile ? '<rect width="100" height="100" rx="22" fill="#142f29"/>' : ""
  }<path d="M25 23h13l37 54H62Z" fill="#d4aa5b"/><path d="M25 23h13v54H25ZM62 23h13v54H62Z" fill="#a5e6c2"/></svg>`;
}

/** Compteur : même construction que le composant Compteur de components/ui.tsx. */
function compteur(valeur, unite) {
  const chiffres = String(valeur);
  const groupes = [];
  for (let fin = chiffres.length; fin > 0; fin -= 3) groupes.unshift(chiffres.slice(Math.max(0, fin - 3), fin));
  let rang = 0;
  const cases = groupes
    .map(
      (g) =>
        `<span class="groupe">${g
          .split("")
          .map(
            (c) =>
              `<span class="case"><span class="rouleau" style="--c:${c};--r:${rang++}">${"0123456789"
                .split("")
                .map((k) => `<span>${k}</span>`)
                .join("")}</span></span>`,
          )
          .join("")}</span>`,
    )
    .join("");
  const lu = new Intl.NumberFormat("fr-FR").format(valeur);
  return `<div class="compteur" role="img" aria-label="${lu} ${unite}">${cases}<span class="unite">${unite}</span></div>`;
}

/** Icônes : les dessins de components/icons.tsx, en SVG autonomes. */
function icones() {
  const src = readFileSync(join(racine, "apps", "web", "components", "icons.tsx"), "utf8");
  const constantes = Object.fromEntries([...src.matchAll(/const (\w+) = "([^"]+)";/g)].map((m) => [m[1], m[2]]));
  const liste = [];
  for (const m of src.matchAll(/export const (\w+) = dessin\("\w+", ([\s\S]*?)\);\n/g)) {
    let jsx = m[2].trim().replace(/^\(\s*/, "").replace(/\s*\)$/, "").replace(/^<>\s*/, "").replace(/\s*<\/>$/, "");
    jsx = jsx
      .replace(/\{\.\.\.POINT\}/g, 'fill="currentColor" stroke="none"')
      .replace(/d=\{(\w+)\}/g, (_, k) => `d="${constantes[k]}"`)
      .replace(/\s+/g, " ");
    liste.push(
      `<div class="icone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true">${jsx}</svg><span>${m[1]}</span></div>`,
    );
  }
  return liste.join("");
}

let html = readFileSync(join(ici, "modele.html"), "utf8");
html = html
  .replace("<!--MONOGRAMME-->", monogramme(122))
  .replaceAll("<!--MONOGRAMME-NU-->", monogramme(34, false))
  .replace("<!--MONOGRAMME-80-->", monogramme(80))
  .replace("<!--MONOGRAMME-64-->", monogramme(64))
  .replace("<!--MONOGRAMME-32-->", monogramme(32))
  .replace("<!--MONOGRAMME-16-->", monogramme(16))
  .replace("<!--COMPTEUR-->", compteur(4380000000, "GNF"))
  .replace("<!--ICONES-->", icones());
writeFileSync(join(ici, "index.html"), html);
console.log("planche écrite :", join(ici, "index.html"));
