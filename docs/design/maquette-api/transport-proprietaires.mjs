/**
 * Maquette : ensembles gérés pour des propriétaires (règles de répartition, relevés) et coûts standard
 * des routes (prix du carburant). Imite eguitra_transport/models/ownership.py et standard.py et les
 * routes de controllers/owners.py. Données fictives.
 */

let R = null; // références du serveur, posées par enregistrerProprietaires
const SEQ = { fuel: 0, rule: 0, statement: 0, line: 0, move: 9000 };

export const OWNERSHIP_LABELS = { own: "Propre", managed: "Géré pour un propriétaire" };
const BASES = [
  { code: "declared", label: "Frais déclarés et charges mensuelles de l'ensemble" },
  { code: "booked", label: "Pièces comptabilisées sur l'ensemble" },
];

/** Prix du litre applicable à une date ; 0 sans prix. */
export function fuelPriceAt(company, day) {
  const prices = R.DB.fuelPrices.filter((p) => p.company_id === company && p.date_from <= day).sort((a, b) => b.date_from.localeCompare(a.date_from));
  return prices[0]?.price ?? 0;
}

/** Coût standard d'une rotation (figé à la validation dans le noyau ; recalculé ici pour les saisies). */
export function standardOf(rot) {
  if (rot.std_frozen) return rot.std_frozen;
  const route = R.DB.routes.find((x) => x.id === rot.route_id) || {};
  const liters = route.std_fuel_liters || 0;
  const price = liters ? fuelPriceAt(rot.company_id, rot.date_loading) : 0;
  const cost = Math.round(liters * price + (route.std_driver_bonus || 0) + (route.std_tolls || 0) + (route.std_other_costs || 0));
  const std = { std_fuel_liters: liters, std_fuel_price: price, std_cost: cost, estimated_margin: (rot.revenue || 0) - cost };
  if (rot.state === "done" || rot.state === "invoiced") rot.std_frozen = std;
  return std;
}

export const monthlyOf = (c) => (c.periodicity === "year" ? c.amount / 12 : c.amount);

function monthsBetween(from, to) {
  let months = 0;
  let day = from;
  while (day <= to) {
    const [y, m] = day.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = `${day.slice(0, 7)}-${String(days).padStart(2, "0")}`;
    const end = last < to ? last : to;
    months += (Number(end.slice(8)) - Number(day.slice(8)) + 1) / days;
    const next = new Date(Date.UTC(y, m, 1));
    day = next.toISOString().slice(0, 10);
  }
  return months;
}

/** Données de démonstration : deux ensembles gérés, charges mensuelles, forfaits des routes, règles. */
export function seedProprietaires(DB) {
  for (const v of DB.vehicles) Object.assign(v, { ownership: "own", owner_id: null, charges: [] });
  const charges = (assurance) => [
    { id: ++SEQ.line, name: "Assurance", amount: assurance, periodicity: "month", date_from: null, date_to: null },
    { id: ++SEQ.line, name: "Géolocalisation et caméra", amount: 5_871_000, periodicity: "year", date_from: null, date_to: null },
    { id: ++SEQ.line, name: "Vignettes", amount: 2_720_000, periodicity: "year", date_from: null, date_to: null },
    { id: ++SEQ.line, name: "Visite technique", amount: 990_000, periodicity: "year", date_from: null, date_to: null },
  ];
  Object.assign(DB.vehicles.find((v) => v.id === 14), { ownership: "managed", owner_id: 173, charges: charges(2_104_333) });
  Object.assign(DB.vehicles.find((v) => v.id === 15), { ownership: "managed", owner_id: 174, charges: charges(1_950_000) });
  for (const id of [5, 6, 9]) DB.vehicles.find((v) => v.id === id).charges = charges(2_250_000);
  for (const rt of DB.routes) {
    const km = rt.distance_km || 0;
    Object.assign(rt, {
      std_fuel_liters: Math.round(2 * km * (rt.id === 6 ? 0.18 : 0.62)), std_driver_bonus: km > 100 ? (km > 500 ? 850_000 : 500_000) : 120_000,
      std_tolls: km > 250 ? 240_000 : 0, std_other_costs: 0,
    });
  }
  DB.fuelPrices = [
    { id: ++SEQ.fuel, company_id: 1, date_from: "2026-01-01", price: 12_000, note: "Structure des prix de janvier 2026" },
    { id: ++SEQ.fuel, company_id: 1, date_from: "2026-06-01", price: 12_500, note: "Structure des prix de juin 2026" },
  ];
  DB.shareRules = [
    { id: ++SEQ.rule, company_id: 1, vehicle_id: null, ownership: "managed", partner_id: 1001, rate: 5, date_from: null, date_to: null, note: "Contrats de gestion des ensembles", active: true },
    { id: ++SEQ.rule, company_id: 1, vehicle_id: 5, ownership: null, partner_id: 175, rate: 15, date_from: "2026-01-01", date_to: null, note: "Convention de partenariat", active: true },
    { id: ++SEQ.rule, company_id: 1, vehicle_id: 15, ownership: null, partner_id: 175, rate: 10, date_from: "2026-01-01", date_to: null, note: "Convention de partenariat", active: true },
  ];
  DB.statements = [];
}

const companyPartnerId = (company) => 1000 + company;
const ownerOf = (v) => (v.ownership === "managed" ? v.owner_id : companyPartnerId(v.company_id));
const partnerRef = (id) => (id > 1000 ? { id, name: R.COMPANIES[id - 1000]?.name ?? "Société" } : R.partnerRef(id));

function rulesFor(v, day) {
  const rules = R.DB.shareRules.filter((r) => r.company_id === v.company_id && r.active
    && (r.vehicle_id === v.id || (!r.vehicle_id && r.ownership === v.ownership))
    && (!r.date_from || r.date_from <= day) && (!r.date_to || day <= r.date_to));
  const own = rules.filter((r) => r.vehicle_id);
  return [...own, ...rules.filter((r) => !r.vehicle_id && !own.some((o) => o.partner_id === r.partner_id))];
}

function compute(st) {
  const { DB } = R;
  const v = DB.vehicles.find((x) => x.id === st.vehicle_id);
  const company = v.company_id;
  const basis = DB.ownerCostBasis?.[company] ?? "declared";
  const rots = DB.rotations.filter((r) => r.vehicle_id === v.id && ["done", "invoiced"].includes(r.state) && r.date_loading >= st.date_from && r.date_loading <= st.date_to)
    .sort((a, b) => a.date_loading.localeCompare(b.date_loading));
  const revenue = rots.reduce((s, r) => s + r.revenue, 0);
  const rotationCosts = rots.reduce((s, r) => s + r.total_cost, 0);
  const months = monthsBetween(st.date_from, st.date_to);
  const charges = (v.charges || []).map((c) => ({ c, months, amount: Math.round(monthlyOf(c) * months) }));
  const vehicleCharges = charges.reduce((s, x) => s + x.amount, 0);
  const declared = rotationCosts + vehicleCharges;
  const booked = Math.round(declared * 0.93);
  const costs = basis === "booked" ? booked : declared;
  const margin = revenue - costs;
  const shares = new Map();
  for (const rot of rots) for (const rule of rulesFor(v, rot.date_loading)) {
    const key = `${rule.partner_id}|${rule.rate}`;
    shares.set(key, (shares.get(key) || 0) + rot.revenue);
  }
  const commissionLines = [...shares].map(([key, base]) => {
    const [partner, rate] = key.split("|").map(Number);
    return { kind: "commission", partner, rate, base, amount: Math.round((base * rate) / 100) };
  });
  const commissions = commissionLines.reduce((s, l) => s + l.amount, 0);
  const owner = ownerOf(v);
  const ownerAmount = margin - commissions;
  let operator = commissionLines.filter((l) => l.partner === companyPartnerId(company)).reduce((s, l) => s + l.amount, 0);
  if (v.ownership !== "managed") operator += ownerAmount;
  const lines = [
    ...charges.map((x) => ({ id: ++SEQ.line, kind: "charge", name: x.c.name, partner: null, rate: null, base: null, monthly: monthlyOf(x.c), months: x.months, amount: x.amount, move: null })),
    ...commissionLines.map((l) => ({ id: ++SEQ.line, kind: "commission", name: `${partnerRef(l.partner)?.name} : ${String(l.rate).replace(".", ",")} % du chiffre d'affaires brut`, partner: partnerRef(l.partner), rate: l.rate, base: l.base, monthly: null, months: null, amount: l.amount, move: null })),
    { id: ++SEQ.line, kind: "owner", name: `${partnerRef(owner)?.name} : résiduel de la marge`, partner: partnerRef(owner), rate: null, base: null, monthly: null, months: null, amount: ownerAmount, move: null },
  ];
  Object.assign(st, {
    ownership: v.ownership, owner_id: owner, basis, rotation_ids: rots.map((r) => r.id), rotation_count: rots.length,
    volume: Math.round(rots.reduce((s, r) => s + (r.volume_delivered || r.volume_loaded), 0) * 1000) / 1000,
    revenue, taxes_rebilled: 0, rotation_costs: rotationCosts, shortage_cost: 0, vehicle_charges: vehicleCharges, declared_costs: declared,
    booked_costs: booked, costs, margin, commissions, owner_amount: ownerAmount, operator_amount: operator, lines, computed_at: `${R.TODAY}T09:30:00Z`,
  });
}

function row(st, detail = false) {
  const { DB } = R;
  const out = {
    id: st.id, name: st.name, vehicle: R.simpleRef(DB.vehicles, st.vehicle_id), ownership: st.ownership, owner: partnerRef(st.owner_id),
    date_from: st.date_from, date_to: st.date_to, state: st.state, basis: st.basis, basis_label: BASES.find((b) => b.code === st.basis)?.label ?? null,
    computed_at: st.computed_at, rotation_count: st.rotation_count, volume: st.volume, revenue: st.revenue, taxes_rebilled: st.taxes_rebilled,
    rotation_costs: st.rotation_costs, shortage_cost: st.shortage_cost, vehicle_charges: st.vehicle_charges, declared_costs: st.declared_costs,
    booked_costs: st.booked_costs, costs: st.costs, margin: st.margin, commissions: st.commissions, owner_amount: st.owner_amount,
    operator_amount: st.operator_amount, moves: st.moves,
  };
  if (detail) {
    out.lines = st.lines;
    out.rotations = st.rotation_ids.map((id) => DB.rotations.find((r) => r.id === id)).map((r) => ({
      id: r.id, name: r.name, date_loading: r.date_loading, route: R.simpleRef(DB.routes, r.route_id), client: R.partnerRef(r.partner_id),
      volume: r.volume_delivered || r.volume_loaded, revenue: r.revenue, total_cost: r.total_cost, state: r.state,
    }));
  }
  return out;
}

function eligible(company) {
  const { DB } = R;
  const rules = DB.shareRules.filter((r) => r.company_id === company && r.active);
  return DB.vehicles.filter((v) => v.company_id === company && (v.ownership === "managed" || rules.some((r) => r.vehicle_id === v.id || (!r.vehicle_id && r.ownership === v.ownership))))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function enregistrerProprietaires(refs) {
  R = refs;
  const { route, DB, ApiError, TR_READ } = refs;
  const ACCOUNTING = ["admin", "direction", "finance"];
  const SETTINGS = ["admin", "finance"];
  const notFound = (m) => new ApiError(404, "not_found", m);
  const rule = (m) => new ApiError(422, "business_rule", m);

  route("GET", "/transport/fuel-prices", TR_READ, (ctx) => ({
    current: fuelPriceAt(ctx.company, R.TODAY),
    items: DB.fuelPrices.filter((p) => p.company_id === ctx.company).sort((a, b) => b.date_from.localeCompare(a.date_from)).map(({ id, date_from, price, note }) => ({ id, date_from, price, note })),
  }));
  route("POST", "/transport/fuel-prices", SETTINGS, (ctx) => {
    const { date_from, price, note } = ctx.body;
    if (!date_from || !(Number(price) > 0)) throw new ApiError(400, "invalid_parameter", "Prix du litre attendu.");
    const existing = DB.fuelPrices.find((p) => p.company_id === ctx.company && p.date_from === date_from);
    if (existing) Object.assign(existing, { price: Number(price), note: note || existing.note });
    else DB.fuelPrices.push({ id: ++SEQ.fuel, company_id: ctx.company, date_from, price: Number(price), note: note || null });
    return { current: fuelPriceAt(ctx.company, R.TODAY), items: DB.fuelPrices.filter((p) => p.company_id === ctx.company) };
  });
  route("DELETE", "/transport/fuel-prices/:id", SETTINGS, (ctx) => {
    DB.fuelPrices = DB.fuelPrices.filter((p) => !(p.id === ctx.params[0] && p.company_id === ctx.company));
    return { current: fuelPriceAt(ctx.company, R.TODAY), items: DB.fuelPrices.filter((p) => p.company_id === ctx.company) };
  });

  const ruleRow = (r) => ({
    id: r.id, vehicle: R.simpleRef(DB.vehicles, r.vehicle_id), ownership: r.ownership, partner: partnerRef(r.partner_id), rate: r.rate,
    date_from: r.date_from, date_to: r.date_to, note: r.note, active: r.active, is_company: r.partner_id === companyPartnerId(r.company_id),
  });
  route("GET", "/transport/share-rules", ACCOUNTING, (ctx) => DB.shareRules.filter((r) => r.company_id === ctx.company).map(ruleRow));
  route("POST", "/transport/share-rules", SETTINGS, (ctx) => {
    const b = ctx.body;
    const rate = Number(b.rate);
    if (!(rate > 0 && rate <= 100)) throw rule("Le taux d'une règle de répartition est compris entre 0 et 100 %.");
    if (!b.vehicle_id && !b.ownership) throw rule("Une règle porte sur un ensemble ou sur une catégorie d'ensembles.");
    const r = { id: ++SEQ.rule, company_id: ctx.company, vehicle_id: b.vehicle_id ? Number(b.vehicle_id) : null, ownership: b.ownership || null, partner_id: Number(b.partner_id), rate, date_from: b.date_from || null, date_to: b.date_to || null, note: b.note || null, active: true };
    DB.shareRules.push(r);
    return ruleRow(r);
  });
  route("DELETE", "/transport/share-rules/:id", SETTINGS, (ctx) => {
    DB.shareRules = DB.shareRules.filter((r) => !(r.id === ctx.params[0] && r.company_id === ctx.company));
    return { status: "ok" };
  });

  route("GET", "/transport/owner-statements", ACCOUNTING, (ctx) => {
    const end = ctx.query.date_to || R.TODAY;
    const start = ctx.query.date_from || `${end.slice(0, 7)}-01`;
    const items = DB.statements.filter((s) => s.company_id === ctx.company && s.date_from >= start && s.date_to <= end);
    const total = (k) => items.reduce((s, x) => s + x[k], 0);
    return {
      items: items.map((s) => row(s)),
      vehicles: eligible(ctx.company).map((v) => ({ id: v.id, name: v.name, ownership: v.ownership, owner: partnerRef(ownerOf(v)) })),
      totals: Object.fromEntries(["revenue", "costs", "margin", "commissions", "owner_amount", "operator_amount"].map((k) => [k, total(k)])),
    };
  });
  route("POST", "/transport/owner-statements", SETTINGS, (ctx) => {
    const { date_from, date_to, vehicle_id } = ctx.body;
    if (!date_from || !date_to || date_from > date_to) throw new ApiError(400, "invalid_parameter", "Période attendue : date_from et date_to.");
    const vehicles = vehicle_id ? DB.vehicles.filter((v) => v.id === Number(vehicle_id)) : eligible(ctx.company);
    if (!vehicles.length) throw rule("Aucun ensemble géré ni aucune règle de répartition : rien à établir.");
    const out = [];
    for (const v of vehicles) {
      let st = DB.statements.find((s) => s.vehicle_id === v.id && s.date_from === date_from && s.date_to === date_to);
      if (!st) {
        st = { id: ++SEQ.statement, company_id: ctx.company, vehicle_id: v.id, date_from, date_to, state: "draft", moves: [], name: `${v.name} du ${date_from.split("-").reverse().join("/")} au ${date_to.split("-").reverse().join("/")}` };
        DB.statements.push(st);
      }
      if (st.state === "draft") compute(st);
      out.push(row(st));
    }
    return { items: out };
  });
  const statementOf = (ctx) => {
    const st = DB.statements.find((s) => s.id === ctx.params[0] && s.company_id === ctx.company);
    if (!st) throw notFound("Relevé introuvable.");
    return st;
  };
  route("GET", "/transport/owner-statements/:id", ACCOUNTING, (ctx) => row(statementOf(ctx), true));
  route("POST", "/transport/owner-statements/:id/:action", SETTINGS, (ctx) => {
    const st = statementOf(ctx);
    const action = ctx.params[1];
    if (action === "refresh") {
      if (st.state !== "draft") throw rule(`${st.name} : les pièces sont préparées, le relevé ne se recalcule plus.`);
      compute(st);
    } else if (action === "prepare") {
      if (st.state !== "draft") throw rule(`${st.name} : pièces déjà préparées.`);
      const moves = [];
      if (st.ownership === "managed" && st.owner_amount) {
        const move = { id: ++SEQ.move, name: null, state: "draft" };
        st.lines.find((l) => l.kind === "owner").move = move;
        moves.push(move);
      }
      for (const l of st.lines.filter((x) => x.kind === "commission" && x.amount && x.partner?.id !== companyPartnerId(st.company_id))) {
        l.move = { id: ++SEQ.move, name: null, state: "draft" };
        moves.push(l.move);
      }
      Object.assign(st, { state: "posted", moves });
    } else if (action === "reset") {
      for (const l of st.lines) l.move = null;
      Object.assign(st, { state: "draft", moves: [] });
    } else throw notFound("Action inconnue.");
    return row(st, true);
  });
  route("GET", "/transport/owner-statements/:id/releve.pdf", ACCOUNTING, (ctx) => {
    const st = statementOf(ctx);
    return R.fileReply(Buffer.from("%PDF-1.4\n% Maquette : relevé fictif\n"), "application/pdf", `releve_${st.id}.pdf`);
  });
  route("GET", "/transport/owner-statements/:id/releve.xlsx", ACCOUNTING, (ctx) => {
    const st = statementOf(ctx);
    const rows = [["Poste", "Montant"], ["Chiffre d'affaires", st.revenue], ["Charges", -st.costs], ["Marge", st.margin], ["Commissions", -st.commissions], ["Part du propriétaire", st.owner_amount]];
    return R.fileReply(R.xlsxBuffer([{ name: "Relevé", rows }]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `releve_${st.id}.xlsx`);
  });

  route("GET", "/transport/settings", TR_READ, (ctx) => {
    const finance = ctx.user.profiles.some((p) => SETTINGS.includes(p));
    return {
      shortage_tolerance: 0.5, shortage_rule: "none", volume_correction: false, shortage_account: null, claim_account: null,
      owner_cost_basis: DB.ownerCostBasis?.[ctx.company] ?? "declared", owner_cost_bases: BASES,
      owner_account: null, owner_income_account: null, commission_account: null,
      activity: null, activities: [], rules: [], can_edit: finance,
      sees_accounts: ctx.user.profiles.some((p) => ACCOUNTING.includes(p)),
    };
  });
  route("PATCH", "/transport/settings", SETTINGS, (ctx) => {
    if (ctx.body.owner_cost_basis) DB.ownerCostBasis = { ...(DB.ownerCostBasis || {}), [ctx.company]: ctx.body.owner_cost_basis };
    return { status: "ok" };
  });
}
