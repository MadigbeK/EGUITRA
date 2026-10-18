"use client";

import Link from "next/link";
import { type CSSProperties } from "react";
import { ArrowUpRight, CheckCircle2, AlertTriangle, XCircle } from "@/components/icons";
import { Anneau, AreaChart, Badge, Card, ErrorBox, cx } from "@/components/ui";
import { AttenteSection, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtValeur, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { GroupeFiabilite, Status } from "@/lib/analyse-types";

const ETAT: Record<Status, { label: string; tone: "ok" | "warn" | "danger" | "neutral"; icon: typeof CheckCircle2; couleur: string }> = {
  good: { label: "Conforme", tone: "ok", icon: CheckCircle2, couleur: "var(--g-jade)" },
  warn: { label: "À corriger", tone: "warn", icon: AlertTriangle, couleur: "var(--warn-vif)" },
  bad: { label: "Bloquant", tone: "danger", icon: XCircle, couleur: "var(--danger-vif)" },
  neutral: { label: "Sans objet", tone: "neutral", icon: CheckCircle2, couleur: "var(--muted)" },
};

/** Fiabilité des données : score, contrôles pondérés, historique. Si les chiffres sont douteux, le reste l'est aussi. */
export function Fiabilite() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeFiabilite>(`/analyse/groupe/fiabilite${query}`);
  const mauvais = d?.checks.filter((c) => c.status === "bad") ?? [];
  const moyens = d?.checks.filter((c) => c.status === "warn") ?? [];
  const reponse = d && (
    <>
      Les données méritent une confiance de <strong className="font-semibold text-ink">{d.score} / 100</strong> : {d.checks.filter((c) => c.status === "good").length} contrôles sur {d.checks.length} sont conformes, {moyens.length} à corriger
      {mauvais.length > 0 && <>, et {mauvais.length} bloquant{mauvais.length > 1 ? "s" : ""} ({mauvais.map((c) => c.label.toLowerCase()).join(", ")})</>}. Les analyses de rentabilité par activité et de trésorerie en dépendent directement.
    </>
  );
  return (
    <div>
      <EnTeteSection question="Peut-on se fier aux chiffres ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Score de fiabilité" className="xl:col-span-4">
              <div className="flex items-center gap-5">
                <Anneau value={d.score} taille={132} epaisseur={12} couleur={d.score >= 90 ? "var(--g-jade)" : d.score >= 75 ? "var(--warn-vif)" : "var(--danger-vif)"} sous="sur 100" />
                <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                  <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-jade" /> {d.checks.filter((c) => c.status === "good").length} contrôles conformes</li>
                  <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-warn-vif" /> {moyens.length} à corriger</li>
                  <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-danger-vif" /> {mauvais.length} bloquant{mauvais.length > 1 ? "s" : ""}</li>
                </ul>
              </div>
              <p className="mt-4 text-[12.5px] leading-relaxed text-muted">Chaque contrôle vaut 100 (conforme), 60 (à corriger) ou 20 (bloquant), pondéré par son poids : les contrôles qui faussent les marges ou la trésorerie pèsent trois fois plus qu&apos;un retard de saisie.</p>
            </Card>
            <Card title="Douze mois de fiabilité" className="xl:col-span-8">
              <AreaChart label="Score de fiabilité mensuel" labels={d.history.map((h) => moisCourt(h.month, true))} series={[{ key: "score", label: "Score", values: d.history.map((h) => h.score), color: "var(--accent-vif)" }]} height={220} format={(v) => `${Math.round(v)} / 100`} formatAxis={(v) => String(Math.round(v))} />
            </Card>
          </div>

          <Card title="Les contrôles, un par un" padded={false}>
            <ol className="divide-y divide-line">
              {[...d.checks].sort((a, b) => ({ bad: 0, warn: 1, neutral: 2, good: 3 })[a.status] - ({ bad: 0, warn: 1, neutral: 2, good: 3 })[b.status] || b.weight - a.weight).map((c, i) => {
                const e = ETAT[c.status];
                const I = e.icon;
                const atteint = c.unit === "pct" ? Math.min(100, (c.value / Math.max(1, c.target)) * 100) : c.target === 0 ? (c.value === 0 ? 100 : Math.max(8, 100 - c.value * 10)) : Math.min(100, (Math.min(c.value, c.target) / Math.max(1, c.target)) * 100);
                return (
                  <li key={c.key} className="n-entree grid gap-x-5 gap-y-2 px-5 py-3.5 md:grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center" style={{ "--i": i } as CSSProperties}>
                    <span aria-hidden className="grid h-9 w-9 place-items-center rounded-[10px]" style={{ background: `color-mix(in oklab, ${e.couleur} 16%, var(--panel))`, color: e.couleur }}>
                      <I className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-ink">{c.label}</span>
                        <Badge tone={e.tone}>{e.label}</Badge>
                        <span className="text-[11px] text-muted" title="Poids dans le score">
                          {"●".repeat(c.weight)}
                          {"○".repeat(3 - c.weight)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{c.detail}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between text-[12.5px]">
                        <span className={cx("font-display text-[17px] font-bold tabular", c.status === "bad" ? "text-danger" : "text-ink")}>{fmtValeur(c.value, c.unit)}</span>
                        <span className="text-muted">cible {fmtValeur(c.target, c.unit)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-3">
                        <div className="n-pousser-x h-full rounded-full" style={{ width: `${atteint}%`, background: e.couleur, "--i": i } as CSSProperties} />
                      </div>
                    </div>
                    {c.link ? (
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
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
