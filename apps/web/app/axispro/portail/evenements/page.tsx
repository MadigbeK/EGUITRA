"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Download, Link2, MapPin, Pencil, Plus, Send, Trash2, Users, XCircle } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import {
  ChoixPublic, EditeurTexte, LectureSeule, PUBLIC_VIDE, Recherche, correspond, majuscule, messageErreur, nomFichier, pluriel, publicIncomplet, resumePublic, saisieModifiee, telechargerCsv,
  useEcriture, useEnvoiFenetre, useMaintenant, useRetour, type PublicSaisi,
} from "@/components/portail/cabinet/outils";
import { dateLongue, heure, quand, versIso, versLocal } from "@/components/portail/commun";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Etat, Field, Input, Loading, Modal, Notice, PageHeader, ProgressBar, Select, Tabs, Tag, cx, demanderConfirmation, type Tone } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { AIDE_NOMBRE, MONTHS_FR, fmtDateTime, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";
import type { Cibles, EventAdmin, EventKind, RegistrationRow, RegistrationState } from "@/lib/portail-types";

type Onglet = "venir" | "passes" | "brouillons" | "annules";
type ActionEvenement = "publier" | "annuler" | "supprimer";

/** Inscription lue par le cabinet : la liste d'attente porte son rang (1 : la prochaine place libre). */
type Inscription = RegistrationRow & { waitlist_since?: string | null; waitlist_rank?: number | null };

const ETAT_INSCRIPTION: Record<RegistrationState, Tone> = {
  registered: "accent",
  waitlist: "warn",
  attended: "ok",
  absent: "danger",
  cancelled: "neutral",
};

function classer(e: EventAdmin, maintenant: number): Onglet {
  if (e.state === "draft") return "brouillons";
  if (e.state === "cancelled") return "annules";
  return new Date(e.end).getTime() >= maintenant ? "venir" : "passes";
}

/** Personnes prévenues de l'annulation : « La personne inscrite… sera prévenue », « Les 3 personnes… seront prévenues ». */
function prevenus(n: number): string {
  if (n === 0) return "Personne n'est encore inscrit.";
  if (n === 1) return "La personne inscrite ou en liste d'attente sera prévenue.";
  return `Les ${fmtInt(n)} personnes inscrites ou en liste d'attente seront prévenues.`;
}

export default function EvenementsPage() {
  const ecriture = useEcriture();
  const { data, error, mutate } = useApi<EventAdmin[]>("/axispro/portail/evenements");
  const { data: cibles, error: erreurCibles, mutate: majCibles } = useApi<Cibles>("/axispro/portail/cibles");
  const [onglet, setOnglet] = useState<Onglet>("venir");
  const [q, setQ] = useState("");
  const [edition, setEdition] = useState<EventAdmin | "nouveau" | null>(null);
  const [inscriptions, setInscriptions] = useState<EventAdmin | null>(null);
  const { agir, envoyer, enCours, occupe, bandeau } = useRetour();
  const maintenant = useMaintenant();

  const tous = data ?? [];
  const compte = (o: Onglet) => tous.filter((e) => classer(e, maintenant) === o).length;
  const rows = tous
    .filter((e) => classer(e, maintenant) === onglet && correspond(q, e.name, e.kind_label, e.speaker, e.location))
    .sort((a, b) => (onglet === "venir" || onglet === "brouillons" ? 1 : -1) * (new Date(a.start).getTime() - new Date(b.start).getTime()));

  async function etat(e: EventAdmin, action: ActionEvenement) {
    if (occupe) return;
    const questions = {
      publier: `Publier « ${e.name} » ? Les porteurs visés (${resumePublic(e).toLowerCase()}) seront prévenus et pourront s'inscrire.`,
      annuler: `Annuler « ${e.name} » ? ${prevenus(e.registered + e.waitlist)} L'annulation est définitive.`,
      supprimer: `Supprimer définitivement le brouillon « ${e.name} » ?`,
    };
    if (!(await demanderConfirmation(questions[action], { action: { publier: "Publier", annuler: "Annuler l'événement", supprimer: "Supprimer" }[action], danger: action !== "publier" }))) return;
    const ok = { publier: "Événement publié : les porteurs visés sont prévenus.", annuler: "Événement annulé : les inscrits sont prévenus.", supprimer: "Brouillon supprimé." };
    const r = await envoyer(() => apiSend("POST", `/axispro/portail/evenements/${e.id}/${action}`), ok[action], `${e.id}:${action}`);
    if (r !== undefined) await mutate();
  }

  return (
    <div>
      <PageHeader
        title="Événements et formations"
        subtitle="Ateliers, formations, webinaires et rencontres proposés aux porteurs : publication, inscriptions, liste d'attente et pointage des présents."
        actions={
          ecriture ? (
            <Button variant="primary" disabled={!cibles} onClick={() => setEdition("nouveau")}>
              <Plus className="h-4 w-4" /> Nouvel événement
            </Button>
          ) : undefined
        }
      />
      <OngletsPortail />
      <div className="space-y-4">
        <LectureSeule ecriture={ecriture} />
        {bandeau}
        {erreurCibles && <ErrorBox titre="Dossiers et étapes indisponibles : impossible d'ouvrir un événement." error={erreurCibles} onRetry={() => void majCibles()} />}
        {error && <ErrorBox titre={data ? "Rechargement impossible : les événements affichés peuvent dater." : undefined} error={error} onRetry={() => void mutate()} />}
        <div className="flex flex-wrap items-end justify-between gap-x-4">
          <Tabs
            value={onglet}
            onChange={setOnglet}
            tabs={[
              { key: "venir", label: "À venir", count: compte("venir") },
              { key: "passes", label: "Passés", count: compte("passes") },
              { key: "brouillons", label: "Brouillons", count: compte("brouillons") },
              { key: "annules", label: "Annulés", count: compte("annules") },
            ]}
          />
          <Recherche className="mb-5 w-full sm:w-72" label="Rechercher un événement" placeholder="Intitulé, intervenant, lieu" value={q} onChange={setQ} />
        </div>
        <Card padded={false}>
          {!data ? (
            !error && <Loading label="Chargement des événements…" />
          ) : rows.length === 0 ? (
            <Empty title="Aucun événement dans cette sélection." hint={onglet === "venir" && ecriture ? "Créez un atelier ou une formation : il reste en brouillon tant que vous ne le publiez pas." : undefined} />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((e) => (
                <LigneEvenement key={e.id} e={e} passe={onglet === "passes"} ecriture={ecriture} enCours={enCours} occupe={occupe} onEditer={() => cibles && setEdition(e)} onInscriptions={() => setInscriptions(e)} onEtat={(a) => void etat(e, a)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {edition && cibles && (
        <EditeurEvenement
          evenement={edition === "nouveau" ? null : edition}
          cibles={cibles}
          ecriture={ecriture}
          onClose={() => setEdition(null)}
          onDone={async (texte) => {
            setEdition(null);
            await agir(() => mutate(), texte);
          }}
        />
      )}
      {inscriptions && <Inscriptions evenement={inscriptions} ecriture={ecriture} onClose={() => setInscriptions(null)} onChange={() => void mutate()} />}
    </div>
  );
}

function LigneEvenement({ e, passe, ecriture, enCours, occupe, onEditer, onInscriptions, onEtat }: { e: EventAdmin; passe: boolean; ecriture: boolean; enCours: string | null; occupe: boolean; onEditer: () => void; onInscriptions: () => void; onEtat: (a: ActionEvenement) => void }) {
  const debut = new Date(e.start);
  const memeJour = debut.toDateString() === new Date(e.end).toDateString();
  const charge = (a: ActionEvenement) => enCours === `${e.id}:${a}`;
  return (
    <li className={cx("px-5 py-4 sm:px-6", e.state === "cancelled" && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div aria-hidden className="grid w-14 flex-none place-items-center rounded-xl border border-line bg-panel-2 py-1.5 text-center">
          <span className="font-display text-[22px] font-bold leading-none text-ink">{debut.getDate()}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{MONTHS_FR[debut.getMonth()]}</span>
        </div>
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onEditer} className="text-left font-semibold text-ink hover:text-accent hover:underline">
              {e.name}
            </button>
            <Tag>{e.kind_label}</Tag>
            {e.state === "draft" && <Badge tone="warn">Brouillon</Badge>}
            {e.state === "cancelled" && <Badge tone="danger">Annulé</Badge>}
            {e.state === "published" && !passe && <Badge tone={e.registration_open ? "ok" : "neutral"}>{e.registration_open ? "Inscriptions ouvertes" : "Inscriptions closes"}</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-ink-2">
            {majuscule(dateLongue(e.start))}
            {memeJour ? ` à ${heure(e.end)}` : `, jusqu'au ${dateLongue(e.end)}`}
            {e.speaker ? `. Avec ${e.speaker}` : ""}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
            {e.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {e.location}
              </span>
            )}
            {e.online_url && (
              <span className="inline-flex items-center gap-1">
                <Link2 className="h-3.5 w-3.5" /> En ligne
              </span>
            )}
            <span>Public : {resumePublic(e)}</span>
            {e.registration_deadline && <span>Inscriptions jusqu&apos;au {fmtDateTime(e.registration_deadline)}</span>}
          </p>
        </div>

        <div className="w-full min-w-[200px] space-y-1.5 text-[12.5px] sm:w-56">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted">Inscrits</span>
            <span className="font-semibold tabular text-ink">{e.capacity ? `${fmtInt(e.registered)} / ${pluriel(e.capacity, "place")}` : `${fmtInt(e.registered)}, sans limite`}</span>
          </div>
          {e.capacity ? <ProgressBar value={(e.registered / e.capacity) * 100} epaisseur={6} tone={e.registered >= e.capacity ? "warn" : "accent"} /> : null}
          <div className="flex flex-wrap gap-x-3 text-muted">
            {e.waitlist > 0 && <span className="font-semibold text-warn">{fmtInt(e.waitlist)} en liste d&apos;attente</span>}
            {(passe || e.attended > 0) && <span>{pluriel(e.attended, "présent")}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={onInscriptions}>
            <Users className="h-3.5 w-3.5" /> Inscriptions
          </Button>
          <Button variant="ghost" size="sm" onClick={onEditer}>
            <Pencil className="h-3.5 w-3.5" /> {ecriture ? "Modifier" : "Voir"}
          </Button>
          {ecriture && e.state === "draft" && (
            <Button variant="primary" size="sm" loading={charge("publier")} disabled={occupe} onClick={() => onEtat("publier")}>
              <Send className="h-3.5 w-3.5" /> Publier
            </Button>
          )}
          {ecriture && e.state === "published" && !passe && (
            <Button variant="danger" size="sm" loading={charge("annuler")} disabled={occupe} onClick={() => onEtat("annuler")}>
              <XCircle className="h-3.5 w-3.5" /> Annuler
            </Button>
          )}
          {ecriture && e.state === "draft" && (
            <button type="button" aria-label={`Supprimer le brouillon ${e.name}`} title="Supprimer le brouillon" disabled={occupe} aria-busy={charge("supprimer") || undefined} className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger disabled:cursor-not-allowed disabled:opacity-40" onClick={() => onEtat("supprimer")}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/* ─── Éditeur ──────────────────────────────────────────────────────────── */

interface SaisieEvenement extends PublicSaisi {
  name: string;
  kind: EventKind;
  description: string;
  speaker: string;
  start: string;
  end: string;
  location: string;
  online_url: string;
  capacity: string;
  registration_deadline: string;
}

function decaler(local: string, heures: number): string {
  if (!local) return "";
  return versLocal(new Date(new Date(local).getTime() + heures * 3_600_000).toISOString());
}

function saisieDe(e: EventAdmin | null): SaisieEvenement {
  if (!e) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(10, 0, 0, 0);
    const debut = versLocal(d.toISOString());
    return { ...PUBLIC_VIDE, name: "", kind: "atelier", description: "", speaker: "", start: debut, end: decaler(debut, 2), location: "", online_url: "", capacity: "20", registration_deadline: "" };
  }
  return {
    audience: e.audience,
    dossier_ids: e.dossier_ids,
    gate_codes: e.gate_codes,
    sector_keywords: e.sector_keywords,
    name: e.name,
    kind: e.kind,
    description: e.description ?? "",
    speaker: e.speaker ?? "",
    start: versLocal(e.start),
    end: versLocal(e.end),
    location: e.location ?? "",
    online_url: e.online_url ?? "",
    capacity: String(e.capacity ?? 0),
    registration_deadline: versLocal(e.registration_deadline),
  };
}

/** Places saisies : vide ou 0, sans limite ; sinon un entier positif. null : saisie illisible ou invalide. */
function places(saisie: string): number | null {
  if (!saisie.trim()) return 0;
  const n = lireNombre(saisie);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

function EditeurEvenement({ evenement, cibles, ecriture, onClose, onDone }: { evenement: EventAdmin | null; cibles: Cibles; ecriture: boolean; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [initial] = useState(() => saisieDe(evenement));
  const [f, setF] = useState<SaisieEvenement>(initial);
  const { envoi, occupe, erreur, setErreur, envoyer, fermer } = useEnvoiFenetre(ecriture && saisieModifiee(f, initial), onClose);
  const set = <K extends keyof SaisieEvenement>(k: K, v: SaisieEvenement[K]) => setF((x) => ({ ...x, [k]: v }));
  const etat = evenement?.state ?? "draft";
  const nbPlaces = places(f.capacity);
  const erreurPlaces = nombreIllisible(f.capacity) ? AIDE_NOMBRE : nbPlaces === null ? "Nombre de places : un entier positif (0 ou vide : sans limite)." : undefined;

  function changerDebut(v: string) {
    setF((x) => {
      // La fin suit le début : même durée qu'avant, deux heures à défaut.
      const duree = x.start && x.end ? (new Date(x.end).getTime() - new Date(x.start).getTime()) / 3_600_000 : 2;
      return { ...x, start: v, end: v ? decaler(v, duree > 0 ? duree : 2) : x.end };
    });
  }

  function controle(): string | null {
    if (!f.name.trim()) return "Donnez un intitulé à l'événement.";
    if (!f.start || !f.end) return "Indiquez le début et la fin.";
    if (new Date(f.end) <= new Date(f.start)) return "La fin doit suivre le début.";
    if (f.registration_deadline && new Date(f.registration_deadline) > new Date(f.start)) return "La clôture des inscriptions doit précéder le début.";
    if (f.online_url.trim() && !f.online_url.trim().startsWith("https://")) return "Le lien de connexion doit commencer par https://.";
    if (erreurPlaces) return erreurPlaces;
    if (f.description.length > 20_000) return "Programme trop long (20 000 caractères au plus).";
    return publicIncomplet(f);
  }

  async function enregistrer(publier: boolean) {
    if (occupe) return;
    const probleme = controle();
    if (probleme || nbPlaces === null) {
      setErreur(probleme ?? AIDE_NOMBRE);
      return;
    }
    if (publier && etat === "draft" && !(await demanderConfirmation("Publier cet événement ? Les porteurs visés seront prévenus et pourront s'inscrire.", { action: "Publier" }))) return;
    const corps = {
      name: f.name.trim(),
      kind: f.kind,
      description: f.description,
      speaker: f.speaker.trim(),
      start: versIso(f.start),
      end: versIso(f.end),
      location: f.location.trim(),
      online_url: f.online_url.trim(),
      capacity: nbPlaces,
      registration_deadline: versIso(f.registration_deadline),
      audience: f.audience,
      dossier_ids: f.audience === "dossiers" ? f.dossier_ids : [],
      gate_codes: f.audience === "gates" ? f.gate_codes : "",
      sector_keywords: f.audience === "sectors" ? f.sector_keywords : "",
    };
    // Publié : le noyau prévient les inscrits d'un changement d'horaire, de lieu ou de lien.
    const prevenir = etat === "published" && (f.start !== initial.start || f.end !== initial.end || f.location.trim() !== initial.location.trim() || f.online_url.trim() !== initial.online_url.trim());
    await envoyer(publier ? "publier" : "brouillon", async () => {
      if (!evenement) {
        await apiSend<EventAdmin>("POST", "/axispro/portail/evenements", { ...corps, publish: publier });
      } else {
        await apiSend<EventAdmin>("PATCH", `/axispro/portail/evenements/${evenement.id}`, corps);
        if (publier && etat === "draft") await apiSend("POST", `/axispro/portail/evenements/${evenement.id}/publier`);
      }
      await onDone(
        publier && etat === "draft"
          ? "Événement publié : les porteurs visés sont prévenus."
          : etat === "draft"
            ? "Brouillon enregistré."
            : prevenir
              ? "Événement mis à jour : les inscrits sont prévenus du changement."
              : "Événement mis à jour.",
      );
    });
  }

  return (
    <Modal
      open
      wide
      title={!evenement ? "Nouvel événement" : ecriture ? "Modifier l'événement" : "Événement"}
      onClose={() => void fermer()}
      footer={
        <>
          <Button variant="ghost" disabled={occupe} onClick={() => void fermer()}>
            {ecriture ? "Annuler" : "Fermer"}
          </Button>
          {ecriture && etat === "draft" && (
            <Button variant="secondary" loading={envoi === "brouillon"} disabled={occupe || Boolean(erreurPlaces)} onClick={() => void enregistrer(false)}>
              Enregistrer le brouillon
            </Button>
          )}
          {ecriture && (
            <Button variant="primary" loading={envoi === "publier"} disabled={occupe || Boolean(erreurPlaces)} onClick={() => void enregistrer(etat === "draft")}>
              {etat === "draft" ? (
                <>
                  <Send className="h-4 w-4" /> Publier
                </>
              ) : (
                "Enregistrer"
              )}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={!ecriture || occupe} className="min-w-0 space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        {etat === "published" && <Notice tone="accent">Cet événement est publié : les modifications sont visibles des porteurs dès l&apos;enregistrement. Un changement de date, de lieu ou de lien prévient les inscrits et la liste d&apos;attente ; un public élargi reçoit l&apos;annonce de l&apos;événement ; des places ajoutées vont d&apos;abord à la liste d&apos;attente.</Notice>}
        {etat === "cancelled" && <Notice tone="warn">Cet événement est annulé : il n&apos;est plus proposé aux porteurs.</Notice>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Intitulé" className="md:col-span-2">
            <Input value={f.name} maxLength={200} placeholder="Exemple : Atelier plan de trésorerie" onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Format">
            <Select value={f.kind} onChange={(e) => set("kind", e.target.value as EventKind)} options={cibles.event_kinds.map((k) => ({ value: k.key, label: k.label }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Field label="Début">
            <Input type="datetime-local" value={f.start} onChange={(e) => changerDebut(e.target.value)} />
          </Field>
          <Field label="Fin">
            <Input type="datetime-local" value={f.end} min={f.start || undefined} onChange={(e) => set("end", e.target.value)} />
          </Field>
          <Field label="Places" hint="0 ou vide : sans limite." error={erreurPlaces}>
            <Input inputMode="numeric" value={f.capacity} aria-invalid={erreurPlaces ? true : undefined} onChange={(e) => set("capacity", e.target.value)} />
          </Field>
          <Field label="Clôture des inscriptions" hint="Vide : jusqu'au début.">
            <Input type="datetime-local" value={f.registration_deadline} max={f.start || undefined} onChange={(e) => set("registration_deadline", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Intervenants">
            <Input value={f.speaker} maxLength={200} placeholder="Exemple : Awa Camara, MB AxisPro Consulting" onChange={(e) => set("speaker", e.target.value)} />
          </Field>
          <Field label="Lieu">
            <Input value={f.location} maxLength={200} placeholder="Exemple : salle de formation, Kaloum" onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="Lien de connexion" hint="https://… communiqué aux seuls inscrits.">
            <Input value={f.online_url} maxLength={500} inputMode="url" placeholder="https://" onChange={(e) => set("online_url", e.target.value)} />
          </Field>
        </div>
        <EditeurTexte label="Programme" value={f.description} max={20_000} hauteur={220} onChange={(v) => set("description", v)} placeholder={"# Au programme\n- Lire un relevé bancaire\n- Construire son plan sur douze mois\n> Venez avec vos relevés des trois derniers mois."} />
        <ChoixPublic value={f} onChange={(p) => setF((x) => ({ ...x, ...p }))} cibles={cibles} />
      </fieldset>
    </Modal>
  );
}

/* ─── Inscriptions ─────────────────────────────────────────────────────── */

const ORDRE_ETAT: Record<RegistrationState, number> = { registered: 0, attended: 0, absent: 0, waitlist: 1, cancelled: 2 };

function Inscriptions({ evenement, ecriture, onClose, onChange }: { evenement: EventAdmin; ecriture: boolean; onClose: () => void; onChange: () => void }) {
  const { data, error, mutate } = useApi<Inscription[]>(`/axispro/portail/evenements/${evenement.id}/inscriptions`);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<number | null>(null);
  const verrou = useRef(false);
  // Liste d'attente dans son ordre (rang du noyau), les autres par date d'inscription.
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => ORDRE_ETAT[a.state] - ORDRE_ETAT[b.state] || (a.waitlist_rank ?? 0) - (b.waitlist_rank ?? 0) || a.date.localeCompare(b.date)), [data]);
  const n = (s: RegistrationState) => (data ?? []).filter((r) => r.state === s).length;

  async function pointer(r: Inscription, state: RegistrationState) {
    if (verrou.current) return;
    if (state === "cancelled" && !(await demanderConfirmation(`Désinscrire ${r.user} ? ${r.state === "registered" ? "La première personne en liste d'attente prendra la place." : "Il quittera la liste d'attente."}`, { action: "Désinscrire", danger: true }))) return;
    verrou.current = true;
    setErreur(null);
    setEnCours(r.id);
    try {
      await apiSend("PATCH", `/axispro/portail/inscriptions/${r.id}`, { state });
      await mutate();
      onChange();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      verrou.current = false;
      setEnCours(null);
    }
  }

  function exporter() {
    telechargerCsv(`inscriptions-${nomFichier(evenement.name)}.csv`, [
      ["Porteur", "Identifiant", "Téléphone", "Dossier", "État", "Rang d'attente", "Question ou attente", "Inscrit le"],
      ...rows.map((r) => [r.user, r.login, r.phone, r.dossier?.reference, r.state_label, r.waitlist_rank ?? "", r.note, fmtDateTime(r.date)]),
    ]);
  }

  const occupe = enCours !== null;
  return (
    <Modal
      open
      wide
      title={`Inscriptions : ${evenement.name}`}
      onClose={onClose}
      footer={
        <>
          <Button disabled={!rows.length} onClick={exporter}>
            <Download className="h-4 w-4" /> Exporter la liste (CSV)
          </Button>
          <Button variant="primary" onClick={onClose}>
            Fermer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-2">
          {majuscule(dateLongue(evenement.start))}
          {evenement.location ? `, ${evenement.location}` : ""}. {evenement.capacity ? `${pluriel(evenement.capacity, "place")}.` : "Sans limite de places."}
        </p>
        {data && (
          <div className="flex flex-wrap gap-2">
            <Badge tone="accent">{pluriel(n("registered"), "inscrit")}</Badge>
            <Badge tone="warn">{`${fmtInt(n("waitlist"))} en liste d'attente`}</Badge>
            <Badge tone="ok">{pluriel(n("attended"), "présent")}</Badge>
            <Badge tone="danger">{pluriel(n("absent"), "absent")}</Badge>
            <Badge>{pluriel(n("cancelled"), "désinscrit")}</Badge>
          </div>
        )}
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des inscriptions…">
          <div className="-mx-5">
            <DataTable
              dense
              rows={rows}
              rowKey={(r) => r.id}
              empty="Aucune inscription pour l'instant."
              columns={[
                {
                  key: "user",
                  label: "Porteur",
                  sortValue: (r) => r.user.toLowerCase(),
                  render: (r) => (
                    <div className={cx("min-w-[160px]", r.state === "cancelled" && "opacity-60")}>
                      <div className="font-medium text-ink">{r.user}</div>
                      <div className="text-[12px] text-muted">{[r.login, r.phone].filter(Boolean).join(", ")}</div>
                    </div>
                  ),
                },
                {
                  key: "dossier",
                  label: "Dossier",
                  sortValue: (r) => r.dossier?.reference ?? "",
                  render: (r) =>
                    r.dossier ? (
                      <Link href={`/axispro/dossiers/${r.dossier.id}`} className="font-semibold text-accent hover:underline">
                        {r.dossier.reference}
                      </Link>
                    ) : (
                      <span className="text-muted">–</span>
                    ),
                },
                {
                  key: "state",
                  label: "État",
                  sortValue: (r) => ORDRE_ETAT[r.state] * 10_000 + (r.waitlist_rank ?? 0),
                  render: (r) => (
                    <span className="flex flex-col items-start gap-0.5">
                      <Badge tone={ETAT_INSCRIPTION[r.state]}>{r.state_label}</Badge>
                      {r.state === "waitlist" && r.waitlist_rank ? (
                        <span className="whitespace-nowrap text-[11.5px] text-muted" title={r.waitlist_since ? `En attente depuis le ${fmtDateTime(r.waitlist_since)}` : undefined}>
                          {r.waitlist_rank === 1 ? "1re place libre" : `Rang ${fmtInt(r.waitlist_rank)}`}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                { key: "note", label: "Question ou attente", render: (r) => (r.note ? <span className="line-clamp-2 max-w-[260px] text-[12.5px] text-ink-2" title={r.note}>{r.note}</span> : <span className="text-muted">–</span>) },
                { key: "date", label: "Inscrit", sortValue: (r) => r.date, render: (r) => <span className="whitespace-nowrap text-[12.5px] text-muted" title={fmtDateTime(r.date)}>{quand(r.date)}</span> },
                ...(ecriture
                  ? [
                      {
                        key: "pointage",
                        label: "",
                        render: (r: Inscription) =>
                          r.state === "cancelled" ? null : r.state === "waitlist" ? (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" loading={enCours === r.id} disabled={occupe} title="Lui donner une place, au-delà de la limite au besoin" onClick={() => void pointer(r, "registered")}>
                                Inscrire
                              </Button>
                              <Button variant="ghost" size="sm" disabled={occupe} onClick={() => void pointer(r, "cancelled")}>
                                Retirer
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <div role="group" aria-label={`Pointage de ${r.user}`} aria-busy={enCours === r.id || undefined} className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
                                {(["attended", "absent"] as const).map((s) => {
                                  const actif = r.state === s;
                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      aria-pressed={actif}
                                      aria-label={`${r.user} ${s === "attended" ? "présent" : "absent"}`}
                                      disabled={occupe}
                                      title={actif ? "Annuler le pointage" : undefined}
                                      onClick={() => void pointer(r, actif ? "registered" : s)}
                                      className={cx(
                                        "rounded-md px-2.5 py-1 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                                        actif ? (s === "attended" ? "bg-ok-doux text-ok-texte" : "bg-danger-doux text-danger") : "text-muted hover:text-ink",
                                      )}
                                    >
                                      {s === "attended" ? "Présent" : "Absent"}
                                    </button>
                                  );
                                })}
                              </div>
                              {r.state === "registered" && (
                                <button type="button" aria-label={`Désinscrire ${r.user}`} title="Désinscrire" disabled={occupe} onClick={() => void pointer(r, "cancelled")} className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger disabled:cursor-not-allowed disabled:opacity-40">
                                  <XCircle className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </Etat>
      </div>
    </Modal>
  );
}
