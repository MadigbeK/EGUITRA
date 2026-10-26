"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Calendar, CheckCircle2, Clock, Link2, MapPin, Plus, XCircle } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import { Intitule, LectureSeule, Recherche, correspond, listeBornee, majuscule, pluriel, saisieModifiee, useEcriture, useEnvoiFenetre, useMaintenant, useMonId, useRetour } from "@/components/portail/cabinet/outils";
import { ajouterAuCalendrier, dateLongue, heure, quand, versIso, versLocal } from "@/components/portail/commun";
import { Badge, Button, ErrorBox, FEUILLE, Field, Input, Loading, Modal, Notice, PageHeader, Segmented, Select, Textarea, cx, demanderConfirmation, type Tone } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtInt } from "@/lib/format";
import type { Cibles, MeetingMode, MeetingRow, MeetingState } from "@/lib/portail-types";

const ETAT: Record<MeetingState, Tone> = { requested: "warn", confirmed: "accent", done: "ok", declined: "danger", cancelled: "neutral" };

const DUREES = [15, 30, 45, 60, 90, 120, 180, 240];

/** Historique rendu par le noyau (MEETING_HISTORY_LIMIT) : les demandes et les rendez-vous confirmés sont toujours tous là. */
const LIMITE_HISTORIQUE = 300;

const HISTORIQUE: MeetingState[] = ["done", "declined", "cancelled"];

function duree(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}

const OPTIONS_DUREE = DUREES.map((d) => ({ value: d, label: duree(d) }));

function passee(iso: string | null | undefined, maintenant: number) {
  return Boolean(iso && new Date(iso).getTime() < maintenant);
}

type Modale = { kind: "repondre" | "annuler" | "tenu" | "compte_rendu"; m: MeetingRow } | { kind: "planifier" } | null;

export default function RendezVousPage() {
  const ecriture = useEcriture();
  const monId = useMonId();
  const { data, error, mutate } = useApi<MeetingRow[]>("/axispro/portail/rendez-vous", { refreshInterval: 60_000 });
  const { data: cibles, error: erreurCibles, mutate: majCibles } = useApi<Cibles>(ecriture ? "/axispro/portail/cibles" : null);
  const [qui, setQui] = useState<"tous" | "miens">("tous");
  const [q, setQ] = useState("");
  const [modale, setModale] = useState<Modale>(null);
  const [historique, setHistorique] = useState(15);
  const { agir, bandeau } = useRetour();
  const maintenant = useMaintenant();

  const rows = (data ?? []).filter((m) => (qui === "tous" || m.consultant?.id === monId) && correspond(q, m.subject, m.dossier.reference, m.dossier.name, m.requested_by, m.consultant?.name));
  const demandes = rows.filter((m) => m.state === "requested").sort((a, b) => a.create_date.localeCompare(b.create_date));
  const confirmes = rows.filter((m) => m.state === "confirmed").sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const passes = rows.filter((m) => HISTORIQUE.includes(m.state)).sort((a, b) => (b.start ?? b.create_date).localeCompare(a.start ?? a.create_date));
  const borne = listeBornee((data ?? []).filter((m) => HISTORIQUE.includes(m.state)).length, LIMITE_HISTORIQUE, "rendez-vous");

  async function apresAction(texte: string) {
    setModale(null);
    await agir(() => mutate(), texte);
  }

  return (
    <div>
      <PageHeader
        title="Rendez-vous des porteurs"
        subtitle="Les demandes des porteurs, les rendez-vous confirmés et leur compte rendu. Le porteur est prévenu sur son portail à chaque réponse du cabinet."
        actions={
          ecriture ? (
            <Button variant="primary" disabled={!cibles} onClick={() => setModale({ kind: "planifier" })}>
              <Plus className="h-4 w-4" /> Planifier un rendez-vous
            </Button>
          ) : undefined
        }
      />
      <OngletsPortail />
      <div className="space-y-4">
        <LectureSeule ecriture={ecriture} />
        {bandeau}
        {erreurCibles && <ErrorBox titre="Liste des dossiers indisponible : impossible de planifier un rendez-vous." error={erreurCibles} onRetry={() => void majCibles()} />}
        {error && <ErrorBox titre={data ? "Rechargement impossible : les rendez-vous affichés peuvent dater." : undefined} error={error} onRetry={() => void mutate()} />}
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Rendez-vous affichés"
            value={qui}
            onChange={setQui}
            options={[
              { key: "tous", label: "Tous les consultants" },
              { key: "miens", label: "Les miens" },
            ]}
          />
          <Recherche className="w-full sm:w-80" label="Rechercher un rendez-vous" placeholder="Objet, dossier, porteur" value={q} onChange={setQ} />
        </div>
        {!data ? (
          !error && <Loading label="Chargement des rendez-vous…" />
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
            <Colonne titre="Demandés" compte={demandes.length} detail="À confirmer ou à décliner" vide="Aucune demande en attente.">
              {demandes.map((m) => (
                <Carte key={m.id} m={m}>
                  {ecriture && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="primary" size="sm" onClick={() => setModale({ kind: "repondre", m })}>
                        Répondre
                      </Button>
                    </div>
                  )}
                </Carte>
              ))}
            </Colonne>
            <Colonne titre="Confirmés à venir" compte={confirmes.length} detail="Et ceux qui restent à clôturer" vide="Aucun rendez-vous confirmé.">
              {confirmes.map((m) => {
                const passe = passee(m.end, maintenant);
                return (
                  <Carte key={m.id} m={m} alerte={passe && ecriture ? "Date passée : marquez-le tenu avec son compte rendu, ou annulez-le." : undefined}>
                    <div className="flex flex-wrap gap-1.5">
                      {ecriture && (
                        <Button variant={passe ? "primary" : "secondary"} size="sm" onClick={() => setModale({ kind: "tenu", m })}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Marquer tenu
                        </Button>
                      )}
                      {m.start && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => ajouterAuCalendrier({ titre: `${m.subject} (${m.dossier.reference})`, debut: m.start ?? "", fin: m.end, lieu: m.location ?? m.online_url, description: m.agenda, uid: `rdv-${m.id}` })}
                        >
                          <Calendar className="h-3.5 w-3.5" /> Agenda
                        </Button>
                      )}
                      {ecriture && (
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setModale({ kind: "annuler", m })}>
                          <XCircle className="h-3.5 w-3.5" /> Annuler
                        </Button>
                      )}
                    </div>
                  </Carte>
                );
              })}
            </Colonne>
            <Colonne titre="Historique" compte={passes.length} detail="Tenus, déclinés ou annulés" vide="Aucun rendez-vous passé." note={borne}>
              {passes.slice(0, historique).map((m) => (
                <Carte key={m.id} m={m}>
                  {m.state === "done" && ecriture && (
                    <Button variant="ghost" size="sm" onClick={() => setModale({ kind: "compte_rendu", m })}>
                      {m.minutes ? "Modifier le compte rendu" : "Rédiger le compte rendu"}
                    </Button>
                  )}
                </Carte>
              ))}
              {passes.length > historique && (
                <li>
                  <Button variant="ghost" className="w-full" onClick={() => setHistorique((n) => n + 30)}>
                    Afficher plus ({pluriel(passes.length - historique, "restant")})
                  </Button>
                </li>
              )}
            </Colonne>
          </div>
        )}
      </div>

      {modale?.kind === "repondre" && <Repondre m={modale.m} maintenant={maintenant} onClose={() => setModale(null)} onDone={apresAction} />}
      {modale?.kind === "annuler" && <Annuler m={modale.m} onClose={() => setModale(null)} onDone={apresAction} />}
      {(modale?.kind === "tenu" || modale?.kind === "compte_rendu") && <CompteRendu m={modale.m} mode={modale.kind} onClose={() => setModale(null)} onDone={apresAction} />}
      {modale?.kind === "planifier" && cibles && <Planifier cibles={cibles} onClose={() => setModale(null)} onDone={apresAction} />}
    </div>
  );
}

function Colonne({ titre, compte, detail, vide, note, children }: { titre: string; compte: number; detail: string; vide: string; note?: string | null; children: ReactNode }) {
  return (
    <section aria-label={titre} className="min-w-0 rounded-[20px] bg-panel-2/70 p-3 ring-1 ring-line/70">
      <header className="flex items-baseline justify-between gap-2 px-2 pb-3 pt-1">
        <div>
          <h2 className="font-display text-[16px] font-[620] text-ink">{titre}</h2>
          <p className="text-[12px] text-muted">{detail}</p>
        </div>
        <span className="rounded-full bg-panel px-2 py-0.5 text-[12px] font-semibold tabular text-ink-2 ring-1 ring-line">{fmtInt(compte)}</span>
      </header>
      {note && <p className="mb-3 rounded-lg bg-warn-doux px-3 py-1.5 text-[12px] font-medium text-warn">{note}</p>}
      {compte === 0 ? <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[13px] text-muted">{vide}</p> : <ul className="space-y-3">{children}</ul>}
    </section>
  );
}

function Carte({ m, alerte, children }: { m: MeetingRow; alerte?: string; children?: ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <li className={cx(FEUILLE, "p-4")}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-semibold leading-snug text-ink">{m.subject}</h3>
        <Badge tone={ETAT[m.state]}>{m.state_label}</Badge>
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted">
        <Link href={`/axispro/dossiers/${m.dossier.id}`} className="font-semibold text-accent hover:underline">
          {m.dossier.reference}
        </Link>{" "}
        {m.dossier.name}
      </p>
      <dl className="mt-2.5 space-y-1 text-[13px] text-ink-2">
        {m.start ? (
          <div className="flex items-start gap-2">
            <dt className="sr-only">Date</dt>
            <Clock aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none text-muted" />
            <dd>
              <span className="font-medium text-ink">{majuscule(dateLongue(m.start))}</span>
              {m.end ? ` à ${heure(m.end)}` : ""} ({duree(m.duration)})
            </dd>
          </div>
        ) : null}
        <div className="flex items-start gap-2">
          <dt className="sr-only">Forme et lieu</dt>
          <MapPin aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none text-muted" />
          <dd>
            {m.mode_label}
            {m.location ? `, ${m.location}` : ""}
          </dd>
        </div>
        {m.online_url && (
          <div className="flex items-start gap-2">
            <dt className="sr-only">Lien de visioconférence</dt>
            <Link2 aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none text-muted" />
            <dd className="min-w-0">
              <a href={m.online_url} target="_blank" rel="noopener noreferrer" className="block truncate text-accent hover:underline">
                {m.online_url.replace(/^https:\/\//, "")}
              </a>
            </dd>
          </div>
        )}
      </dl>
      {m.state === "requested" && m.slots.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[12px] font-semibold text-muted">Créneaux proposés par le porteur</div>
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-2">
            {m.slots.map((s) => (
              <li key={s}>{majuscule(dateLongue(s))}</li>
            ))}
          </ul>
        </div>
      )}
      {m.agenda && (
        <p className="mt-2.5 whitespace-pre-wrap rounded-lg bg-panel-2 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">Points à aborder : </span>
          {m.agenda}
        </p>
      )}
      {m.cabinet_note && (
        <p className="mt-2 text-[12.5px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">{m.state === "cancelled" && m.cancelled_by === "porteur" ? "Motif du porteur : " : "Message du cabinet : "}</span>« {m.cabinet_note} »
        </p>
      )}
      {m.minutes && (
        <div className="mt-2">
          <button type="button" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)} className="text-[12.5px] font-semibold text-accent hover:underline">
            {ouvert ? "Masquer le compte rendu" : "Lire le compte rendu"}
          </button>
          {ouvert && <p className="mt-1.5 whitespace-pre-wrap rounded-lg border-l-2 border-ok bg-ok-doux/50 px-3 py-2 text-[13px] leading-relaxed text-ink-2">{m.minutes}</p>}
        </div>
      )}
      {alerte && (
        <p className="mt-2.5 rounded-lg bg-warn-doux px-3 py-1.5 text-[12.5px] font-medium text-warn" role="status">
          {alerte}
        </p>
      )}
      <p className="mt-2.5 text-[11.5px] text-muted">
        {m.requested_by_me ? "Planifié par vous" : `Demandé par ${m.requested_by}`} {quand(m.create_date)}
        {m.consultant ? `. Consultant : ${m.consultant.name}` : ""}.
      </p>
      {children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
    </li>
  );
}

/* ─── Traitements ──────────────────────────────────────────────────────── */

/**
 * Fenêtres de traitement : un seul envoi à la fois, l'erreur reste dans la fenêtre, qui ne se ferme
 * pas pendant l'envoi ; une saisie modifiée demande confirmation avant d'être abandonnée.
 */
type Traitement = { onClose: () => void; onDone: (message: string) => Promise<void> };

function Repondre({ m, maintenant, onClose, onDone }: Traitement & { m: MeetingRow; maintenant: number }) {
  const futurs = m.slots.filter((s) => !passee(s, maintenant));
  const [initial] = useState(() => ({
    creneau: futurs[0] ?? "autre",
    autre: "",
    duration: String(DUREES.includes(m.duration) ? m.duration : 60),
    location: m.location ?? "",
    url: m.online_url ?? "",
    note: "",
  }));
  const [f, setF] = useState(initial);
  const set = <K extends keyof typeof initial>(k: K, v: (typeof initial)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { envoi, occupe, erreur, setErreur, envoyer, fermer } = useEnvoiFenetre(saisieModifiee(f, initial), onClose);
  const chemin = `/axispro/portail/rendez-vous/${m.id}`;

  function confirmer() {
    const start = f.creneau === "autre" ? versIso(f.autre) : f.creneau;
    if (!start) return setErreur("Choisissez un créneau ou indiquez une autre date.");
    if (passee(start, Date.now())) return setErreur("Cette date est passée : choisissez une date à venir.");
    if (f.url.trim() && !f.url.trim().startsWith("https://")) return setErreur("Le lien de visioconférence doit commencer par https://.");
    void envoyer("confirm", async () => {
      await apiSend("PATCH", chemin, { action: "confirm", start, location: f.location.trim(), online_url: f.url.trim(), duration: Number(f.duration), cabinet_note: f.note.trim() });
      await onDone("Rendez-vous confirmé : le porteur est prévenu.");
    });
  }

  async function decliner() {
    if (occupe) return;
    const question = f.note.trim()
      ? "Décliner cette demande ? Le porteur sera prévenu avec votre message."
      : "Décliner sans message ? Un mot d'explication aide le porteur à proposer d'autres créneaux.";
    if (!(await demanderConfirmation(question, { action: "Décliner", danger: true }))) return;
    void envoyer("decline", async () => {
      await apiSend("PATCH", chemin, { action: "decline", cabinet_note: f.note.trim() });
      await onDone("Demande déclinée : le porteur est prévenu.");
    });
  }

  return (
    <Modal
      open
      wide
      title={`Répondre : ${m.subject}`}
      onClose={() => void fermer()}
      footer={
        <>
          <Button variant="ghost" disabled={occupe} onClick={() => void fermer()}>
            Fermer
          </Button>
          <Button variant="danger" loading={envoi === "decline"} disabled={occupe} onClick={() => void decliner()}>
            Décliner
          </Button>
          <Button variant="primary" loading={envoi === "confirm"} disabled={occupe} onClick={confirmer}>
            <CheckCircle2 className="h-4 w-4" /> Confirmer le rendez-vous
          </Button>
        </>
      }
    >
      <fieldset disabled={occupe} className="min-w-0 space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-[13.5px] text-ink-2">
          {m.dossier.reference} {m.dossier.name}. Demande de {m.requested_by} {quand(m.create_date)}, {m.mode_label.toLowerCase()}, {duree(m.duration)}.
        </p>
        {m.agenda && <p className="whitespace-pre-wrap rounded-lg bg-panel-2 px-3 py-2 text-[13px] text-ink-2">{m.agenda}</p>}
        <div>
          <Intitule hint="Cliquez sur un créneau proposé par le porteur, ou indiquez une autre date. Un créneau passé ne se confirme plus.">Date du rendez-vous</Intitule>
          <div role="radiogroup" aria-label="Date du rendez-vous" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {m.slots.map((s) => {
              const ancien = passee(s, maintenant);
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={f.creneau === s}
                  disabled={ancien}
                  onClick={() => set("creneau", s)}
                  className={cx("rounded-xl border px-3 py-2.5 text-left text-[13.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50", f.creneau === s ? "border-accent-vif bg-accent-doux font-semibold text-ink" : "border-line text-ink-2 hover:border-line-strong hover:bg-panel-2")}
                >
                  {majuscule(dateLongue(s))}
                  {ancien && <span className="block text-[12px] font-normal text-muted">Créneau passé</span>}
                </button>
              );
            })}
            <div className={cx("rounded-xl border px-3 py-2", f.creneau === "autre" ? "border-accent-vif bg-accent-doux" : "border-line")}>
              <button type="button" role="radio" aria-checked={f.creneau === "autre"} onClick={() => set("creneau", "autre")} className="text-[13.5px] font-semibold text-ink">
                {m.slots.length ? "Autre date" : "Date proposée par le cabinet"}
              </button>
              <Input type="datetime-local" aria-label="Autre date du rendez-vous" className="mt-1.5" value={f.autre} min={versLocal(new Date(maintenant).toISOString())} onFocus={() => set("creneau", "autre")} onChange={(e) => setF((x) => ({ ...x, autre: e.target.value, creneau: "autre" }))} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Durée">
            <Select value={f.duration} onChange={(e) => set("duration", e.target.value)} options={OPTIONS_DUREE} />
          </Field>
          <Field label="Lieu" className="md:col-span-2">
            <Input value={f.location} maxLength={200} placeholder={m.mode === "office" ? "Exemple : bureaux de MB AxisPro Consulting, Kaloum" : "Facultatif"} onChange={(e) => set("location", e.target.value)} />
          </Field>
        </div>
        <Field label="Lien de visioconférence" hint={m.mode === "video" ? "Le porteur a demandé une visioconférence : indiquez le lien (https://…)." : "Facultatif, https://…"}>
          <Input value={f.url} maxLength={500} inputMode="url" placeholder="https://" onChange={(e) => set("url", e.target.value)} />
        </Field>
        <Field label="Message au porteur" hint="Joint à la confirmation, ou explique le refus.">
          <Textarea value={f.note} maxLength={2000} placeholder="Exemple : apportez vos trois derniers relevés bancaires." onChange={(e) => set("note", e.target.value)} />
        </Field>
      </fieldset>
    </Modal>
  );
}

function Annuler({ m, onClose, onDone }: Traitement & { m: MeetingRow }) {
  const [note, setNote] = useState("");
  const { occupe, erreur, setErreur, envoyer, fermer } = useEnvoiFenetre(note.trim() !== "", onClose);
  async function annuler() {
    if (occupe) return;
    if (!note.trim()) return setErreur("Expliquez au porteur pourquoi le rendez-vous est annulé.");
    if (!(await demanderConfirmation(`Annuler le rendez-vous « ${m.subject} » ? Le porteur sera prévenu.`, { action: "Annuler le rendez-vous", danger: true }))) return;
    void envoyer("cancel", async () => {
      await apiSend("PATCH", `/axispro/portail/rendez-vous/${m.id}`, { action: "cancel", cabinet_note: note.trim() });
      await onDone("Rendez-vous annulé : le porteur est prévenu.");
    });
  }
  return (
    <Modal
      open
      title="Annuler le rendez-vous"
      onClose={() => void fermer()}
      footer={
        <>
          <Button variant="ghost" disabled={occupe} onClick={() => void fermer()}>
            Garder le rendez-vous
          </Button>
          <Button variant="danger" loading={occupe} onClick={() => void annuler()}>
            <XCircle className="h-4 w-4" /> Annuler le rendez-vous
          </Button>
        </>
      }
    >
      <fieldset disabled={occupe} className="min-w-0 space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-[13.5px] text-ink-2">
          « {m.subject} », {m.dossier.reference}
          {m.start ? `, ${dateLongue(m.start)}` : ""}.
        </p>
        <Field label="Message au porteur" hint="Proposez si possible une autre date.">
          <Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </fieldset>
    </Modal>
  );
}

function CompteRendu({ m, mode, onClose, onDone }: Traitement & { m: MeetingRow; mode: "tenu" | "compte_rendu" }) {
  const [minutes, setMinutes] = useState(m.minutes ?? "");
  const { occupe, erreur, envoyer, fermer } = useEnvoiFenetre(minutes !== (m.minutes ?? ""), onClose);
  async function valider() {
    if (occupe) return;
    if (mode === "tenu" && !passee(m.end ?? m.start, Date.now()) && !(await demanderConfirmation("Ce rendez-vous n'a pas encore eu lieu. Le marquer tenu ? Il ne pourra plus être annulé ni déplacé.", { action: "Marquer tenu", danger: true }))) return;
    const action = mode === "tenu" ? "done" : "minutes";
    void envoyer(action, async () => {
      await apiSend("PATCH", `/axispro/portail/rendez-vous/${m.id}`, { action, minutes: minutes.trim() });
      const partage = minutes.trim() && minutes.trim() !== (m.minutes ?? "").trim();
      await onDone(mode === "tenu" ? (partage ? "Rendez-vous marqué tenu : le porteur reçoit le compte rendu." : "Rendez-vous marqué tenu.") : partage ? "Compte rendu enregistré : le porteur est prévenu." : "Compte rendu enregistré.");
    });
  }
  return (
    <Modal
      open
      wide
      title={mode === "tenu" ? "Marquer le rendez-vous tenu" : "Compte rendu du rendez-vous"}
      onClose={() => void fermer()}
      footer={
        <>
          <Button variant="ghost" disabled={occupe} onClick={() => void fermer()}>
            Annuler
          </Button>
          <Button variant="primary" loading={occupe} onClick={() => void valider()}>
            <CheckCircle2 className="h-4 w-4" /> {mode === "tenu" ? "Marquer tenu" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <fieldset disabled={occupe} className="min-w-0 space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-[13.5px] text-ink-2">
          « {m.subject} », {m.dossier.reference} {m.dossier.name}
          {m.start ? `, ${dateLongue(m.start)}` : ""}.
        </p>
        <Field label="Compte rendu partagé avec le porteur" hint="Le porteur le lit sur son portail et en est prévenu : décisions, prochaines étapes, pièces à fournir. Les remarques internes vont dans une note interne de la messagerie.">
          <Textarea className="min-h-[220px]" value={minutes} maxLength={20_000} placeholder={"Points abordés :\n- …\nProchaines étapes :\n- …"} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </fieldset>
    </Modal>
  );
}

function Planifier({ cibles, onClose, onDone }: Traitement & { cibles: Cibles }) {
  const [initial] = useState(() => {
    const demain = new Date();
    demain.setDate(demain.getDate() + 1);
    demain.setHours(10, 0, 0, 0);
    return {
      dossier_id: "",
      subject: "",
      start: versLocal(demain.toISOString()),
      duration: "60",
      mode: (cibles.meeting_modes[0]?.key ?? "office") as MeetingMode,
      location: "",
      online_url: "",
      agenda: "",
      cabinet_note: "",
    };
  });
  const [f, setF] = useState(initial);
  const { occupe, erreur, setErreur, envoyer, fermer } = useEnvoiFenetre(saisieModifiee(f, initial), onClose);
  const dossiers = [...cibles.dossiers].sort((a, b) => a.reference.localeCompare(b.reference, "fr"));
  const choisi = dossiers.find((d) => String(d.id) === f.dossier_id);

  function planifier() {
    if (!f.dossier_id) return setErreur("Choisissez le dossier.");
    if (!f.subject.trim()) return setErreur("Indiquez l'objet du rendez-vous.");
    if (!f.start) return setErreur("Indiquez la date du rendez-vous.");
    if (passee(versIso(f.start), Date.now())) return setErreur("Cette date est passée : choisissez une date à venir.");
    if (f.online_url.trim() && !f.online_url.trim().startsWith("https://")) return setErreur("Le lien de visioconférence doit commencer par https://.");
    void envoyer("planifier", async () => {
      await apiSend("POST", "/axispro/portail/rendez-vous", {
        dossier_id: Number(f.dossier_id),
        subject: f.subject.trim(),
        start: versIso(f.start),
        duration: Number(f.duration),
        mode: f.mode,
        location: f.location.trim(),
        online_url: f.online_url.trim(),
        agenda: f.agenda.trim(),
        cabinet_note: f.cabinet_note.trim(),
      });
      await onDone("Rendez-vous planifié : le porteur est prévenu.");
    });
  }

  return (
    <Modal
      open
      wide
      title="Planifier un rendez-vous"
      onClose={() => void fermer()}
      footer={
        <>
          <Button variant="ghost" disabled={occupe} onClick={() => void fermer()}>
            Annuler
          </Button>
          <Button variant="primary" loading={occupe} onClick={planifier}>
            <Calendar className="h-4 w-4" /> Planifier
          </Button>
        </>
      }
    >
      <fieldset disabled={occupe} className="min-w-0 space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <Notice tone="accent">Le rendez-vous est confirmé d&apos;emblée : le porteur est prévenu sur son portail et le retrouve dans son agenda.</Notice>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Dossier" hint={choisi ? (choisi.portal_users ? pluriel(choisi.portal_users, "compte porteur sera prévenu", "comptes porteurs seront prévenus") : "Aucun porteur inscrit au portail pour ce dossier.") : undefined}>
            <Select value={f.dossier_id} placeholder="Choisir un dossier" onChange={(e) => setF({ ...f, dossier_id: e.target.value })} options={dossiers.map((d) => ({ value: String(d.id), label: `${d.reference} ${d.name}` }))} />
          </Field>
          <Field label="Objet">
            <Input value={f.subject} maxLength={200} placeholder="Exemple : revue du plan de financement" onChange={(e) => setF({ ...f, subject: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Date et heure">
            <Input type="datetime-local" value={f.start} min={versLocal(new Date().toISOString())} onChange={(e) => setF({ ...f, start: e.target.value })} />
          </Field>
          <Field label="Durée">
            <Select value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} options={OPTIONS_DUREE} />
          </Field>
          <Field label="Forme">
            <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as MeetingMode })} options={cibles.meeting_modes.map((k) => ({ value: k.key, label: k.label }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Lieu" hint="Facultatif.">
            <Input value={f.location} maxLength={200} onChange={(e) => setF({ ...f, location: e.target.value })} />
          </Field>
          <Field label="Lien de visioconférence" hint={f.mode === "video" ? "https://… indispensable pour une visioconférence." : "Facultatif, https://…"}>
            <Input value={f.online_url} maxLength={500} inputMode="url" placeholder="https://" onChange={(e) => setF({ ...f, online_url: e.target.value })} />
          </Field>
        </div>
        <Field label="Points à aborder">
          <Textarea value={f.agenda} maxLength={3000} onChange={(e) => setF({ ...f, agenda: e.target.value })} />
        </Field>
        <Field label="Message au porteur" hint="Facultatif : ce qu'il doit préparer ou apporter.">
          <Textarea className="min-h-[60px]" value={f.cabinet_note} maxLength={2000} onChange={(e) => setF({ ...f, cabinet_note: e.target.value })} />
        </Field>
      </fieldset>
    </Modal>
  );
}
