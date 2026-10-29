"use client";

import { Paperclip } from "@/components/icons";
import { Badge, cx } from "@/components/ui";
import { apiDownload } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { ETATS, PRIORITES, type EtatDossier, type Message, type Priorite } from "@/lib/service-client";

export function BadgeEtat({ etat, libelle }: { etat: EtatDossier; libelle?: string }) {
  const e = ETATS.find((x) => x.value === etat);
  return <Badge tone={e?.tone ?? "neutral"}>{libelle ?? e?.label ?? etat}</Badge>;
}

export function BadgePriorite({ priorite }: { priorite: Priorite }) {
  const p = PRIORITES.find((x) => x.value === priorite);
  if (!p || priorite === "normal") return null;
  return <Badge tone={p.tone}>{p.label}</Badge>;
}

export function BadgeRetard({ late }: { late: "first" | "resolution" | null }) {
  if (!late) return null;
  return <Badge tone="danger">{late === "first" ? "Réponse en retard" : "Résolution en retard"}</Badge>;
}

/**
 * Fil d'un dossier. interne : notes (fond doré) et événements (ligne discrète) en plus des messages, avec
 * l'état d'envoi ; lien de téléchargement des pièces par la route du compte (service ou espace client).
 */
export function Fil({ messages, base, interne }: { messages: Message[]; base: string; interne: boolean }) {
  if (!messages.length) return <p className="text-[13px] text-muted">Aucun échange pour l&apos;instant.</p>;
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        if (m.kind === "event") {
          return (
            <li key={m.id} className="flex gap-2 text-[12.5px] text-muted">
              <span className="tabular whitespace-nowrap">{fmtDateTime(m.date)}</span>
              <span className="whitespace-pre-line">{m.body}</span>
            </li>
          );
        }
        const note = m.kind === "note";
        const recu = m.direction === "in";
        return (
          <li
            key={m.id}
            className={cx(
              "rounded-xl border px-4 py-3",
              note ? "border-warn/40 bg-warn-doux" : recu ? "border-line bg-panel-2" : "border-accent/25 bg-panel",
              !interne && !recu && "ml-6",
              !interne && recu && "mr-6",
            )}
          >
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
              <span className="font-semibold text-ink">{m.author}</span>
              <span className="text-muted">{fmtDateTime(m.date)}</span>
              {interne && note && <Badge tone="warn">Note interne</Badge>}
              {interne && m.auto && <Badge>Automatique</Badge>}
              {interne && m.unverified && <Badge tone="danger">Expéditeur non vérifié</Badge>}
              {interne && m.direction === "out" && m.delivery_label && (
                <Badge tone={m.delivery_state === "failed" || m.delivery_state === "not_sent" ? "danger" : m.delivery_state === "waiting_window" || m.delivery_state === "queued" ? "warn" : "neutral"}>
                  {m.delivery_label}
                </Badge>
              )}
            </div>
            {m.body && <p className="whitespace-pre-line break-words text-[13.5px] leading-relaxed text-ink">{m.body}</p>}
            {interne && m.delivery_error && <p className="mt-1 text-[12px] text-danger">{m.delivery_error}</p>}
            {m.attachments.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => void apiDownload(`${base}/attachments/${a.id}`, a.name).catch(() => undefined)} className="inline-flex items-center gap-1 rounded-lg bg-panel-3 px-2 py-1 text-[12.5px] font-medium text-accent hover:underline">
                      <Paperclip className="h-3.5 w-3.5" /> {a.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Étoiles de la satisfaction (1 à 5), en lecture ou en saisie. */
export function Etoiles({ valeur, onChange, taille = "text-[22px]" }: { valeur: number | null; onChange?: (n: number) => void; taille?: string }) {
  return (
    <span className="inline-flex gap-1" role={onChange ? "radiogroup" : undefined} aria-label="Satisfaction sur 5">
      {[1, 2, 3, 4, 5].map((n) => {
        const plein = (valeur ?? 0) >= n;
        const commun = cx(taille, "leading-none", plein ? "text-[#f6b53f]" : "text-line");
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={valeur === n} aria-label={`${n} sur 5`} onClick={() => onChange(n)} className={cx(commun, "rounded focus-visible:outline-2 focus-visible:outline-accent")}>
            ★
          </button>
        ) : (
          <span key={n} aria-hidden className={commun}>
            ★
          </span>
        );
      })}
    </span>
  );
}
