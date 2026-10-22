"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Calendar, CheckCheck, Download, Flag, HandCoins, Inbox, Info, Pencil, Plus, Send, Trash2, type Icon } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import {
  ChoixPublic, Coche, EditeurTexte, LectureSeule, PUBLIC_VIDE, RESERVE_CABINET, Recherche, correspond, etatPublication, messageErreur, nomFichier, pluriel, publicIncomplet,
  resumePublic, telechargerCsv, useEcriture, useRetour, type PublicSaisi,
} from "@/components/portail/cabinet/outils";
import { quand } from "@/components/portail/commun";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, IconTile, Input, Loading, Modal, Notice, PageHeader, ProgressBar, Segmented, Select, Tabs, Tag, cx, type Teinte } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { AnnouncementAdmin, AnnouncementKind, Cibles, PublicationState } from "@/lib/portail-types";

const NATURE: Record<AnnouncementKind, { icon: Icon; teinte: Teinte }> = {
  info: { icon: Info, teinte: "azur" },
  important: { icon: Flag, teinte: "or" },
  opportunity: { icon: HandCoins, teinte: "jade" },
  event: { icon: Calendar, teinte: "lagon" },
  alert: { icon: AlertTriangle, teinte: "corail" },
};

type Onglet = "all" | PublicationState;

function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function expiree(a: AnnouncementAdmin) {
  return Boolean(a.expire_date && a.expire_date < aujourdhui());
}

export default function CommunicationsPage() {
  const ecriture = useEcriture();
  const { data, error, mutate } = useApi<AnnouncementAdmin[]>("/axispro/portail/annonces");
  const { data: cibles, error: erreurCibles } = useApi<Cibles>("/axispro/portail/cibles");
  const [onglet, setOnglet] = useState<Onglet>("all");
  const [q, setQ] = useState("");
  const [edition, setEdition] = useState<AnnouncementAdmin | "nouvelle" | null>(null);
  const [lectures, setLectures] = useState<AnnouncementAdmin | null>(null);
  const { agir, bandeau } = useRetour();

  const toutes = data ?? [];
  const compte = (s: PublicationState) => toutes.filter((a) => a.state === s).length;
  const rows = toutes.filter((a) => (onglet === "all" || a.state === onglet) && correspond(q, a.title, a.excerpt, a.kind_label, a.author));

  async function etat(a: AnnouncementAdmin, action: "publier" | "archiver" | "supprimer") {
    const questions = {
      publier: `Publier « ${a.title} » ? Les porteurs visés (${resumePublic(a).toLowerCase()}) seront prévenus sur leur portail.`,
      archiver: `Archiver « ${a.title} » ? Elle disparaîtra du portail des porteurs.`,
      supprimer: `Supprimer définitivement le brouillon « ${a.title} » ?`,
    };
    if (!window.confirm(questions[action])) return;
    const ok = { publier: "Communication publiée : les porteurs visés sont prévenus.", archiver: "Communication archivée.", supprimer: "Brouillon supprimé." };
    const r = await agir(() => apiSend("POST", `/axispro/portail/annonces/${a.id}/${action}`), ok[action]);
    if (r !== undefined) await mutate();
  }

  return (
    <div>
      <PageHeader
        title="Communications aux porteurs"
        subtitle="Informations, opportunités de financement et alertes publiées sur le portail. Chaque communication vise tous les porteurs ou un public choisi ; l'accusé de lecture se demande au besoin."
        actions={
          <Button variant="primary" disabled={!ecriture || !cibles} title={!ecriture ? RESERVE_CABINET : undefined} onClick={() => setEdition("nouvelle")}>
            <Plus className="h-4 w-4" /> Nouvelle communication
          </Button>
        }
      />
      <OngletsPortail />
      <div className="space-y-4">
        <LectureSeule ecriture={ecriture} />
        {bandeau}
        {error && <ErrorBox error={error} onRetry={() => void mutate()} />}
        {erreurCibles && <Notice tone="danger">{messageErreur(erreurCibles)}</Notice>}

        <div className="flex flex-wrap items-end justify-between gap-x-4">
          <Tabs
            value={onglet}
            onChange={setOnglet}
            tabs={[
              { key: "all", label: "Toutes", count: toutes.length },
              { key: "draft", label: "Brouillons", count: compte("draft") },
              { key: "published", label: "Publiées", count: compte("published") },
              { key: "archived", label: "Archivées", count: compte("archived") },
            ]}
          />
          <Recherche className="mb-5 w-full sm:w-72" label="Rechercher une communication" placeholder="Titre, texte, auteur" value={q} onChange={setQ} />
        </div>

        <Card padded={false}>
          {!data ? (
            !error && <Loading label="Chargement des communications…" />
          ) : rows.length === 0 ? (
            <Empty title={toutes.length ? "Aucune communication dans cette sélection." : "Aucune communication pour l'instant."} hint={toutes.length ? undefined : "Rédigez une première communication : elle reste en brouillon tant que vous ne la publiez pas."} />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((a) => (
                <LigneCommunication key={a.id} a={a} ecriture={ecriture} onEditer={() => setEdition(a)} onLectures={() => setLectures(a)} onEtat={(action) => void etat(a, action)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {edition && cibles && (
        <Editeur
          annonce={edition === "nouvelle" ? null : edition}
          cibles={cibles}
          ecriture={ecriture}
          onClose={() => setEdition(null)}
          onSaved={async (texte) => {
            setEdition(null);
            await agir(() => mutate(), texte);
          }}
        />
      )}
      {lectures && <Lectures annonce={lectures} onClose={() => setLectures(null)} />}
    </div>
  );
}

function LigneCommunication({ a, ecriture, onEditer, onLectures, onEtat }: { a: AnnouncementAdmin; ecriture: boolean; onEditer: () => void; onLectures: () => void; onEtat: (action: "publier" | "archiver" | "supprimer") => void }) {
  const n = NATURE[a.kind];
  const e = etatPublication(a.state, true);
  const fin = expiree(a);
  const s = a.stats;
  const blocage = !ecriture ? RESERVE_CABINET : undefined;
  return (
    <li className={cx("px-5 py-4 sm:px-6", a.state === "archived" && "bg-panel-2/40")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <IconTile icon={n.icon} teinte={n.teinte} className="mt-0.5 hidden h-9 w-9 sm:grid" />
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onEditer} className="text-left font-semibold text-ink hover:text-accent hover:underline">
              {a.title}
            </button>
            <Badge tone={e.tone}>{e.label}</Badge>
            <Tag>{a.kind_label}</Tag>
            {a.pinned && <Badge tone="accent">Épinglée</Badge>}
            {a.require_ack && <Badge>Accusé de lecture demandé</Badge>}
            {fin && a.state === "published" && <Badge tone="danger">Expirée</Badge>}
          </div>
          {a.excerpt && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">{a.excerpt}</p>}
          <p className="mt-1 text-[12px] text-muted">
            {a.author}
            {a.published_at ? `, publiée ${quand(a.published_at)}` : ""}
            {`. Public : ${resumePublic(a)}`}
            {a.expire_date ? `. Visible jusqu'au ${fmtDate(a.expire_date)}` : ""}.
          </p>
        </div>

        {a.state !== "draft" && (
          <div className="w-full min-w-[190px] space-y-2 sm:w-52">
            <Jauge label="Lue" valeur={s.read} total={s.audience} />
            {a.require_ack && <Jauge label="Accusés" valeur={s.acknowledged} total={s.audience} alerte />}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {a.state !== "draft" && (
            <Button variant="ghost" size="sm" onClick={onLectures}>
              <CheckCheck className="h-4 w-4" /> Lectures
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onEditer}>
            <Pencil className="h-3.5 w-3.5" /> {ecriture ? "Modifier" : "Voir"}
          </Button>
          {a.state !== "published" && (
            <Button variant="primary" size="sm" disabled={!ecriture} title={blocage} onClick={() => onEtat("publier")}>
              <Send className="h-3.5 w-3.5" /> {a.state === "archived" ? "Republier" : "Publier"}
            </Button>
          )}
          {a.state === "published" && (
            <Button variant="secondary" size="sm" disabled={!ecriture} title={blocage} onClick={() => onEtat("archiver")}>
              <Inbox className="h-3.5 w-3.5" /> Archiver
            </Button>
          )}
          {a.state === "draft" && (
            <button type="button" aria-label={`Supprimer le brouillon ${a.title}`} title={blocage ?? "Supprimer le brouillon"} disabled={!ecriture} className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger disabled:cursor-not-allowed disabled:opacity-40" onClick={() => onEtat("supprimer")}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Jauge({ label, valeur, total, alerte }: { label: string; valeur: number; total: number; alerte?: boolean }) {
  const pct = total ? Math.round((valeur / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular text-ink">
          {valeur}
          {total ? ` / ${total}` : ""}
          {total ? <span className="ml-1 font-normal text-muted">{pct} %</span> : null}
        </span>
      </div>
      <ProgressBar value={pct} epaisseur={6} tone={alerte && total && valeur < total ? "warn" : "accent"} />
    </div>
  );
}

/* ─── Éditeur ──────────────────────────────────────────────────────────── */

interface Saisie extends PublicSaisi {
  title: string;
  kind: AnnouncementKind;
  body: string;
  cta_url: string;
  cta_label: string;
  expire_date: string;
  pinned: boolean;
  require_ack: boolean;
}

function saisieDe(a: AnnouncementAdmin | null): Saisie {
  if (!a) return { ...PUBLIC_VIDE, title: "", kind: "info", body: "", cta_url: "", cta_label: "", expire_date: "", pinned: false, require_ack: false };
  return {
    audience: a.audience,
    dossier_ids: a.dossier_ids,
    gate_codes: a.gate_codes,
    sector_keywords: a.sector_keywords,
    title: a.title,
    kind: a.kind,
    body: a.body ?? "",
    cta_url: a.cta_url ?? "",
    cta_label: a.cta_label ?? "",
    expire_date: a.expire_date ?? "",
    pinned: a.pinned,
    require_ack: a.require_ack,
  };
}

function Editeur({ annonce, cibles, ecriture, onClose, onSaved }: { annonce: AnnouncementAdmin | null; cibles: Cibles; ecriture: boolean; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [f, setF] = useState<Saisie>(() => saisieDe(annonce));
  const [envoi, setEnvoi] = useState<"brouillon" | "publier" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const set = <K extends keyof Saisie>(k: K, v: Saisie[K]) => setF((x) => ({ ...x, [k]: v }));
  const etat = annonce?.state ?? "draft";

  function controle(): string | null {
    if (!f.title.trim()) return "Donnez un titre à la communication.";
    if (f.cta_url.trim() && !/^(https:\/\/|\/portail)/.test(f.cta_url.trim())) return "Le lien doit commencer par https:// ou mener à une page du portail (/portail…).";
    if (f.cta_label.trim() && !f.cta_url.trim()) return "Indiquez le lien du bouton, ou effacez son libellé.";
    if (f.body.length > 60_000) return "Texte trop long (60 000 caractères au plus).";
    return publicIncomplet(f);
  }

  async function enregistrer(publier: boolean) {
    const probleme = controle();
    if (probleme) {
      setErreur(probleme);
      return;
    }
    if (publier && etat !== "published" && !window.confirm("Publier cette communication ? Les porteurs visés seront prévenus sur leur portail.")) return;
    setEnvoi(publier ? "publier" : "brouillon");
    setErreur(null);
    const corps = {
      title: f.title.trim(),
      body: f.body,
      kind: f.kind,
      pinned: f.pinned,
      require_ack: f.require_ack,
      cta_url: f.cta_url.trim(),
      cta_label: f.cta_label.trim(),
      expire_date: f.expire_date || null,
      audience: f.audience,
      dossier_ids: f.audience === "dossiers" ? f.dossier_ids : [],
      gate_codes: f.audience === "gates" ? f.gate_codes : "",
      sector_keywords: f.audience === "sectors" ? f.sector_keywords : "",
    };
    try {
      if (!annonce) {
        await apiSend<AnnouncementAdmin>("POST", "/axispro/portail/annonces", { ...corps, publish: publier });
      } else {
        await apiSend<AnnouncementAdmin>("PATCH", `/axispro/portail/annonces/${annonce.id}`, corps);
        if (publier && etat !== "published") await apiSend("POST", `/axispro/portail/annonces/${annonce.id}/publier`);
      }
      await onSaved(publier && etat !== "published" ? "Communication publiée : les porteurs visés sont prévenus." : etat === "published" ? "Communication mise à jour." : "Brouillon enregistré.");
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(null);
    }
  }

  const titre = !annonce ? "Nouvelle communication" : ecriture ? "Modifier la communication" : "Communication";
  return (
    <Modal
      open
      wide
      title={titre}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {ecriture ? "Annuler" : "Fermer"}
          </Button>
          {ecriture && etat !== "published" && (
            <Button variant="secondary" loading={envoi === "brouillon"} disabled={envoi !== null} onClick={() => void enregistrer(false)}>
              {etat === "archived" ? "Enregistrer" : "Enregistrer le brouillon"}
            </Button>
          )}
          {ecriture && (
            <Button variant="primary" loading={envoi === "publier"} disabled={envoi !== null} onClick={() => void enregistrer(true)}>
              <Send className="h-4 w-4" /> {etat === "published" ? "Enregistrer" : etat === "archived" ? "Republier" : "Publier"}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={!ecriture} className="min-w-0 space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        {etat === "published" && <Notice tone="accent">Cette communication est publiée : vos modifications sont visibles des porteurs dès l&apos;enregistrement, sans nouvelle notification.</Notice>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Titre" className="md:col-span-2">
            <Input value={f.title} maxLength={200} placeholder="Exemple : appel à projets du fonds agricole" onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Nature">
            <Select value={f.kind} onChange={(e) => set("kind", e.target.value as AnnouncementKind)} options={cibles.announcement_kinds.map((k) => ({ value: k.key, label: k.label }))} />
          </Field>
        </div>
        <EditeurTexte label="Texte" value={f.body} onChange={(v) => set("body", v)} placeholder={"# Ce qu'il faut savoir\nLe fonds ouvre son appel le **15 novembre**.\n- Dossier complet\n- Plan d'affaires à jour\n> Votre consultant vous aide à le préparer."} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Lien du bouton" hint="https://… ou une page du portail (/portail/…)." className="md:col-span-2">
            <Input value={f.cta_url} maxLength={500} inputMode="url" placeholder="https://" onChange={(e) => set("cta_url", e.target.value)} />
          </Field>
          <Field label="Libellé du bouton" hint="Facultatif.">
            <Input value={f.cta_label} maxLength={80} placeholder="Exemple : Lire l'appel" onChange={(e) => set("cta_label", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Visible jusqu'au" hint="Vide : sans limite.">
            <Input type="date" value={f.expire_date} onChange={(e) => set("expire_date", e.target.value)} />
          </Field>
          <div className="space-y-3 md:col-span-2 md:pt-6">
            <Coche checked={f.pinned} onChange={(v) => set("pinned", v)} hint="Elle reste en tête des actualités du porteur.">
              Épinglée
            </Coche>
            <Coche checked={f.require_ack} onChange={(v) => set("require_ack", v)} hint="Le porteur confirme l'avoir lue ; le cabinet suit les accusés.">
              Accusé de lecture demandé
            </Coche>
          </div>
        </div>
        <ChoixPublic value={f} onChange={(p) => setF((x) => ({ ...x, ...p }))} cibles={cibles} />
      </fieldset>
    </Modal>
  );
}

/* ─── Lectures ─────────────────────────────────────────────────────────── */

type Lecture = { user: string; read_at: string | null; acknowledged_at: string | null };
type FiltreLecture = "tous" | "non_lue" | "sans_accuse";

function Lectures({ annonce, onClose }: { annonce: AnnouncementAdmin; onClose: () => void }) {
  const { data, error, mutate } = useApi<Lecture[]>(`/axispro/portail/annonces/${annonce.id}/lectures`);
  const [filtre, setFiltre] = useState<FiltreLecture>("tous");
  const rows = useMemo(() => {
    const base = [...(data ?? [])].sort((a, b) => a.user.localeCompare(b.user, "fr"));
    if (filtre === "non_lue") return base.filter((r) => !r.read_at);
    if (filtre === "sans_accuse") return base.filter((r) => !r.acknowledged_at);
    return base;
  }, [data, filtre]);
  const lues = (data ?? []).filter((r) => r.read_at).length;
  const accuses = (data ?? []).filter((r) => r.acknowledged_at).length;

  function exporter() {
    telechargerCsv(`lectures-${nomFichier(annonce.title)}.csv`, [
      ["Porteur", "Lue le", "Accusé de lecture le"],
      ...(data ?? []).map((r) => [r.user, r.read_at ? fmtDateTime(r.read_at) : "", r.acknowledged_at ? fmtDateTime(r.acknowledged_at) : ""]),
    ]);
  }

  return (
    <Modal
      open
      wide
      title={`Lectures : ${annonce.title}`}
      onClose={onClose}
      footer={
        <>
          <Button disabled={!data?.length} onClick={exporter}>
            <Download className="h-4 w-4" /> Exporter (CSV)
          </Button>
          <Button variant="primary" onClick={onClose}>
            Fermer
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorBox error={error} onRetry={() => void mutate()} />
      ) : !data ? (
        <Loading label="Chargement des lectures…" />
      ) : (
        <div className="space-y-4">
          <p className="text-[13.5px] text-ink-2">
            {pluriel(data.length, "porteur visé ou lecteur", "porteurs visés ou lecteurs")} : <b>{lues}</b> {lues > 1 ? "l'ont lue" : "l'a lue"}
            {annonce.require_ack ? (
              <>
                , <b>{accuses}</b> {accuses > 1 ? "ont accusé" : "a accusé"} lecture
              </>
            ) : null}
            .
          </p>
          <Segmented
            label="Lectures affichées"
            value={filtre}
            onChange={setFiltre}
            options={[
              { key: "tous", label: "Tous" },
              { key: "non_lue", label: `Pas encore lue (${data.length - lues})` },
              ...(annonce.require_ack ? [{ key: "sans_accuse" as const, label: `Sans accusé (${data.length - accuses})` }] : []),
            ]}
          />
          <div className="-mx-5">
            <DataTable
              dense
              rows={rows}
              rowKey={(r, i) => `${r.user}-${i}`}
              empty="Personne dans cette sélection."
              columns={[
                { key: "user", label: "Porteur", render: (r) => <span className="font-medium text-ink">{r.user}</span> },
                { key: "read_at", label: "Lue", sortValue: (r) => r.read_at, render: (r) => (r.read_at ? fmtDateTime(r.read_at) : <Badge tone="warn">Pas encore lue</Badge>) },
                ...(annonce.require_ack
                  ? [{ key: "acknowledged_at", label: "Accusé de lecture", sortValue: (r: Lecture) => r.acknowledged_at, render: (r: Lecture) => (r.acknowledged_at ? <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-ok" />{fmtDateTime(r.acknowledged_at)}</span> : <span className="text-muted">En attente</span>) }]
                  : []),
              ]}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
