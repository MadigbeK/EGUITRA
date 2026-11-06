"use client";

import { useState } from "react";
import { ApercuBon } from "@/components/commerce/ApercuBon";
import { MaSignature } from "@/components/commerce/SignatureApprobateur";
import { Check, Paperclip, X } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, Etat, Field, Input, Modal, Notice, PageHeader, Select, Tabs, Textarea, demanderConfirmation, type Tone } from "@/components/ui";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { useEnvoi } from "@/lib/envoi";
import { AIDE_NOMBRE, fmtDate, fmtDateTime, fmtGNF, fmtInt, lireNombre, nombreIllisible, pluriel } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes des circuits (addons/eguitra_approval/controllers/approvals.py) : lecture
// (GET /approvals/rules), création et modification (POST et PATCH, administration seule).
const CIRCUITS_LECTURE: Profile[] = ["admin", "direction", "finance"];
const CIRCUITS_ECRITURE: Profile[] = ["admin"];

export interface Req {
  id: number;
  name: string;
  document: string;
  res_model?: string;
  res_id?: number;
  amount: number;
  partner: string | null;
  company: string;
  requested_by: string;
  requested_at: string;
  state: "pending" | "approved" | "rejected" | "cancelled";
  pending_with: string | null;
  can_decide: boolean;
  steps?: Step[];
  /** label : catégorie de dépense ou libellé du compte, en clair ; account : le code du compte. */
  document_detail?: { name: string | null; ref?: string | null; date: string; state: string; lines?: Array<{ name: string; account: string; label?: string | null; amount: number }> };
  /** Justificatifs des documents de la demande (facture, devis, proforma), ouverts par la demande elle-même. */
  attachments?: Array<{ id: number; name: string; mimetype: string | null; size: number }>;
}
interface Step { sequence: number; label: string; profile: string; state: string; decided_by: string | null; decided_at: string | null; comment: string | null }
interface Rule { id: number; name: string; document: string; document_label: string; sequence: number; min_amount: number; max_amount: number | null; account_prefix: string | null; approver_profile: string; approver_label: string; active: boolean }
/** Page de demandes (GET /approvals/requests?paged=1) : la page et le total des demandes visibles. */
interface PageDemandes { items: Req[]; total: number; offset: number; limit: number }

const STATE = { pending: ["En attente", "warn"], approved: ["Approuvée", "ok"], rejected: ["Refusée", "danger"], cancelled: ["Annulée", "neutral"] } as const;

type Onglet = "inbox" | "mine" | "pending" | "rejected" | "all" | "rules";

/** Filtres de la liste des demandes, par onglet. */
const FILTRES: Partial<Record<Onglet, string>> = {
  mine: "mine=1",
  pending: "mine=1&state=pending",
  rejected: "mine=1&state=rejected",
  all: "",
};
const PAGE = 100;

/** Ce que produit la dernière approbation d'une demande, selon sa nature. */
const EFFET_FINAL: Record<string, string> = {
  commitment: "L'engagement sera engagé : les factures du fournisseur pourront le consommer.",
  purchase_order: "Le bon de commande sera approuvé : il pourra être envoyé au fournisseur.",
  in_invoice: "La pièce sera comptabilisée.",
  payment_out: "Le règlement sera comptabilisé.",
  cash_out: "Le décaissement sera comptabilisé.",
  entry: "L'opération diverse sera comptabilisée.",
};

/**
 * Confirmation d'une approbation. À la dernière étape (la pièce est comptabilisée, la dépense engagée,
 * sans retour possible), toujours. Aux étapes précédentes, seulement depuis une liste (tableau de bord) :
 * la demande n'y a pas été ouverte. `r` : la demande lue avec ses étapes (GET /approvals/<id>).
 */
export async function confirmerApprobation(r: Req, depuisListe = false): Promise<boolean> {
  const derniere = (r.steps?.filter((s) => s.state === "pending").length ?? 0) === 1;
  if (!derniere && !depuisListe) return true;
  const question = depuisListe ? `Approuver « ${r.name} » (${fmtGNF(r.amount)}${r.partner ? `, ${r.partner}` : ""}) ?` : "Approuver la demande ?";
  const suite = derniere ? `C'est la dernière étape du circuit : ${EFFET_FINAL[r.document] ?? "la pièce sera validée."}` : "Elle passe à l'étape suivante du circuit.";
  return demanderConfirmation(`${question} ${suite}`, { action: "Approuver" });
}

/**
 * Circuit d'approbation. « corbeille » (À approuver) : demandes à trancher, demandes de l'utilisateur, toutes
 * celles qu'il voit, circuits. « demandes » (Mes demandes, profil Achats) : l'état de ses factures fournisseurs et
 * de ses engagements envoyés, sans corbeille ni circuits, qui ne le concernent pas.
 */
export function Approbations({ mode }: { mode: "corbeille" | "demandes" }) {
  const demandes = mode === "demandes";
  const [tab, setTab] = useState<Onglet>(demandes ? "pending" : "inbox");
  const [offset, setOffset] = useState(0);
  const { data: inbox, error: erreurCorbeille, mutate: refreshInbox } = useApi<Req[]>(demandes ? null : "/approvals/inbox");
  const filtre = FILTRES[tab];
  const { data: page, error: erreurListe, mutate } = useApi<PageDemandes>(filtre === undefined ? null : `/approvals/requests?paged=1&limit=${PAGE}&offset=${offset}${filtre ? `&${filtre}` : ""}`);
  const [selected, setSelected] = useState<number | null>(null);
  // Les profils métier (exploitation, chantiers, immobilier, cabinet) suivent leurs demandes sans lire les circuits.
  const circuits = useAutorise(CIRCUITS_LECTURE);
  const rows = tab === "inbox" ? inbox : page?.items;
  const onglets: Array<{ key: Onglet; label: string; count?: number }> = demandes
    ? [
        { key: "pending", label: "En validation" },
        { key: "rejected", label: "Refusées" },
        { key: "mine", label: "Toutes mes demandes" },
      ]
    : [
        { key: "inbox", label: "À approuver", count: inbox?.length },
        { key: "mine", label: "Mes demandes" },
        { key: "all", label: "Toutes" },
        ...(circuits ? [{ key: "rules" as const, label: "Circuits" }] : []),
      ];
  return (
    <div>
      {demandes ? (
        <PageHeader title="Mes demandes" subtitle="Vos factures fournisseurs et engagements de dépense envoyés pour approbation : où en est chaque demande, qui doit la viser, et le motif d'un refus." />
      ) : (
        <PageHeader title="À approuver" subtitle="Engagements de dépense, factures fournisseurs, règlements et décaissements qui attendent votre décision, par seuil et par niveau." />
      )}
      <Tabs tabs={onglets} value={tab} onChange={(t) => { setTab(t); setOffset(0); }} />
      {tab === "rules" && circuits ? (
        <div className="space-y-4">
          <Rules />
          <MaSignature />
        </div>
      ) : !rows ? (
        <Etat error={tab === "inbox" ? erreurCorbeille : erreurListe} onRetry={() => void (tab === "inbox" ? refreshInbox() : mutate())} />
      ) : rows.length === 0 ? (
        <Card>
          <Empty title={tab === "inbox" ? "Rien à approuver" : offset ? "Aucune demande plus ancienne" : "Aucune demande"} hint={tab === "inbox" ? "Les pièces à approuver par votre profil apparaîtront ici." : demandes ? "Les pièces et engagements que vous envoyez pour approbation apparaîtront ici." : undefined} />
        </Card>
      ) : (
        <Card padded={false}>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r.id)}
            columns={[
              { key: "name", label: "Demande" },
              { key: "partner", label: "Fournisseur ou bénéficiaire", render: (r) => r.partner ?? "–" },
              { key: "amount", label: "Montant", align: "right", render: (r) => fmtGNF(r.amount) },
              { key: "requested_by", label: "Demandée par" },
              { key: "requested_at", label: "Le", render: (r) => fmtDate(r.requested_at) },
              { key: "state", label: "Statut", render: (r) => <Badge tone={STATE[r.state][1]}>{r.state === "pending" && r.pending_with ? `Chez ${r.pending_with}` : STATE[r.state][0]}</Badge> },
            ]}
          />
          {tab !== "inbox" && page && page.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
              <span>
                {page.total > page.items.length
                  ? `Demandes ${fmtInt(page.offset + 1)} à ${fmtInt(page.offset + page.items.length)} sur ${fmtInt(page.total)}, de la plus récente à la plus ancienne.`
                  : `${pluriel(page.total, "demande")}.`}
              </span>
              <span className="flex gap-2">
                {offset > 0 && <Button size="sm" onClick={() => setOffset(Math.max(0, offset - PAGE))}>Plus récentes</Button>}
                {page.offset + page.items.length < page.total && <Button size="sm" onClick={() => setOffset(offset + PAGE)}>Plus anciennes</Button>}
              </span>
            </div>
          )}
        </Card>
      )}
      {selected !== null && <RequestModal id={selected} onClose={() => setSelected(null)} onDecided={() => { if (!demandes) void refreshInbox(); void mutate(); }} />}
    </div>
  );
}

/**
 * Étiquette d'une étape du circuit : décision et auteur, étape en attente de décision (la première non
 * tranchée d'une demande en cours), étapes suivantes, ou étape restée sans décision (demande refusée ou
 * annulée, par exemple remplacée par une nouvelle soumission).
 */
function etiquetteEtape(s: Step, r: Req, courante: Step | undefined): { tone: Tone; text: string } {
  if (s.state === "approved") return { tone: "ok", text: `Approuvée par ${s.decided_by ?? "–"}` };
  if (s.state === "rejected") return { tone: "danger", text: `Refusée par ${s.decided_by ?? "–"}` };
  if (s.state !== "pending") return { tone: "neutral", text: "Sans objet" };
  if (r.state !== "pending") return { tone: "neutral", text: r.state === "cancelled" ? "Non tranchée : demande annulée" : "Non tranchée" };
  return s === courante ? { tone: "warn", text: `En attente : ${s.profile}` } : { tone: "neutral", text: `Ensuite : ${s.profile}` };
}

export function RequestModal({ id, onClose, onDecided }: { id: number; onClose: () => void; onDecided: () => void }) {
  const { data: r, error: erreurChargement, mutate } = useApi<Req>(`/approvals/${id}`);
  const [comment, setComment] = useState("");
  const envoi = useEnvoi();
  const enAttente = r?.steps?.filter((s) => s.state === "pending") ?? [];
  const courante = r?.state === "pending" ? enAttente[0] : undefined;
  async function decide(action: "approve" | "reject") {
    if (!r) return;
    if (action === "reject" && !(await demanderConfirmation("Refuser la demande ? Le demandeur la reçoit avec votre motif ; elle devra être corrigée puis envoyée à nouveau.", { action: "Refuser", danger: true }))) return;
    // Dernière étape : l'approbation comptabilise la pièce, ou engage la dépense, sans retour possible.
    if (action === "approve" && !(await confirmerApprobation(r))) return;
    const ok = await envoi.run(action, () => apiSend("POST", `/approvals/${id}/${action}`, { comment }), action === "approve" ? "Demande approuvée." : "Demande refusée.", "Décision impossible.");
    if (ok) {
      await mutate();
      onDecided();
    }
  }
  return (
    <Modal
      open
      wide
      title={r?.name ?? "Demande"}
      onClose={onClose}
      footer={
        r?.can_decide && (
          <>
            <Button variant="danger" loading={envoi.busy === "reject"} disabled={!comment.trim() || envoi.busy !== null} onClick={() => decide("reject")}>
              <X className="h-4 w-4" /> Refuser
            </Button>
            <Button variant="primary" loading={envoi.busy === "approve"} disabled={envoi.busy !== null} onClick={() => decide("approve")}>
              <Check className="h-4 w-4" /> Approuver
            </Button>
          </>
        )
      }
    >
      {!r ? (
        <Etat error={erreurChargement} onRetry={() => mutate()} />
      ) : (
        <div className="space-y-4">
          {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <div className="text-xs text-muted">Montant</div>
              <div className="font-mono font-semibold">{fmtGNF(r.amount)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Fournisseur ou bénéficiaire</div>
              <div>{r.partner ?? "–"}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Demandée par</div>
              <div>{r.requested_by}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Le</div>
              <div>{fmtDateTime(r.requested_at)}</div>
            </div>
          </div>
          {r.document_detail?.lines && (
            <DataTable
              dense
              rows={r.document_detail.lines}
              rowKey={(_l, i) => i}
              columns={[
                { key: "name", label: "Libellé" },
                // Catégorie ou libellé du compte en clair ; le code du compte au survol (noyau antérieur : le code seul).
                { key: "label", label: "Catégorie", render: (l) => <span title={l.account ? `Compte ${l.account}` : undefined}>{l.label ?? l.account ?? "–"}</span> },
                { key: "amount", label: "Montant", align: "right", render: (l) => fmtGNF(l.amount) },
              ]}
            />
          )}
          {r.attachments && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                <Paperclip className="h-3.5 w-3.5" /> Justificatifs
              </div>
              {r.attachments.length === 0 ? (
                <p className="text-[12.5px] text-muted">Aucune pièce jointe au document : demandez la facture ou le devis avant d&apos;approuver.</p>
              ) : (
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {r.attachments.map((a) => (
                    <li key={a.id}>
                      <button type="button" className="text-sm text-accent underline-offset-2 hover:underline disabled:opacity-60" disabled={envoi.busy !== null} onClick={() => void envoi.telecharger(`pj${a.id}`, `/approvals/${id}/attachments/${a.id}`, a.name)}>
                        {envoi.busy === `pj${a.id}` ? `Ouverture de ${a.name}…` : a.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {/* Bon de commande fournisseur (eguitra_commerce) : le moteur n'en décrit pas les lignes, l'écran les lit. */}
          {r.res_model === "purchase.order" && r.res_id && <ApercuBon id={r.res_id} />}
          <Card title="Circuit">
            <ol className="space-y-2">
              {r.steps?.map((s) => {
                const e = etiquetteEtape(s, r, courante);
                return (
                  <li key={s.sequence} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="grid h-6 w-6 place-items-center rounded-md border border-line-strong/70 font-mono text-[13px] font-semibold text-ink-2">{s.sequence}</span>
                    <span className="flex-1">{s.label}</span>
                    <Badge tone={e.tone}>{e.text}</Badge>
                    {s.decided_at && <span className="text-xs text-muted">le {fmtDateTime(s.decided_at)}</span>}
                    {s.comment && <span className="w-full pl-8 text-xs text-muted">« {s.comment} »</span>}
                  </li>
                );
              })}
            </ol>
          </Card>
          {r.can_decide && (
            <Field label="Commentaire" hint="Obligatoire en cas de refus.">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

const NOUVELLE_REGLE = { name: "", document: "in_invoice", sequence: "1", min_amount: "0", max_amount: "", account_prefix: "", approver_profile: "finance" };

function Rules() {
  const { data: rules, error, mutate } = useApi<Rule[]>("/approvals/rules");
  // Ajouter une règle ou l'activer : administration seule ; la direction et la finance consultent.
  const ecriture = useAutorise(CIRCUITS_ECRITURE);
  const [form, setForm] = useState(NOUVELLE_REGLE);
  const envoi = useEnvoi();
  const niveau = lireNombre(form.sequence);
  const niveauInvalide = form.sequence.trim() === "" || niveau === null || !Number.isInteger(niveau) || niveau < 1;
  const minimum = lireNombre(form.min_amount);
  const minimumInvalide = form.min_amount.trim() === "" || minimum === null || minimum < 0;
  const plafond = lireNombre(form.max_amount);
  const plafondInvalide = nombreIllisible(form.max_amount) || (plafond !== null && (plafond < 0 || (minimum !== null && plafond > 0 && plafond <= minimum)));
  const pret = Boolean(form.name.trim()) && !niveauInvalide && !minimumInvalide && !plafondInvalide;
  async function add() {
    if (!pret) return;
    const ok = await envoi.run("ajout", async () => {
      // Plafond vide : sans plafond (0 pour le noyau).
      await apiSend("POST", "/approvals/rules", { ...form, name: form.name.trim(), sequence: niveau, min_amount: minimum, max_amount: plafond ?? 0 });
      await mutate();
    }, "Règle ajoutée.");
    if (ok) setForm(NOUVELLE_REGLE);
  }
  return (
    <div className="space-y-4">
      {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
      {rules && !ecriture && <Notice tone="accent">Circuits tenus par l&apos;administration : consultation seulement.</Notice>}
      <Card padded={false}>
        {!rules ? (
          <Etat error={error} onRetry={() => mutate()} />
        ) : (
          <DataTable
            rows={rules}
            rowKey={(r) => r.id}
            columns={[
              { key: "document_label", label: "Nature" },
              { key: "sequence", label: "Niveau", align: "right", render: (r) => fmtInt(r.sequence) },
              { key: "name", label: "Règle" },
              { key: "min_amount", label: "À partir de", align: "right", render: (r) => fmtGNF(r.min_amount) },
              { key: "max_amount", label: "Jusqu'à", align: "right", render: (r) => (r.max_amount ? fmtGNF(r.max_amount) : "–") },
              { key: "account_prefix", label: "Comptes", render: (r) => r.account_prefix ?? "Tous" },
              { key: "approver_label", label: "Approbateur" },
              {
                key: "active",
                label: "",
                render: (r) =>
                  ecriture ? (
                    <input
                      type="checkbox"
                      checked={r.active}
                      disabled={envoi.busy !== null}
                      aria-label={`Règle ${r.name} active`}
                      onChange={(e) => {
                        const actif = e.target.checked;
                        void envoi.run(`regle-${r.id}`, async () => {
                          await apiSend("PATCH", `/approvals/rules/${r.id}`, { active: actif });
                          await mutate();
                        }, actif ? `Règle « ${r.name} » activée.` : `Règle « ${r.name} » désactivée.`);
                      }}
                    />
                  ) : r.active ? (
                    <Badge tone="ok">Active</Badge>
                  ) : (
                    <Badge>Inactive</Badge>
                  ),
              },
            ]}
          />
        )}
      </Card>
      {ecriture && (
        <Card title="Nouvelle règle">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Libellé" className="md:col-span-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Investissements : accord de la direction" />
            </Field>
            <Field label="Nature">
              <Select value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} options={[{ value: "commitment", label: "Engagements de dépense" }, { value: "purchase_order", label: "Bons de commande fournisseur" }, { value: "in_invoice", label: "Factures fournisseurs" }, { value: "payment_out", label: "Règlements fournisseurs" }, { value: "cash_out", label: "Décaissements de trésorerie" }, { value: "entry", label: "Opérations diverses" }]} />
            </Field>
            <Field label="Approbateur">
              <Select value={form.approver_profile} onChange={(e) => setForm({ ...form, approver_profile: e.target.value })} options={[{ value: "finance", label: "Finance" }, { value: "direction", label: "Direction générale" }, { value: "admin", label: "Administration" }]} />
            </Field>
            <Field label="Niveau" error={niveauInvalide ? "Nombre entier, 1 ou plus." : undefined}>
              <Input inputMode="numeric" aria-invalid={niveauInvalide || undefined} value={form.sequence} onChange={(e) => setForm({ ...form, sequence: e.target.value })} />
            </Field>
            <Field label="À partir de (GNF)" error={nombreIllisible(form.min_amount) ? AIDE_NOMBRE : minimum !== null && minimum < 0 ? "Montant positif ou nul." : form.min_amount.trim() === "" ? "Saisissez 0 pour toute pièce." : undefined}>
              <Input inputMode="numeric" className="font-mono" aria-invalid={minimumInvalide || undefined} value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: e.target.value })} />
            </Field>
            <Field label="Jusqu'à (GNF, vide = sans plafond)" error={nombreIllisible(form.max_amount) ? AIDE_NOMBRE : plafondInvalide ? "Le plafond doit dépasser le montant de départ." : undefined}>
              <Input inputMode="numeric" className="font-mono" aria-invalid={plafondInvalide || undefined} value={form.max_amount} onChange={(e) => setForm({ ...form, max_amount: e.target.value })} />
            </Field>
            <Field label="Comptes commençant par">
              <Input value={form.account_prefix} onChange={(e) => setForm({ ...form, account_prefix: e.target.value })} placeholder="2 pour les investissements" />
            </Field>
          </div>
          <div className="mt-3">
            <Button variant="primary" loading={envoi.busy === "ajout"} disabled={!pret || envoi.busy !== null} onClick={add}>
              Ajouter la règle
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
