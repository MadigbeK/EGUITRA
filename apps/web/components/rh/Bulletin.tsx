"use client";

import Link from "next/link";
import { ChevronLeft, Printer } from "@/components/icons";
import { CachetDocument } from "@/components/brand";
import { Button, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDec, fmtGNF, fmtInt } from "@/lib/format";
import { CONTRACT_LABELS, type Payslip, type PayslipLine } from "@/lib/rh-types";
import { accord, moisLong } from "./commun";

const MODE: Record<string, string> = { virement: "Virement", especes: "Espèces", mobile: "Paiement mobile" };

/**
 * Bulletin de paie imprimable (A4) : en-tête de la société, salarié, période, gains, retenues et
 * charges patronales, net à payer en chiffres et en lettres, cumuls de l'année, solde de congés.
 * source : /rh/payslips/<id> (gestion) ou /rh/me/payslips/<id> (le salarié lui-même).
 */
export function BulletinPaie({ source, retour }: { source: string; retour: { href: string; label: string } }) {
  const { data: b, error, mutate } = useApi<Payslip>(source);
  if (error && !b) return <ErrorBox error={error} onRetry={() => mutate()} />;
  if (!b) return <Loading label="Chargement du bulletin…" />;

  const gains = b.lines.filter((l) => l.kind === "gain");
  const retenues = b.lines.filter((l) => l.kind === "deduction");
  const patronales = b.lines.filter((l) => l.kind === "employer");
  const infos = b.lines.filter((l) => l.kind === "info");
  const totalRetenues = retenues.reduce((s, l) => s + l.amount, 0);

  return (
    <div>
      <style>{"@media print { @page { size: A4; margin: 11mm; } .bulletin { box-shadow: none !important; padding: 0 !important; max-width: none !important; } }"}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={retour.href} className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> {retour.label}
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimer
        </Button>
      </div>
      {b.state === "draft" && (
        <div className="no-print mb-4 rounded-xl border border-warn/20 bg-warn-doux px-4 py-2.5 text-sm text-ink">Paie en préparation : ce bulletin peut encore changer.</div>
      )}
      <article className="bulletin mx-auto max-w-[210mm] rounded-[14px] bg-white p-8 text-[12.5px] leading-snug text-[#10241f] shadow-[var(--ombre-feuille)] sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#10241f] pb-4">
          <div>
            <div className="text-[16px] font-bold uppercase tracking-wide">{b.company.name}</div>
            {b.company.address && <div>{b.company.address}</div>}
            <div className="mt-1 text-[11.5px] text-[#4a5e57]">
              {[b.company.nif && `NIF ${b.company.nif}`, b.company.rccm && `RCCM ${b.company.rccm}`, b.company.cnss_employer && `N° employeur CNSS ${b.company.cnss_employer}`].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-[20px] font-bold">Bulletin de paie</div>
            <div className="capitalize">{b.period.label || moisLong(b.month)}</div>
            <div className="text-[11.5px] text-[#4a5e57]">
              Du {fmtDate(b.period.date_from)} au {fmtDate(b.period.date_to)}
              {b.state === "draft" ? " · projet" : ""}
            </div>
          </div>
        </header>

        <section className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <Info label="Salarié" value={b.employee_detail.name} fort />
          <Info label="Matricule" value={b.employee_detail.matricule} />
          <Info label="Fonction" value={b.employee_detail.job_title ?? "–"} />
          <Info label="Catégorie" value={b.employee_detail.category ?? "–"} />
          <Info label="Contrat" value={CONTRACT_LABELS[b.employee_detail.contract as keyof typeof CONTRACT_LABELS] ?? b.employee_detail.contract} />
          <Info label="Embauche" value={`${fmtDate(b.employee_detail.hire_date)} (${fmtDec(b.employee_detail.seniority_years)} ${accord(b.employee_detail.seniority_years, "an")})`} />
          <Info label="N° CNSS" value={b.employee_detail.cnss_number ?? "–"} />
          <Info label="Paiement" value={`${MODE[b.employee_detail.payment_method] ?? b.employee_detail.payment_method}${b.employee_detail.bank_account ? `, ${b.employee_detail.bank_account}` : ""}`} />
          <Info label="Jours payés" value={`${fmtDec(b.worked_days - b.unpaid_days)} sur ${fmtDec(b.month_days)} jours ouvrables`} />
          <Info label="Salaire de base" value={fmtGNF(b.base_salary)} />
        </section>

        <table className="mt-5 w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-y border-[#10241f] text-left">
              <th className="py-1.5 pr-2 font-semibold">Rubrique</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Base</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Taux ou nombre</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Gains</th>
              <th className="py-1.5 text-right font-semibold">Retenues</th>
            </tr>
          </thead>
          <tbody>
            {gains.map((l, i) => (
              <LigneBulletin key={`g${i}`} l={l} colonne="gain" />
            ))}
            <tr className="border-t border-[#c4cfc8] font-semibold">
              <td className="py-1.5" colSpan={3}>
                Salaire brut
              </td>
              <td className="py-1.5 pr-2 text-right font-mono tabular">{fmtInt(b.gross)}</td>
              <td />
            </tr>
            {retenues.map((l, i) => (
              <LigneBulletin key={`r${i}`} l={l} colonne="retenue" />
            ))}
            <tr className="border-t border-[#c4cfc8] font-semibold">
              <td className="py-1.5" colSpan={3}>
                Total des retenues
              </td>
              <td />
              <td className="py-1.5 text-right font-mono tabular">{fmtInt(totalRetenues)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-stretch justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1 text-[11.5px] text-[#4a5e57]">
            <div>Assiette CNSS : {fmtGNF(b.cnss_base)}</div>
            <div>Brut imposable : {fmtGNF(b.taxable_base)} ; base de la RTS : {fmtGNF(b.rts_base)}</div>
            {infos.map((l, i) => (
              <div key={i}>
                {l.name} : {l.amount ? fmtGNF(l.amount) : ""}
              </div>
            ))}
          </div>
          <div className="min-w-[16rem] rounded-[10px] border-2 border-[#10241f] px-4 py-3 text-right">
            <div className="text-[11.5px] font-semibold uppercase tracking-wide">Net à payer</div>
            <div className="font-display text-[22px] font-bold tabular">{fmtGNF(b.net)}</div>
            <div className="mt-1 text-[11px] italic text-[#4a5e57]">{b.net_in_words}</div>
          </div>
        </div>

        {patronales.length > 0 && (
          <table className="mt-5 w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="border-y border-[#c4cfc8] text-left text-[#4a5e57]">
                <th className="py-1 pr-2 font-semibold">Charges patronales (pour information)</th>
                <th className="py-1 pr-2 text-right font-semibold">Base</th>
                <th className="py-1 pr-2 text-right font-semibold">Taux</th>
                <th className="py-1 text-right font-semibold">Montant</th>
              </tr>
            </thead>
            <tbody>
              {patronales.map((l, i) => (
                <tr key={i} className="border-b border-[#eef2ef]">
                  <td className="py-1 pr-2">{l.name}</td>
                  <td className="py-1 pr-2 text-right font-mono tabular">{l.base !== null ? fmtInt(l.base) : ""}</td>
                  <td className="py-1 pr-2 text-right font-mono tabular">{l.rate !== null ? `${fmtDec(l.rate)}${INSECABLE}%` : ""}</td>
                  <td className="py-1 text-right font-mono tabular">{fmtInt(l.amount)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1" colSpan={3}>
                  Coût total pour l&apos;employeur
                </td>
                <td className="py-1 text-right font-mono tabular">{fmtInt(b.employer_cost)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <section className="mt-5 grid gap-3 border-t border-[#c4cfc8] pt-3 text-[11.5px] sm:grid-cols-5">
          <Cumul label="Brut de l'année" value={b.ytd.gross} />
          <Cumul label="CNSS de l'année" value={b.ytd.cnss_employee} />
          <Cumul label="RTS de l'année" value={b.ytd.rts} />
          <Cumul label="Net de l'année" value={b.ytd.net} />
          <div>
            <div className="text-[#4a5e57]">Solde de congés</div>
            <div className="font-semibold tabular">{fmtDec(b.leave_balance)} {accord(b.leave_balance, "jour")}</div>
          </div>
        </section>

        <p className="mt-4 text-[10.5px] text-[#4a5e57]">Conservez ce bulletin sans limitation de durée. Les cotisations et retenues sont calculées selon les taux et le barème en vigueur, paramétrés par la société.</p>
        <CachetDocument className="mt-4" emetteur={b.company.name} date={new Date().toLocaleDateString("fr-FR")} />
      </article>
    </div>
  );
}

function Info({ label, value, fort }: { label: string; value: string; fort?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#eef2ef] py-1">
      <span className="text-[#4a5e57]">{label}</span>
      <span className={fort ? "text-right font-bold" : "text-right"}>{value}</span>
    </div>
  );
}

function LigneBulletin({ l, colonne }: { l: PayslipLine; colonne: "gain" | "retenue" }) {
  const taux = l.rate !== null ? `${fmtDec(l.rate)}${INSECABLE}%` : l.quantity !== null ? fmtDec(l.quantity) : "";
  return (
    <tr className="border-b border-[#eef2ef]">
      <td className="py-1 pr-2">{l.name}</td>
      <td className="py-1 pr-2 text-right font-mono tabular">{l.base !== null ? fmtInt(l.base) : ""}</td>
      <td className="py-1 pr-2 text-right font-mono tabular">{taux}</td>
      <td className="py-1 pr-2 text-right font-mono tabular">{colonne === "gain" ? fmtInt(l.amount) : ""}</td>
      <td className="py-1 text-right font-mono tabular">{colonne === "retenue" ? fmtInt(l.amount) : ""}</td>
    </tr>
  );
}

function Cumul({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[#4a5e57]">{label}</div>
      <div className="font-semibold tabular">{fmtGNF(value)}</div>
    </div>
  );
}
