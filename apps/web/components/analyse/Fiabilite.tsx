"use client";

import Link from "next/link";
import { type CSSProperties } from "react";
import { ArrowUpRight, CheckCircle2, AlertTriangle, XCircle } from "@/components/icons";
import { Anneau, Badge, Card, cx } from "@/components/ui";
import { AttenteSection, ErreurLecture, Constats, EnTeteSection, FournisseurTheme, GardeSociete, Vide, fmtValeur, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { GroupeFiabilite, Status } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

const ETAT: Record<Status, { label: string; tone: "ok" | "warn" | "danger" | "neutral"; icon: typeof CheckCircle2; couleur: string }> = {
  good: { label: "Conforme", tone: "ok", icon: CheckCircle2, couleur: "var(--g-jade)" },
  warn: { label: "À corriger", tone: "warn", icon: AlertTriangle, couleur: "var(--warn-vif)" },
  bad: { label: "Bloquant", tone: "danger", icon: XCircle, couleur: "var(--danger-vif)" },
  neutral: { label: "Sans objet", tone: "neutral", icon: CheckCircle2, couleur: "var(--muted)" },
};
const ORDRE: Record<Status, number> = { bad: 0, warn: 1, neutral: 3, good: 2 };

/** Fiabilité des données : score et contrôles. Si les chiffres sont douteux, le reste l'est aussi. */
export function Fiabilite() {
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe">
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeFiabilite>(`/analyse/groupe/fiabilite${query}`);
  const checks = d?.checks ?? [];
  const mauvais = checks.filter((c) => c.status === "bad");
  const moyens = checks.filter((c) => c.status === "warn");
  const bons = checks.filter((c) => c.status === "good");
  const sansObjet = checks.filter((c) => c.status === "neutral");
  const reponse = d && (
    <>
      Les données méritent une confiance de <strong className="font-semibold text-ink">{Math.round(d.score)} / 100</strong> : {bons.length} contrôle{bons.length > 1 ? "s" : ""} sur {checks.length} conforme{bons.length > 1 ? "s" : ""}, {moyens.length} à corriger
      {mauvais.length > 0 && <>, {mauvais.length} bloquant{mauvais.length > 1 ? "s" : ""} ({mauvais.map((c) => c.label.toLowerCase()).join(", ")})</>}
      {sansObjet.length > 0 && <>, {sansObjet.length} sans objet</>}. Les analyses de rentabilité par activité, de transport et de trésorerie en dépendent directement.
    </>
  );
  return (
    <div>
      <EnTeteSection exporter={`/analyse/groupe/fiabilite.xlsx${query}`} question="Peut-on se fier aux chiffres ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErreurLecture error={error} onRetry={() => void mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Score de fiabilité" className="xl:col-span-4">
              <div className="flex items-center gap-5">
                <Anneau value={d.score} taille={132} epaisseur={12} couleur={d.score >= 90 ? "var(--g-jade)" : d.score >= 70 ? "var(--warn-vif)" : "var(--danger-vif)"} sous="sur 100" />
                <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                  <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-jade" /> {bons.length} conforme{bons.length > 1 ? "s" : ""}</li>
                  <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-warn-vif" /> {moyens.length} à corriger</li>
                  <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-danger-vif" /> {mauvais.length} bloquant{mauvais.length > 1 ? "s" : ""}</li>
                  {sansObjet.length > 0 && <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line-strong" /> {sansObjet.length} sans objet</li>}
                </ul>
              </div>
              <p className="mt-4 text-[12.5px] leading-relaxed text-muted">Chaque contrôle reçoit une note de 0 à 100 selon l&apos;écart à sa cible ; le score est leur moyenne. Un contrôle sans objet (pas de relevé bancaire, pas de rotation) ne compte pas.</p>
            </Card>
            <Card title="Notes des contrôles" className="xl:col-span-8">
              {checks.length === 0 ? (
                <Vide titre="Aucun contrôle" />
              ) : (
                <ul className="space-y-2">
                  {[...checks]
                    .sort((a, b) => ORDRE[a.status] - ORDRE[b.status] || (a.score ?? 100) - (b.score ?? 100))
                    .map((c, i) => (
                      <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_3rem] items-center gap-3 text-[12.5px]">
                        <span className="truncate font-medium text-ink-2" title={c.label}>{c.label}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-panel-3">
                          <span className="n-pousser-x block h-full rounded-full" style={{ width: `${Math.max(2, c.score ?? 0)}%`, background: ETAT[c.status]?.couleur ?? "var(--muted)", "--i": i } as CSSProperties} />
                        </span>
                        <span className="text-right tabular text-muted">{c.score === null ? "–" : fmtInt(c.score)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Les contrôles, un par un" padded={false}>
            {checks.length === 0 ? (
              <Vide titre="Aucun contrôle" />
            ) : (
              <ol className="divide-y divide-line">
                {[...checks]
                  .sort((a, b) => ORDRE[a.status] - ORDRE[b.status] || (a.score ?? 100) - (b.score ?? 100))
                  .map((c, i) => {
                    const e = ETAT[c.status] ?? ETAT.neutral;
                    const I = e.icon;
                    const atteint = c.score ?? (c.status === "good" ? 100 : 0);
                    return (
                      <li key={c.key} className="n-entree grid gap-x-5 gap-y-2 px-5 py-3.5 md:grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center" style={{ "--i": i } as CSSProperties}>
                        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-[10px]" style={{ background: `color-mix(in oklab, ${e.couleur} 16%, var(--panel))`, color: e.couleur }}>
                          <I className="h-4.5 w-4.5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13.5px] font-semibold text-ink">{c.label}</span>
                            <Badge tone={e.tone}>{e.label}</Badge>
                          </div>
                          <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{c.detail}</div>
                          {c.action && c.status !== "good" && <div className="mt-1 text-[12.5px] leading-snug text-ink-2"><span className="font-semibold">Action : </span>{c.action}</div>}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-baseline justify-between text-[12.5px]">
                            <span className={cx("font-display text-[17px] font-bold tabular", c.status === "bad" ? "text-danger" : "text-ink")}>{c.value === null ? "–" : fmtValeur(c.value, c.unit)}</span>
                            <span className="text-muted">{c.target === null ? "sans cible" : `cible ${fmtValeur(c.target, c.unit)}`}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-3">
                            <div className="n-pousser-x h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, atteint))}%`, background: e.couleur, "--i": i } as CSSProperties} />
                          </div>
                        </div>
                        {c.link && c.status !== "good" ? (
                          <Link href={c.link} className="no-print inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
                            Corriger <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
              </ol>
            )}
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
