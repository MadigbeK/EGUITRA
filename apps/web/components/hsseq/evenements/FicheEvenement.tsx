"use client";

/**
 * Fiche d'un événement de NIMOVA · HSSEQ (GET /hsseq/events/{id}, §5) : en-tête (référence, type,
 * criticité, statut), frise du cycle déclaré, classé, enquête, actions, clôturé, commandes, onglets.
 * Les commandes ne s'affichent que selon `rights` et `transitions` renvoyés par la fiche ; le noyau
 * refuse le reste, et ses refus s'écrivent en clair sous l'en-tête.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Check, ChevronLeft, FileText, Lock, MapPin, Pencil, RotateCcw, ShieldCheck } from "@/components/icons";
import { Button, ErrorBox, FEUILLE, Field, Loading, Modal, Notice, Tabs, Tag, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { CYCLE_EVENEMENT, Criticite, DOMAINE, STATUT_EVENEMENT, TYPE_EVENEMENT, Tampon, nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import type { Event as Evenement, EventStatus, EventTransition } from "@/lib/hsseq-types";
import { SOURCE, fmtJourHeure, messageRefus, useReferentiels } from "./commun";
import { Declaration } from "./Declaration";
import { Classement } from "./Classement";
import { Couts } from "./Couts";
import { Enquete, OuvrirEnquete } from "./Enquete";
import { Resume } from "./Resume";
import { ActionsLiees, Journal, Notifications } from "./Suivi";

type Onglet = "resume" | "classement" | "enquete" | "actions" | "couts" | "notifications" | "journal";
const ONGLETS: readonly Onglet[] = ["resume", "classement", "enquete", "actions", "couts", "notifications", "journal"];

/** Rapport d'enquête en PDF, rendu par le noyau (§5, « Rapport et exports »). */
export function telechargerRapport(e: Evenement) {
  return apiDownload(`/hsseq/events/${e.id}/report.pdf`, `rapport_${e.reference.replaceAll("/", "-")}.pdf`);
}

export function FicheEvenement({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: e, error, mutate } = useApi<Evenement>(/^\d+$/.test(id) ? `/hsseq/events/${id}` : null);
  const { data: referentiels } = useReferentiels();
  const [refus, setRefus] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<EventTransition | null>(null);
  const [corriger, setCorriger] = useState(false);
  const [ouvrirEnquete, setOuvrirEnquete] = useState(false);
  const [rouvrir, setRouvrir] = useState(false);
  const [rapport, setRapport] = useState(false);

  const demande = sp.get("onglet");
  const onglet: Onglet = demande && (ONGLETS as readonly string[]).includes(demande) ? (demande as Onglet) : "resume";
  function changerOnglet(o: Onglet) {
    const p = new URLSearchParams(sp.toString());
    if (o === "resume") p.delete("onglet");
    else p.set("onglet", o);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (!/^\d+$/.test(id)) return <ErrorBox error={new Error("Événement introuvable.")} />;
  if (error && !e) return <ErrorBox error={error} onRetry={() => mutate()} />;
  if (!e) return <Loading label="Chargement de l'événement…" />;
  const ev = e;

  /** Fiche à jour renvoyée par une écriture : elle remplace la fiche affichée, sans relecture. */
  function maj(suivant: Evenement) {
    setRefus(null);
    void mutate(suivant, { revalidate: false });
  }

  async function transition(t: EventTransition, corps?: unknown): Promise<boolean> {
    setRefus(null);
    setEnvoi(t);
    try {
      maj(await apiSend<Evenement>("POST", `/hsseq/events/${ev.id}/${t}`, corps ?? {}));
      return true;
    } catch (err) {
      setRefus(messageRefus(err));
      return false;
    } finally {
      setEnvoi(null);
    }
  }

  async function planifier() {
    if (await demanderConfirmation("Conclure l'enquête et passer aux actions ? L'enquête ne se modifie plus ensuite ; les actions se créent dans le plan d'actions.", { action: "Passer aux actions" })) await transition("plan");
  }

  async function cloturer() {
    if (await demanderConfirmation(`Clôturer l'événement ${ev.reference} ? Une fiche close ne se rouvre que par le Responsable HSSEQ, avec un motif écrit.`, { action: "Clôturer" })) await transition("close");
  }

  async function pdf() {
    setRapport(true);
    setRefus(null);
    try {
      await telechargerRapport(ev);
    } catch (err) {
      setRefus(messageRefus(err, "Le rapport n'a pas été produit."));
    } finally {
      setRapport(false);
    }
  }

  const peut = (t: EventTransition) => ev.transitions.includes(t);
  const commandes = ev.rights.can_edit || ev.transitions.length > 0 || ev.investigation !== null;

  return (
    <div>
      <Link href="/hsseq/evenements" className="mb-3 inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-muted hover:text-accent">
        <ChevronLeft className="h-4 w-4" /> Tous les événements
      </Link>

      <section aria-labelledby="titre-evenement" className={cx(FEUILLE, "mb-5 p-5 sm:p-6")}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
              <span className="rounded-[6px] bg-accent-doux px-2 py-0.5 font-mono text-[12.5px] font-semibold text-accent">{ev.reference}</span>
              <span className="font-semibold text-ink">{TYPE_EVENEMENT[ev.type]?.label ?? ev.type}</span>
              <span aria-hidden className="text-muted">,</span>
              <span>{DOMAINE[ev.domain] ?? ev.domain}</span>
              {ev.source === "terrain" && <Tag>{`${SOURCE.terrain}${ev.offline ? ", saisi hors ligne" : ""}`}</Tag>}
            </p>
            <h1 id="titre-evenement" className="mt-2 font-display text-[26px] font-[650] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[32px]">
              {ev.title}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-ink-2">
              <span>Survenu le {fmtJourHeure(ev.occurred_at)}</span>
              {ev.site && <span>{ev.site.name}</span>}
              {ev.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-muted" /> {ev.location}
                </span>
              )}
              {ev.vehicle && <span>{nomVehicule(ev.vehicle)}</span>}
              {ev.rotation && <span>{nomRotation(ev.rotation)}</span>}
              {ev.reported_by && <span>Déclaré par {ev.reported_by.name}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <Criticite note={ev.criticality} gravite={ev.potential_severity} probabilite={ev.probability} />
            <Tampon mot={STATUT_EVENEMENT[ev.status]} />
            {ev.investigation_overdue && <Tampon mot="Enquête en retard" />}
          </div>
        </div>

        <Frise e={ev} />

        {commandes && (
          <div className="no-print mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {peut("classify") && (
              <Button variant="primary" onClick={() => changerOnglet("classement")}>
                <ShieldCheck className="h-4 w-4" /> Classer l'événement
              </Button>
            )}
            {peut("investigate") && (
              <Button variant="primary" onClick={() => setOuvrirEnquete(true)}>
                Ouvrir l'enquête
              </Button>
            )}
            {peut("plan") && (
              <Button variant="primary" loading={envoi === "plan"} onClick={planifier}>
                Passer aux actions
              </Button>
            )}
            {peut("close") && (
              <Button variant={peut("investigate") ? "secondary" : "primary"} loading={envoi === "close"} onClick={cloturer}>
                <Lock className="h-4 w-4" /> Clôturer
              </Button>
            )}
            {peut("reopen") && (
              <Button onClick={() => setRouvrir(true)}>
                <RotateCcw className="h-4 w-4" /> Rouvrir
              </Button>
            )}
            {ev.rights.can_edit && (
              <Button onClick={() => setCorriger(true)}>
                <Pencil className="h-4 w-4" /> Corriger la déclaration
              </Button>
            )}
            {ev.investigation && (
              <Button variant="ghost" loading={rapport} onClick={pdf}>
                <FileText className="h-4 w-4" /> Rapport d'enquête (PDF)
              </Button>
            )}
          </div>
        )}
        {refus && (
          <div className="mt-4">
            <Notice tone="danger">{refus}</Notice>
          </div>
        )}
      </section>

      <Tabs
        tabs={[
          { key: "resume", label: "Résumé" },
          { key: "classement", label: "Classement" },
          { key: "enquete", label: "Enquête" },
          { key: "actions", label: "Actions", count: ev.actions.length || undefined },
          { key: "couts", label: "Coûts", count: ev.costs.length || undefined },
          { key: "notifications", label: "Notifications", count: ev.notifications.length || undefined },
          { key: "journal", label: "Journal" },
        ]}
        value={onglet}
        onChange={changerOnglet}
      />

      {onglet === "resume" && <Resume e={ev} onRecharger={() => void mutate()} />}
      {onglet === "classement" && <Classement e={ev} referentiels={referentiels} onMaj={maj} />}
      {onglet === "enquete" && <Enquete e={ev} referentiels={referentiels} onMaj={maj} onOuvrir={() => setOuvrirEnquete(true)} onPlanifier={planifier} envoiPlan={envoi === "plan"} onRapport={pdf} rapport={rapport} />}
      {onglet === "actions" && <ActionsLiees e={ev} />}
      {onglet === "couts" && <Couts e={ev} referentiels={referentiels} onMaj={maj} />}
      {onglet === "notifications" && <Notifications e={ev} />}
      {onglet === "journal" && <Journal e={ev} />}

      <Declaration
        open={corriger}
        evenement={ev}
        onClose={() => setCorriger(false)}
        onEnregistre={(suivant) => {
          setCorriger(false);
          maj(suivant);
        }}
      />
      <OuvrirEnquete
        open={ouvrirEnquete}
        e={ev}
        referentiels={referentiels}
        onClose={() => setOuvrirEnquete(false)}
        onOuvrir={async (corps) => {
          if (await transition("investigate", corps)) {
            setOuvrirEnquete(false);
            changerOnglet("enquete");
          }
        }}
        envoi={envoi === "investigate"}
        refus={refus}
      />
      <Reouverture open={rouvrir} e={ev} onClose={() => setRouvrir(false)} onMaj={(s) => { setRouvrir(false); maj(s); }} />
    </div>
  );
}

/* ─── Frise du cycle ──────────────────────────────────────────────────── */

type EtatEtape = "fait" | "courant" | "a_venir" | "sans_objet";

/** Date d'une étape franchie, tirée de la fiche. */
function dateEtape(e: Evenement, s: EventStatus): string | null {
  switch (s) {
    case "reported":
      return e.reported_at;
    case "classified":
      return e.classified_at;
    case "investigation":
      return e.investigation?.opened_at ?? null;
    case "actions":
      return e.investigation?.concluded_at ?? null;
    case "closed":
      return e.closed_at;
  }
}

/**
 * Frise du cycle déclaré, classé, enquête, actions, clôturé : étapes franchies (date), étape en
 * cours, étapes à venir. Un événement de criticité faible clos sans enquête marque l'enquête et les
 * actions « sans objet ». Aplats, sans animation.
 */
function Frise({ e }: { e: Evenement }) {
  const rang = CYCLE_EVENEMENT.indexOf(e.status);
  const etats: EtatEtape[] = CYCLE_EVENEMENT.map((s, i) => {
    if (e.status === "closed") {
      if ((s === "investigation" || s === "actions") && !e.investigation) return "sans_objet";
      return "fait";
    }
    return i < rang ? "fait" : i === rang ? "courant" : "a_venir";
  });
  return (
    <ol aria-label="Cycle de l'événement" className="mt-5 grid gap-2.5 sm:flex sm:gap-0">
      {CYCLE_EVENEMENT.map((s, i) => {
        const etat = etats[i]!;
        const date = etat === "fait" || etat === "courant" ? dateEtape(e, s) : null;
        const suivantFait = etats[i + 1] === "fait" || etats[i + 1] === "courant";
        return (
          <li key={s} aria-current={etat === "courant" ? "step" : undefined} className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:items-start sm:gap-2">
            <div className="flex items-center sm:w-full">
              <span
                className={cx(
                  "grid h-7 w-7 flex-none place-items-center rounded-full text-[12.5px] font-bold tabular",
                  etat === "fait" && "bg-accent text-accent-ink",
                  etat === "courant" && "border-2 border-accent bg-accent-doux text-accent",
                  etat === "a_venir" && "border-2 border-line-strong bg-panel text-muted",
                  etat === "sans_objet" && "border-2 border-dashed border-line-strong bg-panel text-muted",
                )}
              >
                {etat === "fait" ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : etat === "sans_objet" ? "–" : i + 1}
              </span>
              {i < CYCLE_EVENEMENT.length - 1 && <span aria-hidden className={cx("mx-2 hidden h-[3px] flex-1 rounded-full sm:block", suivantFait ? "bg-accent" : "bg-line")} />}
            </div>
            <span className="min-w-0 text-[13px] leading-snug sm:pr-3">
              <span className={cx("block", etat === "courant" ? "font-semibold text-ink" : etat === "fait" ? "text-ink-2" : "text-muted")}>{STATUT_EVENEMENT[s]}</span>
              <span className="block text-[12px] text-muted">
                {etat === "sans_objet" ? "Sans objet" : date ? fmtJourHeure(date) : etat === "courant" ? "En cours" : ""}
              </span>
              <span className="sr-only">{etat === "fait" ? ", étape franchie" : etat === "courant" ? ", étape en cours" : etat === "sans_objet" ? "" : ", à venir"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ─── Réouverture ─────────────────────────────────────────────────────── */

/** Réouverture d'une fiche close (profil hsseq), motif écrit obligatoire (reason_required). */
function Reouverture({ open, e, onClose, onMaj }: { open: boolean; e: Evenement; onClose: () => void; onMaj: (e: Evenement) => void }) {
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const vide = motif.trim().length === 0;
  async function envoyer() {
    setEnvoi(true);
    setRefus(null);
    try {
      const s = await apiSend<Evenement>("POST", `/hsseq/events/${e.id}/reopen`, { reason: motif.trim() });
      setMotif("");
      onMaj(s);
    } catch (err) {
      setRefus(messageRefus(err));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modal
      open={open}
      title={`Rouvrir l'événement ${e.reference}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" disabled={vide} loading={envoi} onClick={envoyer}>
            Rouvrir
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-2">La fiche revient aux actions, à défaut à l'enquête ou au classement. Le motif est journalisé.</p>
        <Field label="Motif de la réouverture">
          <Textarea value={motif} onChange={(ev) => setMotif(ev.target.value)} maxLength={500} rows={3} placeholder="Action inefficace à la vérification, fait nouveau…" />
        </Field>
        {refus && <Notice tone="danger">{refus}</Notice>}
      </div>
    </Modal>
  );
}
