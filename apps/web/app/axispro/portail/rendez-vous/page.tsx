"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Calendar, CheckCircle2, Clock, Link2, MapPin, Plus, XCircle } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import { Intitule, LectureSeule, RESERVE_CABINET, Recherche, correspond, majuscule, messageErreur, pluriel, useEcriture, useMonId, useRetour } from "@/components/portail/cabinet/outils";
import { ajouterAuCalendrier, dateLongue, heure, quand, versIso, versLocal } from "@/components/portail/commun";
import { Badge, Button, ErrorBox, FEUILLE, Field, Input, Loading, Modal, Notice, PageHeader, Segmented, Select, Textarea, cx, demanderConfirmation, type Tone } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import type { Cibles, MeetingMode, MeetingRow, MeetingState } from "@/lib/portail-types";

const ETAT: Record<MeetingState, Tone> = { requested: "warn", confirmed: "accent", done: "ok", declined: "danger", cancelled: "neutral" };

const DUREES = [15, 30, 45, 60, 90, 120, 180, 240];

function duree(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}

const OPTIONS_DUREE = DUREES.map((d) => ({ value: d, label: duree(d) }));

type Modale = { kind: "repondre" | "annuler" | "tenu" | "compte_rendu"; m: MeetingRow } | { kind: "planifier" } | null;

export default function RendezVousPage() {
  const ecriture = useEcriture();
  const monId = useMonId();
  const { data, error, mutate } = useApi<MeetingRow[]>("/axispro/portail/rendez-vous", { refreshInterval: 60_000 });
  const { data: cibles } = useApi<Cibles>("/axispro/portail/cibles");
  const [qui, setQui] = useState<"tous" | "miens">("tous");
  const [q, setQ] = useState("");
  const [modale, setModale] = useState<Modale>(null);
  const [historique, setHistorique] = useState(15);
  const { agir, bandeau } = useRetour();
  const [maintenant] = useState(() => Date.now());

  const rows = (data ?? []).filter((m) => (qui === "tous" || m.consultant?.id === monId) && correspond(q, m.subject, m.dossier.reference, m.dossier.name, m.requested_by, m.consultant?.name));
  const demandes = rows.filter((m) => m.state === "requested").sort((a, b) => a.create_date.localeCompare(b.create_date));
  const confirmes = rows.filter((m) => m.state === "confirmed").sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const passes = rows.filter((m) => ["done", "declined", "cancelled"].includes(m.state)).sort((a, b) => (b.start ?? b.create_date).localeCompare(a.start ?? a.create_date));

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
          <Button variant="primary" disabled={!ecriture || !cibles} title={!ecriture ? RESERVE_CABINET : undefined} onClick={() => setModale({ kind: "planifier" })}>
            <Plus className="h-4 w-4" /> Planifier un rendez-vous
          </Button>
        }
      />
      <OngletsPortail />
      <div className="space-y-4">
        <LectureSeule ecriture={ecriture} />
        {bandeau}
        {error && <ErrorBox error={error} onRetry={() => void mutate()} />}
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
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="primary" size="sm" disabled={!ecriture} title={!ecriture ? RESERVE_CABINET : undefined} onClick={() => setModale({ kind: "repondre", m })}>
                      Répondre
                    </Button>
                  </div>
                </Carte>
              ))}
            </Colonne>
            <Colonne titre="Confirmés à venir" compte={confirmes.length} detail="Et ceux qui restent à clôturer" vide="Aucun rendez-vous confirmé.">
              {confirmes.map((m) => {
                const passe = Boolean(m.end && new Date(m.end).getTime() < maintenant);
                return (
                  <Carte key={m.id} m={m} alerte={passe ? "Date passée : marquez-le tenu avec son compte rendu, ou annulez-le." : undefined}>
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant={passe ? "primary" : "secondary"} size="sm" disabled={!ecriture} title={!ecriture ? RESERVE_CABINET : undefined} onClick={() => setModale({ kind: "tenu", m })}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Marquer tenu
                      </Button>
                      {m.start && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => ajouterAuCalendrier({ titre: `${m.subject} (${m.dossier.reference})`, debut: m.start ?? "", fin: m.end, lieu: m.location ?? m.online_url, description: m.agenda, uid: `rdv-${m.id}` })}
                        >
                          <Calendar className="h-3.5 w-3.5" /> Agenda
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-danger hover:text-danger" disabled={!ecriture} title={!ecriture ? RESERVE_CABINET : undefined} onClick={() => setModale({ kind: "annuler", m })}>
                        <XCircle className="h-3.5 w-3.5" /> Annuler
                      </Button>
                    </div>
                  </Carte>
                );
              })}
            </Colonne>
            <Colonne titre="Historique" compte={passes.length} detail="Tenus, déclinés ou annulés" vide="Aucun rendez-vous passé.">
              {passes.slice(0, historique).map((m) => (
                <Carte key={m.id} m={m}>
                  {m.state === "done" && (
                    <Button variant="ghost" size="sm" disabled={!ecriture} title={!ecriture ? RESERVE_CABINET : undefined} onClick={() => setModale({ kind: "compte_rendu", m })}>
                      {m.minutes ? "Modifier le compte rendu" : "Rédiger le compte rendu"}
                    </Button>
                  )}
                </Carte>
              ))}
              {passes.length > historique && (
                <li>
                  <Button variant="ghost" className="w-full" onClick={() => setHistorique((n) => n + 30)}>
                    Afficher plus ({passes.length - historique} restants)
                  </Button>
                </li>
              )}
            </Colonne>
          </div>
        )}
      </div>

      {modale?.kind === "repondre" && <Repondre m={modale.m} onClose={() => setModale(null)} onDone={apresAction} />}
      {modale?.kind === "annuler" && <Annuler m={modale.m} onClose={() => setModale(null)} onDone={apresAction} />}
      {(modale?.kind === "tenu" || modale?.kind === "compte_rendu") && <CompteRendu m={modale.m} mode={modale.kind} onClose={() => setModale(null)} onDone={apresAction} />}
      {modale?.kind === "planifier" && cibles && <Planifier cibles={cibles} onClose={() => setModale(null)} onDone={apresAction} />}
    </div>
  );
}

function Colonne({ titre, compte, detail, vide, children }: { titre: string; compte: number; detail: string; vide: string; children: ReactNode }) {
  return (
    <section aria-label={titre} className="min-w-0 rounded-[20px] bg-panel-2/70 p-3 ring-1 ring-line/70">
      <header className="flex items-baseline justify-between gap-2 px-2 pb-3 pt-1">
        <div>
          <h2 className="font-display text-[16px] font-[620] text-ink">{titre}</h2>
          <p className="text-[12px] text-muted">{detail}</p>
        </div>
        <span className="rounded-full bg-panel px-2 py-0.5 text-[12px] font-semibold tabular text-ink-2 ring-1 ring-line">{compte}</span>
      </header>
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
          <span className="font-semibold text-ink">Message du cabinet : </span>« {m.cabinet_note} »
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

function useEnvoi(onDone: (message: string) => Promise<void>) {
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  async function envoyer(cle: string, fn: () => Promise<unknown>, message: string) {
    setEnvoi(cle);
    setErreur(null);
    try {
      await fn();
      await onDone(message);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(null);
    }
  }
  return { envoi, erreur, setErreur, envoyer };
}

function Repondre({ m, onClose, onDone }: { m: MeetingRow; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [creneau, setCreneau] = useState<string>(m.slots[0] ?? "autre");
  const [autre, setAutre] = useState("");
  const [duration, setDuration] = useState(String(DUREES.includes(m.duration) ? m.duration : 60));
  const [location, setLocation] = useState(m.location ?? "");
  const [url, setUrl] = useState(m.online_url ?? "");
  const [note, setNote] = useState("");
  const { envoi, erreur, setErreur, envoyer } = useEnvoi(onDone);
  const chemin = `/axispro/portail/rendez-vous/${m.id}`;

  function confirmer() {
    const start = creneau === "autre" ? versIso(autre) : creneau;
    if (!start) return setErreur("Choisissez un créneau ou indiquez une autre date.");
    if (url.trim() && !url.trim().startsWith("https://")) return setErreur("Le lien de visioconférence doit commencer par https://.");
    void envoyer("confirm", () => apiSend("PATCH", chemin, { action: "confirm", start, location: location.trim(), online_url: url.trim(), duration: Number(duration), cabinet_note: note.trim() }), "Rendez-vous confirmé : le porteur est prévenu.");
  }

  async function decliner() {
    if (!note.trim() && !(await demanderConfirmation("Décliner sans message ? Un mot d'explication aide le porteur à proposer d'autres créneaux.", { action: "Décliner", danger: true }))) return;
    if (note.trim() && !(await demanderConfirmation("Décliner cette demande ? Le porteur sera prévenu avec votre message.", { action: "Décliner", danger: true }))) return;
    void envoyer("decline", () => apiSend("PATCH", chemin, { action: "decline", cabinet_note: note.trim() }), "Demande déclinée : le porteur est prévenu.");
  }

  return (
    <Modal
      open
      wide
      title={`Répondre : ${m.subject}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="danger" loading={envoi === "decline"} disabled={envoi !== null} onClick={decliner}>
            Décliner
          </Button>
          <Button variant="primary" loading={envoi === "confirm"} disabled={envoi !== null} onClick={confirmer}>
            <CheckCircle2 className="h-4 w-4" /> Confirmer le rendez-vous
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-[13.5px] text-ink-2">
          {m.dossier.reference} {m.dossier.name}. Demande de {m.requested_by} {quand(m.create_date)}, {m.mode_label.toLowerCase()}, {duree(m.duration)}.
        </p>
        {m.agenda && <p className="whitespace-pre-wrap rounded-lg bg-panel-2 px-3 py-2 text-[13px] text-ink-2">{m.agenda}</p>}
        <div>
          <Intitule hint="Cliquez sur un créneau proposé par le porteur, ou indiquez une autre date.">Date du rendez-vous</Intitule>
          <div role="radiogroup" aria-label="Date du rendez-vous" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {m.slots.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={creneau === s} onClick={() => setCreneau(s)} className={cx("rounded-xl border px-3 py-2.5 text-left text-[13.5px] transition-colors", creneau === s ? "border-accent-vif bg-accent-doux font-semibold text-ink" : "border-line text-ink-2 hover:border-line-strong hover:bg-panel-2")}>
                {majuscule(dateLongue(s))}
              </button>
            ))}
            <div className={cx("rounded-xl border px-3 py-2", creneau === "autre" ? "border-accent-vif bg-accent-doux" : "border-line")}>
              <button type="button" role="radio" aria-checked={creneau === "autre"} onClick={() => setCreneau("autre")} className="text-[13.5px] font-semibold text-ink">
                {m.slots.length ? "Autre date" : "Date proposée par le cabinet"}
              </button>
              <Input type="datetime-local" aria-label="Autre date du rendez-vous" className="mt-1.5" value={autre} onFocus={() => setCreneau("autre")} onChange={(e) => { setAutre(e.target.value); setCreneau("autre"); }} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Durée">
            <Select value={duration} onChange={(e) => setDuration(e.target.value)} options={OPTIONS_DUREE} />
          </Field>
          <Field label="Lieu" className="md:col-span-2">
            <Input value={location} maxLength={200} placeholder={m.mode === "office" ? "Exemple : bureaux de MB AxisPro, Kaloum" : "Facultatif"} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <Field label="Lien de visioconférence" hint={m.mode === "video" ? "Le porteur a demandé une visioconférence : indiquez le lien (https://…)." : "Facultatif, https://…"}>
          <Input value={url} maxLength={500} inputMode="url" placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Message au porteur" hint="Joint à la confirmation, ou explique le refus.">
          <Textarea value={note} maxLength={2000} placeholder="Exemple : apportez vos trois derniers relevés bancaires." onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Annuler({ m, onClose, onDone }: { m: MeetingRow; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const { envoi, erreur, setErreur, envoyer } = useEnvoi(onDone);
  async function annuler() {
    if (!note.trim()) return setErreur("Expliquez au porteur pourquoi le rendez-vous est annulé.");
    if (!(await demanderConfirmation(`Annuler le rendez-vous « ${m.subject} » ? Le porteur sera prévenu.`, { action: "Annuler le rendez-vous", danger: true }))) return;
    void envoyer("cancel", () => apiSend("PATCH", `/axispro/portail/rendez-vous/${m.id}`, { action: "cancel", cabinet_note: note.trim() }), "Rendez-vous annulé : le porteur est prévenu.");
  }
  return (
    <Modal
      open
      title="Annuler le rendez-vous"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Garder le rendez-vous
          </Button>
          <Button variant="danger" loading={envoi !== null} onClick={annuler}>
            <XCircle className="h-4 w-4" /> Annuler le rendez-vous
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-[13.5px] text-ink-2">
          « {m.subject} », {m.dossier.reference}
          {m.start ? `, ${dateLongue(m.start)}` : ""}.
        </p>
        <Field label="Message au porteur" hint="Proposez si possible une autre date.">
          <Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CompteRendu({ m, mode, onClose, onDone }: { m: MeetingRow; mode: "tenu" | "compte_rendu"; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [minutes, setMinutes] = useState(m.minutes ?? "");
  const { envoi, erreur, envoyer } = useEnvoi(onDone);
  function valider() {
    const action = mode === "tenu" ? "done" : "minutes";
    void envoyer(action, () => apiSend("PATCH", `/axispro/portail/rendez-vous/${m.id}`, { action, minutes: minutes.trim() }), mode === "tenu" ? "Rendez-vous marqué tenu." : "Compte rendu enregistré.");
  }
  return (
    <Modal
      open
      wide
      title={mode === "tenu" ? "Marquer le rendez-vous tenu" : "Compte rendu du rendez-vous"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={envoi !== null} onClick={valider}>
            <CheckCircle2 className="h-4 w-4" /> {mode === "tenu" ? "Marquer tenu" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className="text-[13.5px] text-ink-2">
          « {m.subject} », {m.dossier.reference} {m.dossier.name}
          {m.start ? `, ${dateLongue(m.start)}` : ""}.
        </p>
        <Field label="Compte rendu partagé avec le porteur" hint="Le porteur le lit sur son portail : décisions, prochaines étapes, pièces à fournir. Les remarques internes vont dans une note interne de la messagerie.">
          <Textarea className="min-h-[220px]" value={minutes} maxLength={20_000} placeholder={"Points abordés :\n- …\nProchaines étapes :\n- …"} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Planifier({ cibles, onClose, onDone }: { cibles: Cibles; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const demain = new Date();
  demain.setDate(demain.getDate() + 1);
  demain.setHours(10, 0, 0, 0);
  const [f, setF] = useState({
    dossier_id: "",
    subject: "",
    start: versLocal(demain.toISOString()),
    duration: "60",
    mode: (cibles.meeting_modes[0]?.key ?? "office") as MeetingMode,
    location: "",
    online_url: "",
    agenda: "",
    cabinet_note: "",
  });
  const { envoi, erreur, setErreur, envoyer } = useEnvoi(onDone);
  const dossiers = [...cibles.dossiers].sort((a, b) => a.reference.localeCompare(b.reference, "fr"));
  const choisi = dossiers.find((d) => String(d.id) === f.dossier_id);

  function planifier() {
    if (!f.dossier_id) return setErreur("Choisissez le dossier.");
    if (!f.subject.trim()) return setErreur("Indiquez l'objet du rendez-vous.");
    if (!f.start) return setErreur("Indiquez la date du rendez-vous.");
    if (f.online_url.trim() && !f.online_url.trim().startsWith("https://")) return setErreur("Le lien de visioconférence doit commencer par https://.");
    void envoyer(
      "planifier",
      () =>
        apiSend("POST", "/axispro/portail/rendez-vous", {
          dossier_id: Number(f.dossier_id),
          subject: f.subject.trim(),
          start: versIso(f.start),
          duration: Number(f.duration),
          mode: f.mode,
          location: f.location.trim(),
          online_url: f.online_url.trim(),
          agenda: f.agenda.trim(),
          cabinet_note: f.cabinet_note.trim(),
        }),
      "Rendez-vous planifié : le porteur est prévenu.",
    );
  }

  return (
    <Modal
      open
      wide
      title="Planifier un rendez-vous"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={envoi !== null} onClick={planifier}>
            <Calendar className="h-4 w-4" /> Planifier
          </Button>
        </>
      }
    >
      <div className="space-y-4">
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
            <Input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
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
      </div>
    </Modal>
  );
}
