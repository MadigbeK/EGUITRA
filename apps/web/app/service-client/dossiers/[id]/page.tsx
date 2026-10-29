"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Paperclip, Send } from "@/components/icons";
import { BadgeEtat, BadgePriorite, BadgeRetard, Etoiles, Fil } from "@/components/service-client/commun";
import { Badge, Button, Card, Etat, Field, Input, Notice, Select, Tabs, Tag, Textarea } from "@/components/ui";
import { apiGet, apiSend, apiUpload, messageErreur, useApi } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import { CANAUX, PIECES_ACCEPTEES, PRIORITES, TYPES, type Canal, type ContexteSC, type FicheDossier, type LigneDossier } from "@/lib/service-client";

export default function FicheDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useApi<FicheDossier>(`/service-client/tickets/${id}`);
  const { data: ctx } = useApi<ContexteSC>("/service-client/context");
  const maj = (f: FicheDossier) => void mutate(f, { revalidate: false });
  return (
    <div>
      <Link href="/service-client" className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
        <ChevronLeft className="h-4 w-4" /> Dossiers
      </Link>
      <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement du dossier…">
        {(d) => (
          <>
            <EnTete d={d} />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-5">
                {d.description && (
                  <Card title="Demande">
                    <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{d.description}</p>
                  </Card>
                )}
                <Card title="Fil du dossier">
                  <Fil messages={d.messages} base={`/service-client/tickets/${d.id}`} interne />
                </Card>
                {(d.can.reply || d.can.note) && ctx && <Repondre d={d} ctx={ctx} onFait={maj} />}
              </div>
              <div className="space-y-5">
                <Traitement d={d} onFait={maj} />
                {d.can.manage && ctx && <Fiche d={d} ctx={ctx} onFait={maj} />}
                <Echeances d={d} />
                <Client d={d} onFait={maj} />
                {d.can.manage && ctx && <FicheLiee d={d} ctx={ctx} onFait={maj} />}
                {d.can.manage && d.hsseq_available && d.kind === "complaint" && <Hsseq d={d} onFait={maj} />}
                <Satisfaction d={d} onFait={maj} />
                {d.can.manage && <Fusion d={d} />}
              </div>
            </div>
          </>
        )}
      </Etat>
    </div>
  );
}

function useAction(onFait: (f: FicheDossier) => void) {
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  async function agir(cle: string, appel: () => Promise<FicheDossier>) {
    setEnvoi(cle);
    setErreur(null);
    try {
      onFait(await appel());
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    } finally {
      setEnvoi(null);
    }
  }
  return { envoi, erreur, agir };
}

function Erreur({ texte }: { texte: string | null }) {
  return texte ? <p className="mt-2 text-[13px] font-semibold text-danger">{texte}</p> : null;
}

function EnTete({ d }: { d: FicheDossier }) {
  return (
    <header className="mb-5">
      <div className="text-[13px] font-semibold tabular text-muted">
        {d.name} · {d.kind_label} · {d.channel_label}
      </div>
      <h1 className="mt-1 font-display text-[26px] font-[650] leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">{d.subject}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <BadgeEtat etat={d.state} />
        <BadgePriorite priorite={d.priority} />
        <BadgeRetard late={d.late} />
        {d.sender_unverified && <Badge tone="danger">Expéditeur non vérifié</Badge>}
        {d.category && <Tag>{d.category.name}</Tag>}
        <Tag>{d.company.name}</Tag>
        {d.merged_into && (
          <Link href={`/service-client/dossiers/${d.merged_into.id}`} className="text-[13px] font-semibold text-accent hover:underline">
            Fusionné dans {d.merged_into.name}
          </Link>
        )}
      </div>
      {d.sender_unverified && (
        <div className="mt-3">
          <Notice tone="warn">Expéditeur non vérifié : l&apos;adresse ou le numéro ne correspond à aucun contact authentifié de la société. Vérifiez l&apos;identité avant de communiquer des informations, puis rattachez le dossier au client (ou fusionnez-le avec son dossier).</Notice>
        </div>
      )}
    </header>
  );
}

function Repondre({ d, ctx, onFait }: { d: FicheDossier; ctx: ContexteSC; onFait: (f: FicheDossier) => void }) {
  const [onglet, setOnglet] = useState<"reponse" | "note">(d.can.reply ? "reponse" : "note");
  const [texte, setTexte] = useState("");
  const [canal, setCanal] = useState<Canal>(d.channel);
  const [modele, setModele] = useState("");
  const [fichiers, setFichiers] = useState<File[]>([]);
  const { envoi, erreur, agir } = useAction(onFait);
  const modeles = ctx.templates.filter((t) => t.active && (!t.category || t.category.id === d.category?.id));

  async function choisirModele(id: string) {
    setModele(id);
    if (!id) return;
    const r = await apiGet<{ body: string }>(`/service-client/tickets/${d.id}/templates/${id}`).catch(() => null);
    if (r) setTexte(r.body);
  }

  async function envoyer() {
    const form = new FormData();
    form.set("body", texte);
    if (onglet === "reponse") {
      form.set("channel", canal);
      if (modele) form.set("template_id", modele);
    }
    for (const f of fichiers) form.append("files", f);
    const ok = await agir(onglet, () => apiUpload<FicheDossier>(`/service-client/tickets/${d.id}/${onglet === "reponse" ? "reply" : "note"}`, form));
    if (ok) {
      setTexte("");
      setFichiers([]);
      setModele("");
    }
  }

  const avertissement =
    onglet === "reponse" && canal === "whatsapp" && !d.wa_window_open
      ? ctx.channels.whatsapp.template
        ? "Plus de 24 heures depuis le dernier message WhatsApp du client : le modèle approuvé partira d'abord, votre message dès que le client répondra."
        : "Plus de 24 heures depuis le dernier message WhatsApp du client et aucun modèle approuvé n'est réglé : répondez par un autre canal."
      : onglet === "reponse" && ["phone", "visit", "letter"].includes(canal)
        ? "Réponse donnée de vive voix ou par courrier : elle est notée dans le fil, rien n'est envoyé."
        : onglet === "reponse" && canal === "portal" && d.client_accounts.length === 0
          ? "Le client n'a pas de compte dans l'espace client : choisissez un autre canal."
          : null;

  return (
    <Card padded={false}>
      <div className="px-5 pt-3">
        <Tabs
          tabs={[...(d.can.reply ? [{ key: "reponse" as const, label: "Répondre au client" }] : []), { key: "note" as const, label: "Note interne" }]}
          value={onglet}
          onChange={setOnglet}
        />
      </div>
      <div className="space-y-3 px-5 pb-5 pt-3">
        {onglet === "reponse" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Canal d'envoi">
              <Select value={canal} onChange={(e) => setCanal(e.target.value as Canal)} options={CANAUX.map((c) => ({ value: c.value, label: c.label }))} />
            </Field>
            <Field label="Réponse type">
              <Select value={modele} onChange={(e) => void choisirModele(e.target.value)} options={[{ value: "", label: "Aucune" }, ...modeles.map((t) => ({ value: t.id, label: t.name }))]} />
            </Field>
          </div>
        )}
        {onglet === "note" && <Notice tone="warn">Une note interne n&apos;est jamais visible du client ni envoyée.</Notice>}
        {avertissement && <Notice tone="warn">{avertissement}</Notice>}
        <Textarea rows={6} value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={onglet === "reponse" && canal === "whatsapp" ? 4000 : 10000} aria-label="Texte" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-accent">
            <Paperclip className="h-4 w-4" /> Joindre des pièces ({fichiers.length})
            <input type="file" multiple accept={PIECES_ACCEPTEES} className="sr-only" onChange={(e) => setFichiers(Array.from(e.target.files ?? []).slice(0, 5))} />
          </label>
          <Button variant="primary" loading={envoi !== null} disabled={!texte.trim() && !fichiers.length} onClick={envoyer}>
            <Send className="h-4 w-4" /> {onglet === "reponse" ? "Envoyer la réponse" : "Ajouter la note"}
          </Button>
        </div>
        <Erreur texte={erreur} />
      </div>
    </Card>
  );
}

function Traitement({ d, onFait }: { d: FicheDossier; onFait: (f: FicheDossier) => void }) {
  const { envoi, erreur, agir } = useAction(onFait);
  if (!d.can.transitions.length) return null;
  return (
    <Card title="Traitement">
      <div className="flex flex-wrap gap-2">
        {d.can.transitions.map((t) => (
          <Button key={t.state} size="sm" variant={t.state === "resolved" ? "primary" : "secondary"} loading={envoi === t.state} disabled={envoi !== null} onClick={() => void agir(t.state, () => apiSend<FicheDossier>("POST", `/service-client/tickets/${d.id}/state`, { state: t.state }))}>
            {t.label}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-snug text-muted">« En attente du client » arrête l&apos;horloge de la résolution ; sa réponse relance le dossier. « Résolu » demande sa satisfaction au client.</p>
      <Erreur texte={erreur} />
    </Card>
  );
}

function Fiche({ d, ctx, onFait }: { d: FicheDossier; ctx: ContexteSC; onFait: (f: FicheDossier) => void }) {
  const [f, setF] = useState({ category_id: String(d.category?.id ?? ""), kind: d.kind, priority: d.priority, user_id: String(d.user?.id ?? ""), team_id: String(d.team?.id ?? "") });
  const { envoi, erreur, agir } = useAction(onFait);
  useEffect(() => setF({ category_id: String(d.category?.id ?? ""), kind: d.kind, priority: d.priority, user_id: String(d.user?.id ?? ""), team_id: String(d.team?.id ?? "") }), [d.category?.id, d.kind, d.priority, d.user?.id, d.team?.id]);
  return (
    <Card title="Classement et affectation">
      <div className="space-y-3">
        <Field label="Catégorie">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} options={[{ value: "", label: "Aucune" }, ...ctx.categories.filter((c) => c.active || c.id === d.category?.id).map((c) => ({ value: c.id, label: c.name }))]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} />
          </Field>
          <Field label="Priorité">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })} options={PRIORITES.map((p) => ({ value: p.value, label: p.label }))} />
          </Field>
        </div>
        <Field label="Responsable">
          <Select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} options={[{ value: "", label: "Aucun" }, ...ctx.assignees.map((u) => ({ value: u.id, label: u.name }))]} />
        </Field>
        <Field label="Équipe">
          <Select value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })} options={[{ value: "", label: "Aucune" }, ...ctx.teams.map((t) => ({ value: t.id, label: t.name }))]} />
        </Field>
        <Button
          size="sm"
          loading={envoi === "fiche"}
          onClick={() =>
            void agir("fiche", () =>
              apiSend<FicheDossier>("PATCH", `/service-client/tickets/${d.id}`, {
                category_id: f.category_id ? Number(f.category_id) : null,
                kind: f.kind,
                priority: f.priority,
                ...(String(d.user?.id ?? "") !== f.user_id ? { user_id: f.user_id ? Number(f.user_id) : null } : {}),
                ...(String(d.team?.id ?? "") !== f.team_id ? { team_id: f.team_id ? Number(f.team_id) : null } : {}),
              }),
            )
          }
        >
          Enregistrer
        </Button>
        <Erreur texte={erreur} />
      </div>
    </Card>
  );
}

function Ligne({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-muted">{libelle}</span>
      <span className="text-right font-medium text-ink">{children}</span>
    </div>
  );
}

function Echeances({ d }: { d: FicheDossier }) {
  return (
    <Card title="Échéances">
      <Ligne libelle="Ouvert le">{fmtDateTime(d.date_open)}</Ligne>
      <Ligne libelle="Première réponse avant le">{fmtDateTime(d.first_response_due)}</Ligne>
      <Ligne libelle="Première réponse le">{d.first_response ? fmtDateTime(d.first_response) : "–"}</Ligne>
      <Ligne libelle="Résolution avant le">{fmtDateTime(d.resolution_due)}</Ligne>
      <Ligne libelle="Résolu le">{d.resolved ? fmtDateTime(d.resolved) : "–"}</Ligne>
      {d.escalation > 0 && <Ligne libelle="Escalade">{d.escalation === 1 ? "Responsable prévenu" : "Direction prévenue"}</Ligne>}
    </Card>
  );
}

function Client({ d, onFait }: { d: FicheDossier; onFait: (f: FicheDossier) => void }) {
  const [saisie, setSaisie] = useState("");
  const [trouves, setTrouves] = useState<Array<{ id: number; name: string }>>([]);
  const { envoi, erreur, agir } = useAction(onFait);
  useEffect(() => {
    if (!d.can.manage || saisie.trim().length < 2) {
      setTrouves([]);
      return;
    }
    const t = setTimeout(() => {
      apiGet<{ partners: Array<{ id: number; name: string }> }>(`/service-client/clients?q=${encodeURIComponent(saisie.trim())}`)
        .then((r) => setTrouves(r.partners))
        .catch(() => setTrouves([]));
    }, 300);
    return () => clearTimeout(t);
  }, [saisie, d.can.manage]);
  return (
    <Card title="Client">
      <Ligne libelle="Client">{d.partner?.name ?? "Contact non client"}</Ligne>
      <Ligne libelle="Contact">{d.contact.name ?? "–"}</Ligne>
      <Ligne libelle="Téléphone">{d.contact.phone ?? "–"}</Ligne>
      <Ligne libelle="Courriel">{d.contact.email ?? "–"}</Ligne>
      <Ligne libelle="Espace client">{d.client_accounts.length ? d.client_accounts.map((a) => a.name).join(", ") : "Aucun compte"}</Ligne>
      {d.previous && (
        <Ligne libelle="Suite du dossier">
          <Link href={`/service-client/dossiers/${d.previous.id}`} className="text-accent hover:underline">
            {d.previous.name}
          </Link>
        </Ligne>
      )}
      {d.can.manage && (
        <div className="mt-3 border-t border-line pt-3">
          <Field label={d.partner ? "Changer de client" : "Rattacher à un client"} hint="Après vérification de l'identité du contact.">
            <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder="Nom, téléphone ou courriel du client" />
          </Field>
          {trouves.map((p) => (
            <div key={p.id} className="mt-2 flex items-center justify-between gap-2 text-[13px]">
              <span>{p.name}</span>
              <Button size="sm" loading={envoi === `p${p.id}`} onClick={() => void agir(`p${p.id}`, () => apiSend<FicheDossier>("PATCH", `/service-client/tickets/${d.id}`, { partner_id: p.id }))}>
                Rattacher
              </Button>
            </div>
          ))}
          <Erreur texte={erreur} />
        </div>
      )}
    </Card>
  );
}

function FicheLiee({ d, ctx, onFait }: { d: FicheDossier; ctx: ContexteSC; onFait: (f: FicheDossier) => void }) {
  const [modele, setModele] = useState(ctx.links[0]?.model ?? "");
  const [q, setQ] = useState("");
  const [trouves, setTrouves] = useState<Array<{ id: number; label: string; detail: string }>>([]);
  const { envoi, erreur, agir } = useAction(onFait);
  useEffect(() => {
    if (!modele) return;
    const t = setTimeout(() => {
      const partenaire = d.partner ? `&partner_id=${d.partner.id}` : "";
      apiGet<Array<{ id: number; label: string; detail: string }>>(`/service-client/links?model=${encodeURIComponent(modele)}&q=${encodeURIComponent(q.trim())}${partenaire}`)
        .then(setTrouves)
        .catch(() => setTrouves([]));
    }, 300);
    return () => clearTimeout(t);
  }, [modele, q, d.partner]);
  return (
    <Card title="Fiche liée">
      {d.link ? (
        <div className="mb-3 flex items-center justify-between gap-2 text-[13px]">
          <span>
            {d.link.type} : {d.link.href ? <Link href={d.link.href} className="font-semibold text-accent hover:underline">{d.link.label}</Link> : (d.link.label ?? "fiche introuvable")}
          </span>
          <Button size="sm" variant="ghost" loading={envoi === "retirer"} onClick={() => void agir("retirer", () => apiSend<FicheDossier>("PATCH", `/service-client/tickets/${d.id}`, { link_model: null, link_id: null }))}>
            Retirer
          </Button>
        </div>
      ) : (
        <p className="mb-3 text-[13px] text-muted">Facture, rotation, bail ou bien, chantier, dossier AxisPro ou offre du client.</p>
      )}
      <div className="grid gap-2">
        <Select value={modele} onChange={(e) => setModele(e.target.value)} options={ctx.links.map((l) => ({ value: l.model, label: l.type }))} aria-label="Nature de la fiche" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numéro ou nom" aria-label="Rechercher la fiche" />
      </div>
      <ul className="mt-2 space-y-1.5">
        {trouves.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
            <span>
              <span className="font-medium text-ink">{r.label}</span>
              {r.detail && <span className="block text-[12px] text-muted">{r.detail}</span>}
            </span>
            <Button size="sm" loading={envoi === `l${r.id}`} onClick={() => void agir(`l${r.id}`, () => apiSend<FicheDossier>("PATCH", `/service-client/tickets/${d.id}`, { link_model: modele, link_id: r.id }))}>
              Lier
            </Button>
          </li>
        ))}
      </ul>
      <Erreur texte={erreur} />
    </Card>
  );
}

function Hsseq({ d, onFait }: { d: FicheDossier; onFait: (f: FicheDossier) => void }) {
  const { data } = useApi<{ available: boolean; natures: Array<{ code: string; label: string }>; complaints: Array<{ id: number; reference: string; received_on: string; description: string }> }>(d.hsseq ? null : `/service-client/tickets/${d.id}/hsseq`);
  const [nature, setNature] = useState("");
  const { envoi, erreur, agir } = useAction(onFait);
  return (
    <Card title="Réclamation de qualité (HSSEQ)">
      {d.hsseq ? (
        <p className="text-[13px]">
          Liée à la réclamation <strong>{d.hsseq.reference}</strong> d&apos;HSSEQ ({d.hsseq.status ?? "état inconnu"}).
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">{d.hsseq_suggested ? "Cette catégorie relève de la qualité : le responsable HSSEQ en suit l'enquête." : "Produit transporté, déversement, sécurité : transmettez la réclamation à HSSEQ."}</p>
          <Field label="Nature">
            <Select value={nature} onChange={(e) => setNature(e.target.value)} options={[{ value: "", label: "Celle de la catégorie" }, ...(data?.natures ?? []).map((n) => ({ value: n.code, label: n.label }))]} />
          </Field>
          <Button size="sm" variant="primary" loading={envoi === "creer"} disabled={!d.partner} onClick={() => void agir("creer", () => apiSend<FicheDossier>("POST", `/service-client/tickets/${d.id}/hsseq`, { mode: "create", nature: nature || null }))}>
            Créer la réclamation HSSEQ
          </Button>
          {!d.partner && <p className="text-[12.5px] text-muted">Rattachez d&apos;abord le dossier à un client.</p>}
          {(data?.complaints ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span>
                {c.reference} <span className="block text-[12px] text-muted">{c.description}</span>
              </span>
              <Button size="sm" loading={envoi === `j${c.id}`} onClick={() => void agir(`j${c.id}`, () => apiSend<FicheDossier>("POST", `/service-client/tickets/${d.id}/hsseq`, { mode: "join", complaint_id: c.id }))}>
                Rejoindre
              </Button>
            </div>
          ))}
        </div>
      )}
      <Erreur texte={erreur} />
    </Card>
  );
}

function Satisfaction({ d, onFait }: { d: FicheDossier; onFait: (f: FicheDossier) => void }) {
  const [note, setNote] = useState<number | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const { envoi, erreur, agir } = useAction(onFait);
  const s = d.satisfaction;
  const resolu = d.state === "resolved" || d.state === "closed";
  return (
    <Card title="Satisfaction du client">
      {s.score ? (
        <div className="space-y-1">
          <Etoiles valeur={s.score} />
          {s.comment && <p className="whitespace-pre-line text-[13px] text-ink-2">« {s.comment} »</p>}
          <p className="text-[12px] text-muted">Notée le {fmtDateTime(s.date)}.</p>
        </div>
      ) : !resolu ? (
        <p className="text-[13px] text-muted">Demandée au client à la résolution, par le canal du dossier.</p>
      ) : d.can.manage ? (
        <div className="space-y-2">
          <p className="text-[13px] text-ink-2">{s.requested ? "Demandée au client ; vous pouvez aussi la noter s'il la donne au téléphone." : "À recueillir auprès du client."}</p>
          <Etoiles valeur={note} onChange={setNote} />
          <Textarea rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Commentaire du client" maxLength={2000} />
          <Button size="sm" disabled={!note} loading={envoi === "note"} onClick={() => void agir("note", () => apiSend<FicheDossier>("POST", `/service-client/tickets/${d.id}/satisfaction`, { score: note, comment: commentaire }))}>
            Enregistrer la note
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted">En attente de la note du client.</p>
      )}
      <Erreur texte={erreur} />
    </Card>
  );
}

function Fusion({ d }: { d: FicheDossier }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [trouves, setTrouves] = useState<LigneDossier[]>([]);
  const { envoi, erreur, agir } = useAction((garde) => router.push(`/service-client/dossiers/${garde.id}`));
  useEffect(() => {
    if (q.trim().length < 3) {
      setTrouves([]);
      return;
    }
    const t = setTimeout(() => {
      apiGet<{ items: LigneDossier[] }>(`/service-client/tickets?state=open&q=${encodeURIComponent(q.trim())}&limit=8`)
        .then((r) => setTrouves(r.items.filter((x) => x.id !== d.id)))
        .catch(() => setTrouves([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, d.id]);
  if (d.merged_into || d.state === "closed") return null;
  return (
    <Card title="Doublon">
      <Field label="Fusionner ce dossier dans" hint="Le fil passe au dossier gardé ; celui-ci est clos et marqué « fusionné ».">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numéro ou objet du dossier à garder" />
      </Field>
      {trouves.map((t) => (
        <div key={t.id} className="mt-2 flex items-center justify-between gap-2 text-[13px]">
          <span>
            <span className="font-semibold tabular">{t.name}</span> {t.subject}
          </span>
          <Button size="sm" variant="danger" loading={envoi === `f${t.id}`} onClick={() => void agir(`f${t.id}`, () => apiSend<FicheDossier>("POST", `/service-client/tickets/${d.id}/merge`, { into_id: t.id }))}>
            Fusionner
          </Button>
        </div>
      ))}
      <Erreur texte={erreur} />
    </Card>
  );
}
