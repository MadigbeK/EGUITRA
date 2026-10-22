"use client";

import { ArrowRight, Check, Landmark, XCircle } from "@/components/icons";
import { Badge, IconTile, cx, type Tone } from "@/components/ui";
import { fmtGNF } from "@/lib/format";
import type { FundingRow } from "@/lib/portail-types";
import { jour } from "./outils";

type Etat = FundingRow["state"];

/** Les états d'une demande de financement, dans l'ordre du parcours. */
const PARCOURS: Array<{ key: Etat; court: string }> = [
  { key: "identified", court: "Identifié" },
  { key: "submitted", court: "Déposé" },
  { key: "review", court: "Instruction" },
  { key: "agreed", court: "Accord" },
  { key: "signed", court: "Signé" },
  { key: "disbursed", court: "Décaissé" },
];

const TON: Record<Etat, Tone> = {
  identified: "neutral",
  submitted: "accent",
  review: "accent",
  agreed: "ok",
  signed: "ok",
  disbursed: "ok",
  rejected: "danger",
  withdrawn: "neutral",
};

/** Frise des états : franchis, en cours, à venir. */
export function FriseFinancement({ state }: { state: Etat }) {
  const rang = PARCOURS.findIndex((e) => e.key === state);
  return (
    <ol className="flex items-start" aria-label="Avancement de la demande">
      {PARCOURS.map((e, i) => {
        const franchi = i < rang || (i === rang && state === "disbursed");
        const actuel = i === rang && !franchi;
        return (
          <li key={e.key} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
            {i > 0 && <span aria-hidden className={cx("absolute right-1/2 top-[9px] h-[2px] w-full", i <= rang ? "bg-accent-vif" : "bg-line")} />}
            <span
              aria-hidden
              className={cx(
                "relative z-[1] grid h-5 w-5 place-items-center rounded-full",
                franchi ? "bg-accent-vif text-white" : actuel ? "border-2 border-accent-vif bg-panel ring-4 ring-accent-vif/20" : "border-2 border-line-strong bg-panel",
              )}
            >
              {franchi && <Check className="h-3 w-3" strokeWidth={3} />}
              {actuel && <span className="h-2 w-2 rounded-full bg-accent-vif" />}
            </span>
            <span className={cx("w-full truncate px-0.5 text-center text-[11px] leading-tight", actuel ? "font-semibold text-ink" : franchi ? "text-ink-2" : "text-muted")}>
              {e.court}
              {actuel && <span className="sr-only"> (étape en cours)</span>}
              {franchi && <span className="sr-only"> (franchie)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Carte d'une demande de financement : financeur, instrument, montants, avancement, prochaine étape. */
export function CarteFinancement({ f, devise }: { f: FundingRow; devise: string }) {
  const ferme = f.state === "rejected" || f.state === "withdrawn";
  return (
    <article className={cx("flex flex-col rounded-2xl border bg-panel p-5", ferme ? "border-line/70" : "border-line")}>
      <header className="flex items-start gap-3">
        <IconTile icon={Landmark} teinte={f.state === "rejected" ? "danger" : ferme ? "accent" : TON[f.state] === "ok" ? "jade" : "azur"} />
        <div className="min-w-0 flex-1">
          <h3 className={cx("text-[15px] font-semibold leading-snug", ferme ? "text-ink-2" : "text-ink")}>{f.funder}</h3>
          <p className="text-[12.5px] text-muted">{f.instrument_label}</p>
        </div>
        <Badge tone={TON[f.state]}>{f.state_label}</Badge>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="min-w-0 rounded-xl bg-panel-2 px-3 py-2.5">
          <dt className="text-[12px] text-muted">Montant sollicité</dt>
          <dd className={cx("mt-0.5 font-display text-[16px] font-bold tabular-nums leading-snug", ferme ? "text-ink-2 line-through decoration-1" : "text-ink")}>
            {f.amount_requested ? fmtGNF(f.amount_requested, devise) : "À préciser"}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl bg-panel-2 px-3 py-2.5">
          <dt className="text-[12px] text-muted">Montant accordé</dt>
          <dd className={cx("mt-0.5 font-display text-[16px] font-bold tabular-nums leading-snug", f.amount_granted ? "text-ok-texte" : "text-muted")}>
            {f.amount_granted ? fmtGNF(f.amount_granted, devise) : "Pas encore"}
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        {ferme ? (
          <div className={cx("flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[13px]", f.state === "rejected" ? "bg-danger-doux text-danger" : "bg-panel-2 text-ink-2")}>
            <XCircle className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              {f.state === "rejected" ? "Le financeur n'a pas retenu cette demande" : "Cette piste a été abandonnée"}
              {f.state_date ? `, le ${jour(f.state_date)}.` : "."}
              {f.state === "rejected" && " Votre consultant vous propose d'autres pistes."}
            </span>
          </div>
        ) : (
          <FriseFinancement state={f.state} />
        )}
      </div>

      {!ferme && f.next_step && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent-vif/20 bg-accent-doux/60 px-3 py-2.5 text-[13px] text-ink">
          <ArrowRight className="mt-0.5 h-4 w-4 flex-none text-accent" />
          <span>
            <span className="font-semibold">Prochaine étape : </span>
            {f.next_step}
            {f.next_date && <span className="text-muted">, prévue le {jour(f.next_date)}</span>}
          </span>
        </div>
      )}
      {!ferme && f.state_date && <p className="mt-auto pt-3 text-[12px] text-muted">Étape « {f.state_label} » atteinte le {jour(f.state_date)}.</p>}
    </article>
  );
}
