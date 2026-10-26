"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, PageHeader, Select, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtDateTime, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";

interface AuditEntry {
  id: number;
  date: string;
  user: string | null;
  model: string;
  model_code: string;
  res_id: number;
  record: string | null;
  method: string;
  lines: Array<{ field: string; old: string | null; new: string | null }>;
}
/** Page de la piste d'audit (GET /admin/audit?paged=1) : la suite se demande par before_id. */
interface AuditPage { items: AuditEntry[]; next_before_id: number | null }
interface AccessEntry { date: string; user: string | null; method: string; path: string; status: number; duration_ms: number; ip: string; app: string | null }
interface UserRef { id: number; name: string; login: string }

const METHOD = { create: ["Création", "ok"], write: ["Modification", "accent"], unlink: ["Suppression", "danger"] } as const;
const MODELS = [
  { value: "", label: "Tous les objets" },
  { value: "account.move", label: "Pièces comptables" },
  { value: "account.move.line", label: "Lignes d'écriture" },
  { value: "account.payment", label: "Règlements" },
  { value: "res.partner", label: "Tiers" },
  { value: "account.account", label: "Comptes" },
  { value: "res.users", label: "Utilisateurs" },
];
/** Verbe d'un appel du journal des accès, dit en clair. */
const ACTION: Record<string, string> = { GET: "Lecture", POST: "Envoi", PATCH: "Modification", PUT: "Remplacement", DELETE: "Suppression" };
const PAGE_AUDIT = 100;
const PAGE_ACCES = 200;

/**
 * Journal d'audit (administration) : piste d'audit filtrée par objet, auteur et enregistrement, parcourue en
 * entier page après page (curseur du noyau) ; journal des accès filtré par utilisateur et par échec, paginé.
 */
export default function AuditPage() {
  const [tab, setTab] = useState<"audit" | "access">("audit");
  const { data: users, error: erreurComptes, mutate: majComptes } = useApi<UserRef[]>("/admin/users");
  const comptes = [{ value: "", label: "Tous les utilisateurs" }, ...(users ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.login})` }))];
  return (
    <div>
      <PageHeader title="Journal d'audit" subtitle="Chaque création, modification et suppression avec l'utilisateur, la date et les valeurs avant et après. Accès conservés 12 mois." />
      <Tabs tabs={[{ key: "audit", label: "Piste d'audit" }, { key: "access", label: "Journal des accès" }]} value={tab} onChange={setTab} />
      {erreurComptes && (
        <div className="mb-4">
          <ErrorBox error={erreurComptes} titre="Liste des utilisateurs non chargée : le filtre par utilisateur est indisponible." onRetry={() => majComptes()} />
        </div>
      )}
      {tab === "audit" ? <PisteAudit comptes={comptes} /> : <JournalAcces comptes={comptes} />}
    </div>
  );
}

function PisteAudit({ comptes }: { comptes: Array<{ value: string | number; label: string }> }) {
  const [model, setModel] = useState("");
  // Objet choisi depuis une entrée (« Historique de cet enregistrement ») hors de la liste des objets usuels.
  const [autreObjet, setAutreObjet] = useState<{ value: string; label: string } | null>(null);
  const objets = autreObjet && !MODELS.some((m) => m.value === autreObjet.value) ? [...MODELS, autreObjet] : MODELS;
  const [userId, setUserId] = useState("");
  const [numero, setNumero] = useState("");
  // Curseurs des pages déjà vues : la première page n'en a pas ; « Plus récentes » revient d'une page.
  const [curseurs, setCurseurs] = useState<number[]>([]);
  const resId = lireNombre(numero);
  const numeroInvalide = nombreIllisible(numero) || (resId !== null && (!Number.isInteger(resId) || resId <= 0));
  const filtres = [model && `model=${model}`, userId && `user_id=${userId}`, model && resId !== null && !numeroInvalide && `res_id=${resId}`].filter(Boolean).join("&");
  const curseur = curseurs[curseurs.length - 1];
  const { data, error, mutate } = useApi<AuditPage>(`/admin/audit?paged=1&limit=${PAGE_AUDIT}${filtres ? `&${filtres}` : ""}${curseur ? `&before_id=${curseur}` : ""}`);
  const filtrer = (f: () => void) => {
    f();
    setCurseurs([]);
  };
  const premiere = curseurs.length * PAGE_AUDIT + 1;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Objet" className="w-56">
          <Select value={model} onChange={(e) => filtrer(() => { setModel(e.target.value); setNumero(""); })} options={objets} />
        </Field>
        <Field label="Auteur" className="w-64">
          <Select value={userId} onChange={(e) => filtrer(() => setUserId(e.target.value))} options={comptes} />
        </Field>
        {model && (
          <Field label="N° de l'enregistrement" className="w-48" error={numeroInvalide ? "Numéro entier attendu, par exemple 42." : undefined} hint="Historique d'un seul enregistrement.">
            <Input inputMode="numeric" className="font-mono" value={numero} aria-invalid={numeroInvalide || undefined} onChange={(e) => filtrer(() => setNumero(e.target.value))} />
          </Field>
        )}
        {(model || userId || numero) && (
          <Button variant="ghost" onClick={() => filtrer(() => { setModel(""); setUserId(""); setNumero(""); })}>
            Tout afficher
          </Button>
        )}
      </div>
      <Etat data={data} error={error} onRetry={() => mutate()}>
        {(page) => (
          <>
            {page.items.length === 0 ? (
              <Card>
                <p className="py-6 text-center text-sm text-muted">{curseurs.length ? "Aucune entrée plus ancienne : le début de la piste est atteint." : "Aucune entrée pour ces filtres."}</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {page.items.map((a) => (
                  <Card key={a.id}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={METHOD[a.method as keyof typeof METHOD]?.[1] ?? "neutral"}>{METHOD[a.method as keyof typeof METHOD]?.[0] ?? a.method}</Badge>
                      <span className="font-medium">{a.model}</span>
                      <button
                        type="button"
                        className="text-left text-muted underline-offset-2 hover:text-ink hover:underline"
                        title="Historique de cet enregistrement"
                        onClick={() => filtrer(() => { setAutreObjet({ value: a.model_code, label: a.model }); setModel(a.model_code); setNumero(String(a.res_id)); })}
                      >
                        {a.record ?? `n° ${a.res_id}`}
                      </button>
                      <span className="ml-auto text-xs text-muted">
                        {a.user ?? "système"}, {fmtDateTime(a.date)}
                      </span>
                    </div>
                    {a.lines.length > 0 && (
                      <table className="mt-2 w-full text-xs">
                        <tbody>
                          {a.lines.slice(0, 12).map((l, i) => (
                            <tr key={i} className="border-t border-line/50">
                              <td className="w-1/4 py-1 pr-2 text-muted">{l.field}</td>
                              <td className="w-3/8 py-1 pr-2 text-danger/90 line-through decoration-danger/40">{l.old || "–"}</td>
                              <td className="w-3/8 py-1 text-ok">{l.new || "–"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {a.lines.length > 12 && <p className="mt-1 text-[11.5px] text-muted">Et {fmtInt(a.lines.length - 12)} autres champs modifiés.</p>}
                  </Card>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
              <span>
                {page.items.length > 0 && `Entrées ${fmtInt(premiere)} à ${fmtInt(premiere + page.items.length - 1)}, de la plus récente à la plus ancienne${page.next_before_id ? "" : " ; début de la piste atteint"}.`}
              </span>
              <span className="flex gap-2">
                {curseurs.length > 0 && <Button size="sm" onClick={() => setCurseurs(curseurs.slice(0, -1))}>Plus récentes</Button>}
                {page.next_before_id && <Button size="sm" onClick={() => setCurseurs([...curseurs, page.next_before_id!])}>Plus anciennes</Button>}
              </span>
            </div>
          </>
        )}
      </Etat>
    </>
  );
}

function JournalAcces({ comptes }: { comptes: Array<{ value: string | number; label: string }> }) {
  const [userId, setUserId] = useState("");
  const [echecs, setEchecs] = useState(false);
  const [offset, setOffset] = useState(0);
  const filtres = [userId && `user_id=${userId}`, echecs && "status_min=400"].filter(Boolean).join("&");
  const { data, error, mutate } = useApi<AccessEntry[]>(`/admin/access-log?limit=${PAGE_ACCES}&offset=${offset}${filtres ? `&${filtres}` : ""}`);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Utilisateur" className="w-64">
          <Select value={userId} onChange={(e) => { setUserId(e.target.value); setOffset(0); }} options={comptes} />
        </Field>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={echecs} onChange={(e) => { setEchecs(e.target.checked); setOffset(0); }} /> Refus et erreurs seulement
        </label>
      </div>
      <Card padded={false}>
        <Etat data={data} error={error} onRetry={() => mutate()}>
          {(rows) => (
            <>
              <DataTable
                dense
                rows={rows}
                rowKey={(_r, i) => i}
                empty={offset ? "Aucun accès plus ancien." : "Aucun accès pour ces filtres."}
                columns={[
                  { key: "date", label: "Date", render: (r) => fmtDateTime(r.date) },
                  { key: "user", label: "Utilisateur", render: (r) => r.user ?? "–" },
                  { key: "method", label: "Action", render: (r) => ACTION[r.method] ?? r.method },
                  { key: "path", label: "Adresse" },
                  { key: "status", label: "Statut", render: (r) => <Badge tone={r.status < 300 ? "ok" : r.status < 500 ? "warn" : "danger"}>{r.status}</Badge> },
                  { key: "ip", label: "IP" },
                  { key: "duration_ms", label: "Durée", align: "right", render: (r) => `${fmtInt(r.duration_ms)}${INSECABLE}ms` },
                ]}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
                <span>{rows.length ? `Accès ${fmtInt(offset + 1)} à ${fmtInt(offset + rows.length)}, du plus récent au plus ancien${rows.length < PAGE_ACCES ? " ; fin du journal." : "."}` : ""}</span>
                <span className="flex gap-2">
                  {offset > 0 && <Button size="sm" onClick={() => setOffset(Math.max(0, offset - PAGE_ACCES))}>Plus récents</Button>}
                  {rows.length === PAGE_ACCES && <Button size="sm" onClick={() => setOffset(offset + PAGE_ACCES)}>Plus anciens</Button>}
                </span>
              </div>
            </>
          )}
        </Etat>
      </Card>
    </>
  );
}
