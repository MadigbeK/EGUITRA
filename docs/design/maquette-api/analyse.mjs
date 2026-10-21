/**
 * Maquette des routes de NIMOVA · Analyse (/analyse/contexte, /analyse/groupe/*, /analyse/cabinet/*),
 * dans les formes exactes du noyau (addons/eguitra_analytics, spécification
 * docs/projet/analyse/specification.md, chapitres 3 à 7) : mêmes clés, mêmes unités, mêmes
 * variantes (blocs nuls quand la donnée n'existe pas). Données fictives et déterministes (graines
 * fixes) : un modèle mensuel cohérent pour EGUITRA GROUP (analyse-groupe.mjs) et un portefeuille de
 * projets pour MB AxisPro Consulting (analyse-cabinet.mjs). Rien ici n'est une donnée réelle.
 *
 * `enregistrerAnalyse` reçoit les outils du serveur (route, erreurs, générateur, date de référence,
 * sociétés) et inscrit les routes.
 */

import { routesCabinet } from "./analyse-cabinet.mjs";
import { creerPeriode } from "./analyse-commun.mjs";
import { routesGroupe } from "./analyse-groupe.mjs";

const PROFILS_TOUS = ["admin", "direction", "finance", "cabinet"];

const SECTIONS = {
  groupe: [
    ["synthese", "Cockpit", "Où en est EGUITRA GROUP aujourd'hui ?", "Radar", "/analyse"],
    ["rentabilite", "Rentabilité", "D'où vient la marge, et où s'érode-t-elle ?", "TrendingUp", "/analyse/rentabilite"],
    ["tresorerie", "Trésorerie et prévision", "Où va la trésorerie dans les 13 prochaines semaines ?", "Landmark", "/analyse/tresorerie"],
    ["clients", "Portefeuille clients", "Quels clients font la valeur, et lesquels font le risque ?", "Users", "/analyse/clients"],
    ["transport", "Flotte et routes", "Quelles routes et quels camions gagnent de l'argent ?", "Truck", "/analyse/transport"],
    ["depenses", "Dépenses et contrôles", "Où part l'argent, et quelles factures méritent un second regard ?", "ShoppingCart", "/analyse/depenses"],
    ["previsions", "Atterrissage et simulateur", "Où atterrit l'exercice, et que peut-on encore changer ?", "Target", "/analyse/previsions"],
    ["fiabilite", "Fiabilité des données", "Peut-on se fier aux chiffres ?", "ShieldCheck", "/analyse/fiabilite"],
  ],
  cabinet: [
    ["synthese", "Cockpit", "Où en est le portefeuille de projets du cabinet ?", "Radar", "/analyse"],
    ["portefeuille", "Projets et pipeline", "Où en sont les projets, et où bloquent-ils ?", "FolderKanban", "/analyse/portefeuille"],
    ["diagnostic", "Diagnostic des projets", "Quelles faiblesses reviennent d'un projet à l'autre ?", "Layers", "/analyse/diagnostic"],
    ["comites", "Qualité des décisions", "Le comité décide-t-il comme la méthode le recommande ?", "Gavel", "/analyse/comites"],
    ["financements", "Financements", "Qui finance quoi, et avec quel succès ?", "HandCoins", "/analyse/financements"],
    ["activite", "Activité et honoraires", "Le temps du cabinet se transforme-t-il en honoraires ?", "Clock", "/analyse/activite"],
    ["risques", "Risques et exécution", "Quels risques menacent l'exécution des projets ?", "ShieldAlert", "/analyse/risques"],
  ],
};

const PERIODES = [["ytd", "Exercice en cours"], ["12m", "12 derniers mois"], ["q", "Trimestre en cours"], ["m", "Mois en cours"], ["custom", "Dates libres"]].map(([code, label]) => ({ code, label }));

export function enregistrerAnalyse({ route, ApiError, makeRng, TODAY, COMPANIES }) {
  const badParam = (m) => new ApiError(400, "invalid_parameter", m);
  const wrongCompany = (entity) =>
    new ApiError(403, "wrong_company", `Ce module ne concerne que ${entity === "groupe" ? "EGUITRA GROUP SARLU" : "MB AxisPro Consulting"} : choisissez cette société dans la colonne de gauche, ou ouvrez l'application qui la sert.`);
  const periode = creerPeriode(TODAY, badParam);

  function enveloppe(ctx, entity, p, quality, insights, corps) {
    const c = COMPANIES[ctx.company];
    return { entity, company: { id: c.id, name: c.name, currency: "GNF" }, period: p, generated_at: `${new Date().toISOString().slice(0, 19)}Z`, quality, insights, ...corps };
  }
  function exigerEntite(ctx, entity) {
    if (COMPANIES[ctx.company].entity !== entity) throw wrongCompany(entity);
  }

  const outils = { route, makeRng, TODAY, periode, enveloppe, exigerEntite };
  routesGroupe(outils);
  routesCabinet(outils);

  /* ─── Contexte (chapitre 7) ─────────────────────────────────────────── */

  route("GET", "/analyse/contexte", PROFILS_TOUS, (ctx) => {
    const c = COMPANIES[ctx.company];
    const sections = SECTIONS[c.entity] ?? [];
    return {
      entity: c.entity,
      company: { id: c.id, name: c.name, currency: "GNF" },
      sections: sections.map(([key, label, question, icon, path]) => ({ key, label, question, icon, path })),
      fiscal_year: { date_from: `${TODAY.slice(0, 4)}-01-01`, date_to: `${TODAY.slice(0, 4)}-12-31` },
      last_entry_date: TODAY,
      today: TODAY,
      can_switch: ctx.user.companies.length > 1,
      companies: ctx.user.companies.map((id) => ({ id, name: COMPANIES[id].name, entity: COMPANIES[id].entity ?? null })),
      periods: PERIODES,
    };
  });
}
