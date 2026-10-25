"use client";

/**
 * Résumé d'un événement : la déclaration, les personnes en cause, les conséquences, les échéances du
 * niveau (§9.1) et les photos et pièces (POST, DELETE /hsseq/attachments). Confidentialité (§9.4) :
 * aucune donnée médicale ni résultat d'alcootest n'est tenu ni affiché ici.
 */

import { useState, type ReactNode } from "react";
import { Download, FileText, Trash2 } from "@/components/icons";
import { Button, Card, FileButton, Notice, Tag, demanderConfirmation } from "@/components/ui";
import { ROLE_PERSONNE, nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { INSECABLE, fmtGNF, fmtInt, pluriel } from "@/lib/format";
import type { Attachment, Event as Evenement } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { EcheanceEnquete, NATURE_PERSONNE, SOURCE, estResponsableHsseq, fmtJourHeure, messageRefus, urlPiece, useReferentiels } from "./commun";

const FORMATS = ["image/jpeg", "image/png", "application/pdf"];
const TAILLE_MAX = 8 * 1024 * 1024;

function Ligne({ terme, children }: { terme: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-line/70 py-2 last:border-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13px] text-muted">{terme}</dt>
      <dd className="text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

export function Resume({ e, onRecharger }: { e: Evenement; onRecharger: () => void }) {
  const gps = e.latitude !== null && e.longitude !== null;
  const ecartSynchro = e.source === "terrain" && e.synced_at && e.reported_at && Math.abs(Date.parse(e.synced_at) - Date.parse(e.reported_at)) > 5 * 60_000;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Déclaration">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{e.description || "Pas de description."}</p>
          <dl className="mt-4">
            <Ligne terme="Survenu le">{fmtJourHeure(e.occurred_at)}</Ligne>
            <Ligne terme="Site">{e.site?.name ?? "–"}</Ligne>
            <Ligne terme="Lieu">{e.location ?? "–"}</Ligne>
            {gps && (
              <Ligne terme="Position">
                <span className="tabular">
                  {e.latitude!.toLocaleString("fr-FR", { maximumFractionDigits: 5 })}, {e.longitude!.toLocaleString("fr-FR", { maximumFractionDigits: 5 })}
                </span>
                {e.gps_accuracy !== null && <span className="text-muted">{` (précision ${fmtInt(e.gps_accuracy)}${INSECABLE}m)`}</span>}
              </Ligne>
            )}
            <Ligne terme="Véhicule">{e.vehicle ? `${nomVehicule(e.vehicle)}${e.vehicle.plate ? `, ${e.vehicle.plate}` : ""}` : "–"}</Ligne>
            <Ligne terme="Rotation">
              {e.rotation ? (
                <>
                  {nomRotation(e.rotation)}
                  <span className="text-muted">{`${e.rotation.route_name ? `, ${e.rotation.route_name}` : ""}, chargée le ${new Date(`${e.rotation.date_loading}T00:00:00`).toLocaleDateString("fr-FR")}`}</span>
                </>
              ) : (
                "–"
              )}
            </Ligne>
            <Ligne terme="Déclaré par">{e.reported_by?.name ?? "–"}</Ligne>
            <Ligne terme="Saisie">
              {SOURCE[e.source]}, le {fmtJourHeure(e.reported_at)}
              {e.offline && <span className="text-muted">, hors ligne</span>}
              {ecartSynchro && <span className="block text-[12.5px] text-muted">Reçue par le serveur le {fmtJourHeure(e.synced_at)}</span>}
            </Ligne>
          </dl>
        </Card>

        <div className="space-y-5">
          <Card title="Échéances">
            <dl>
              <Ligne terme="Enquête">
                <EcheanceEnquete date={e.deadlines.investigation_due} enRetard={e.investigation_overdue} />
              </Ligne>
              <Ligne terme="Donneur d'ordre">
                {e.deadlines.client_notified_at ? (
                  <>Informé le {fmtJourHeure(e.deadlines.client_notified_at)}</>
                ) : e.deadlines.client_notice_due ? (
                  <>À informer au plus tard le {new Date(`${e.deadlines.client_notice_due.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR")}</>
                ) : (
                  <span className="text-muted">Sans objet</span>
                )}
              </Ligne>
              {e.classified_at && <Ligne terme="Classé le">{`${fmtJourHeure(e.classified_at)}${e.classified_by ? `, par ${e.classified_by.name}` : ""}`}</Ligne>}
              {e.closed_at && <Ligne terme="Clôturé le">{`${fmtJourHeure(e.closed_at)}${e.closed_by ? `, par ${e.closed_by.name}` : ""}`}</Ligne>}
            </dl>
          </Card>
          <Card title="Conséquences">
            <dl>
              <Ligne terme="Arrêt de travail">{e.lost_time ? `Oui, ${pluriel(e.days_lost, "jour perdu", "jours perdus")}` : "Non"}</Ligne>
              <Ligne terme="Véhicule immobilisé">{e.vehicle_immobilized ? "Oui" : "Non"}</Ligne>
              <Ligne terme="Coût total">{fmtGNF(e.total_cost)}</Ligne>
              <Ligne terme="Actions ouvertes">{fmtInt(e.open_actions)}</Ligne>
            </dl>
          </Card>
        </div>
      </div>

      <Card title="Personnes en cause">
        {e.people.length === 0 ? (
          <p className="text-[13px] text-muted">Aucune personne citée.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {e.people.map((p, i) => (
              <li key={`${p.kind}-${p.id ?? p.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13.5px]">
                <span className="font-semibold text-ink">{p.name}</span>
                <Tag>{NATURE_PERSONNE[p.kind]}</Tag>
                <span className="text-ink-2">{ROLE_PERSONNE[p.role] ?? p.role}</span>
                {p.days_off ? <span className="text-muted">{`Arrêt de ${pluriel(p.days_off, "jour")}`}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-muted">Aucune donnée médicale n'est tenue dans la fiche ; l'alcootest ne se lit qu'en statut, dans les contrôles.</p>
      </Card>

      <Pieces e={e} onRecharger={onRecharger} />
    </div>
  );
}

/* ─── Photos et pièces ────────────────────────────────────────────────── */

function Pieces({ e, onRecharger }: { e: Evenement; onRecharger: () => void }) {
  const { data: referentiels } = useReferentiels();
  const { data: me } = useApi<Me>("/auth/me");
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const hsseq = estResponsableHsseq(referentiels);
  const ouverte = e.status !== "closed";
  // Dépôt : déclarant tant que la fiche est déclarée, Responsable HSSEQ avant clôture (droits de la fiche).
  const deposer = ouverte && (e.rights.can_edit || e.rights.can_approve);
  // Retrait : auteur de la pièce ou Responsable HSSEQ, tant que la fiche n'est pas close (§11).
  const retirable = (a: Attachment) => ouverte && (hsseq || (me !== undefined && a.created_by.id === me.id));

  async function deposerFichier(f: File) {
    setRefus(null);
    if (!FORMATS.includes(f.type)) return setRefus(`${f.name} : formats acceptés JPEG, PNG ou PDF.`);
    if (f.size > TAILLE_MAX) return setRefus(`${f.name} : 8${INSECABLE}Mo au plus.`);
    const form = new FormData();
    form.append("file", f, f.name);
    form.append("model", "event");
    form.append("id", String(e.id));
    setEnvoi(true);
    try {
      await apiUpload<Attachment>("/hsseq/attachments", form);
      onRecharger();
    } catch (err) {
      setRefus(messageRefus(err, "La pièce n'a pas été jointe."));
    } finally {
      setEnvoi(false);
    }
  }

  async function retirer(a: Attachment) {
    if (!(await demanderConfirmation(`Retirer la pièce « ${a.name} » ?`, { action: "Retirer", danger: true }))) return;
    setRefus(null);
    try {
      await apiSend("DELETE", `/hsseq/attachments/${a.id}`);
      onRecharger();
    } catch (err) {
      setRefus(messageRefus(err, "La pièce n'a pas été retirée."));
    }
  }

  async function telecharger(a: Attachment) {
    setRefus(null);
    try {
      await apiDownload(a.url, a.name);
    } catch (err) {
      setRefus(messageRefus(err, "La pièce n'a pas été téléchargée."));
    }
  }

  return (
    <Card title="Photos et pièces" actions={deposer ? <FileButton small label={envoi ? "Envoi…" : "Joindre une photo"} accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onFile={deposerFichier} /> : undefined}>
      {refus && (
        <div className="mb-3">
          <Notice tone="danger">{refus}</Notice>
        </div>
      )}
      {e.attachments.length === 0 ? (
        <p className="text-[13px] text-muted">Aucune pièce jointe.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {e.attachments.map((a) => (
            <li key={a.id} className="overflow-hidden rounded-xl bg-panel-2">
              {a.is_photo ? (
                <img src={urlPiece(a.url)} alt={a.caption ?? `Photo ${a.name}`} loading="lazy" className="aspect-[4/3] w-full bg-panel-3 object-cover" />
              ) : (
                <div className="grid aspect-[4/3] place-items-center text-muted">
                  <FileText className="h-8 w-8" />
                </div>
              )}
              <div className="space-y-0.5 px-2.5 py-2">
                <p className="truncate text-[12.5px] font-medium text-ink" title={a.name}>
                  {a.caption ?? a.name}
                </p>
                <p className="truncate text-[11.5px] text-muted">{`${a.created_by.name}, ${fmtJourHeure(a.created_at)}`}</p>
                <div className="flex gap-1 pt-1">
                  <Button variant="ghost" size="sm" aria-label={`Télécharger ${a.name}`} title="Télécharger" onClick={() => telecharger(a)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  {retirable(a) && (
                    <Button variant="ghost" size="sm" aria-label={`Retirer ${a.name}`} title="Retirer" onClick={() => retirer(a)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
