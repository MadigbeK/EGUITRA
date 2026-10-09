import type { Metadata } from "next";
import { readAuthCookies } from "@/lib/auth-cookies";
import { ApiError, apiFetch } from "@/lib/api-server";
import { fmtGNF } from "@/lib/format";

export const metadata: Metadata = { title: "Tableau de bord du dirigeant" };

interface MoisMontant { mois: string; montant: number }
interface Dashboard {
  exercice: number;
  ca_exercice: number; ca_mois: number; ca_mois_precedent: number;
  achats_exercice: number; resultat_exercice: number; tresorerie: number;
  encours_clients: number; encours_clients_echu: number; encours_fournisseurs: number;
  nb_factures_clients_impayees: number; nb_factures_fournisseurs_a_payer: number;
  ca_par_mois: MoisMontant[];
  tresorerie_par_compte: { libelle: string; solde: number }[];
}

function fmtCourt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(".", ",") + " Mds";
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(0) + " M";
  return n.toLocaleString("fr-FR");
}

function Carte({ label, value, meta, tone = "neutral" }: { label: string; value: string; meta?: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const color = { neutral: "#8FA2C0", ok: "#33A98C", warn: "#E0A83C", danger: "#F2777A" }[tone];
  return (
    <div className="rounded-xl border border-[#262d6b] bg-[#10133a] p-5">
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>{label}</div>
      <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-ink">{value}</div>
      {meta && <div className="mt-1 text-xs text-ink-3">{meta}</div>}
    </div>
  );
}

export default async function DashboardDirigeant() {
  const { access } = await readAuthCookies();
  let d: Dashboard | null = null;
  let err: string | null = null;
  try {
    d = await apiFetch<Dashboard>("/finance/dashboard", { accessToken: access! });
  } catch (e) {
    err = e instanceof ApiError ? e.detail : "fetch_failed";
  }

  if (!d) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Tableau de bord du dirigeant</h1>
        <p className="mt-4 text-ink-3">Les indicateurs ne sont pas disponibles pour le moment ({err}). Vérifiez que le noyau est démarré et que la base est initialisée.</p>
      </div>
    );
  }

  const variation = d.ca_mois_precedent ? ((d.ca_mois - d.ca_mois_precedent) / Math.abs(d.ca_mois_precedent)) * 100 : 0;
  const maxMois = Math.max(1, ...d.ca_par_mois.map((m) => m.montant));

  return (
    <div className="p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord du dirigeant</h1>
          <p className="text-sm text-ink-3">Exercice {d.exercice}, données comptabilisées à ce jour, en GNF hors taxes.</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Carte label="Chiffre d'affaires de l'exercice" value={fmtCourt(d.ca_exercice)} meta={fmtGNF(d.ca_exercice)} tone="ok" />
        <Carte label="Chiffre d'affaires du mois" value={fmtCourt(d.ca_mois)} meta={`${variation >= 0 ? "▲" : "▼"} ${Math.abs(variation).toFixed(1)} % vs mois précédent`} tone={variation >= 0 ? "ok" : "warn"} />
        <Carte label="Résultat de l'exercice" value={fmtCourt(d.resultat_exercice)} meta={fmtGNF(d.resultat_exercice)} tone={d.resultat_exercice >= 0 ? "ok" : "danger"} />
        <Carte label="Trésorerie" value={fmtCourt(d.tresorerie)} meta={`${d.tresorerie_par_compte.length} comptes`} tone={d.tresorerie >= 0 ? "neutral" : "danger"} />
        <Carte label="Encours clients" value={fmtCourt(d.encours_clients)} meta={`${d.nb_factures_clients_impayees} factures, dont ${fmtCourt(d.encours_clients_echu)} échu`} tone={d.encours_clients_echu > 0 ? "warn" : "neutral"} />
        <Carte label="Encours fournisseurs" value={fmtCourt(d.encours_fournisseurs)} meta={`${d.nb_factures_fournisseurs_a_payer} factures à payer`} />
        <Carte label="Achats de l'exercice" value={fmtCourt(d.achats_exercice)} meta={fmtGNF(d.achats_exercice)} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-xl border border-[#262d6b] bg-[#10133a] p-5 xl:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-3">Chiffre d'affaires facturé par mois</h2>
          <div className="mt-4 flex h-48 items-end gap-2">
            {d.ca_par_mois.map((m) => (
              <div key={m.mois} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t bg-[#1A9E9E]" style={{ height: `${Math.max(2, (m.montant / maxMois) * 100)}%` }} title={fmtGNF(m.montant)} />
                <span className="text-[10px] text-ink-4">{m.mois.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[#262d6b] bg-[#10133a] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-3">Trésorerie par compte</h2>
          <ul className="mt-4 space-y-2">
            {d.tresorerie_par_compte.map((c) => (
              <li key={c.libelle} className="flex items-center justify-between text-sm">
                <span className="text-ink-2">{c.libelle}</span>
                <span className="font-mono tabular-nums">{fmtGNF(c.solde)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
