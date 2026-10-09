import type { Metadata } from "next";
import { readAuthCookies } from "@/lib/auth-cookies";
import { ApiError, apiFetch } from "@/lib/api-server";
import { ReportBuilder, type ReportCatalog } from "./ReportBuilder";

/* ════════════════════════════════════════════════════════════════════════════
   /finance/rapports — PIERRE ANGULAIRE : builder de rapports BI pour le directeur.
   Server component léger : récupère le catalogue (rapports + presets) côté
   serveur via Bearer cookie, délègue tout l'interactif à <ReportBuilder/>.
   ════════════════════════════════════════════════════════════════════════════ */

export const metadata: Metadata = { title: "Rapports · EGUITRA Finance" };

export default async function AdminRapportsPage() {
  const { access } = await readAuthCookies();

  let catalog: ReportCatalog | null = null;
  let err: string | null = null;
  try {
    catalog = await apiFetch<ReportCatalog>("/reports/catalog", { accessToken: access! });
  } catch (e) {
    err = e instanceof ApiError ? e.detail : "fetch_failed";
  }

  return <ReportBuilder catalog={catalog} catalogError={err} />;
}
