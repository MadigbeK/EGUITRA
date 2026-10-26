"use client";

import { useState } from "react";
import { Pencil } from "@/components/icons";
import { Button, Card, DataTable, Etat, Field, Input, Modal, Notice } from "@/components/ui";
import { Tampon } from "@/components/hsseq/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import type { Auditor, AuditorPatch, HsseqSite } from "@/lib/hsseq-types";
import { champsEnErreur, messageErreur } from "./outils";

/**
 * Auditeurs externes (lot 2, GET et PATCH /hsseq/auditors) : l'administration crée le compte avec le
 * profil « Auditeur » ; ici se fixent sa date de fin d'accès et les sites qu'il audite. Sans date de fin,
 * échue, ou sans site, le noyau lui refuse toute lecture ; il ne lit jamais en écriture.
 */
export function Auditeurs() {
  const { data: auditeurs, error, mutate } = useApi<Auditor[]>("/hsseq/auditors");
  const { data: sites } = useApi<HsseqSite[]>("/hsseq/sites");
  const [edition, setEdition] = useState<Auditor | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card padded={false} title="Auditeurs">
      <p className="max-w-[90ch] px-6 pb-4 text-[13px] leading-relaxed text-muted">
        Un auditeur externe lit NIMOVA · HSSEQ en lecture seule, borné à ses sites et jusqu&apos;à sa date de fin d&apos;accès, sans les noms des personnes. Son compte se crée dans la gestion des comptes avec le profil « Auditeur » ; sa durée et son périmètre se fixent ici. Sans date de fin ou sans site, l&apos;accès est refusé.
      </p>
      {message && (
        <div className="px-6 pb-4">
          <Notice tone="ok">{message}</Notice>
        </div>
      )}
      <Etat data={auditeurs} error={error} onRetry={() => mutate()} label="Chargement des auditeurs…" vide={{ title: "Aucun auditeur", hint: "Créez d'abord le compte avec le profil « Auditeur » dans la gestion des comptes." }}>
        {(liste) => (
          <DataTable
            rows={liste}
            rowKey={(a) => a.id}
            columns={[
              {
                key: "name",
                label: "Auditeur",
                sortValue: (a) => a.name,
                render: (a) => (
                  <span>
                    <span className="block font-medium text-ink">{a.name}</span>
                    <span className="block text-[12px] text-muted">{a.login}</span>
                  </span>
                ),
              },
              { key: "companies", label: "Sociétés", render: (a) => a.companies.map((c) => c.name).join(", ") },
              { key: "sites", label: "Sites audités", render: (a) => (a.sites.length ? a.sites.map((s) => s.name).join(", ") : <span className="font-medium text-danger">Aucun : accès refusé</span>) },
              {
                key: "until",
                label: "Fin d'accès",
                sortValue: (a) => a.access_until ?? "",
                render: (a) => (
                  <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                    {a.access_until ? fmtDate(a.access_until) : <span className="font-medium text-danger">Sans date : accès refusé</span>}
                    {a.expired && a.access_until && <Tampon mot="Échue" />}
                  </span>
                ),
              },
              {
                key: "x",
                label: "",
                align: "right",
                render: (a) => (
                  <Button variant="ghost" size="sm" aria-label={`Modifier l'accès de ${a.name}`} title="Modifier" onClick={() => setEdition(a)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Etat>
      {edition && (
        <EditionAuditeur
          auditeur={edition}
          sites={(sites ?? []).filter((s) => s.active && edition.companies.some((c) => c.id === s.company.id))}
          onClose={() => setEdition(null)}
          onDone={(a) => {
            setEdition(null);
            setMessage(`Accès de ${a.name} enregistré.`);
            void mutate();
          }}
        />
      )}
    </Card>
  );
}

/** Durée et périmètre d'un auditeur : date de fin d'accès et sites de ses sociétés. */
function EditionAuditeur({ auditeur, sites, onClose, onDone }: { auditeur: Auditor; sites: HsseqSite[]; onClose: () => void; onDone: (a: Auditor) => void }) {
  const [fin, setFin] = useState(auditeur.access_until ?? "");
  const [choisis, setChoisis] = useState<number[]>(auditeur.sites.map((s) => s.id));
  const [erreur, setErreur] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const champs = champsEnErreur(erreur);

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const corps: AuditorPatch = { access_until: fin || null, site_ids: choisis };
    try {
      onDone(await apiSend<Auditor>("PATCH", `/hsseq/auditors/${auditeur.id}`, corps));
    } catch (e) {
      setErreur(e);
    } finally {
      setBusy(false);
    }
  }

  const basculer = (id: number, coche: boolean) => setChoisis((l) => (coche ? [...l, id] : l.filter((x) => x !== id)));

  return (
    <Modal
      open
      title={`Accès de ${auditeur.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={enregistrer}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {erreur !== null && <Notice tone="danger">{messageErreur(erreur)}</Notice>}
        <Field label="Fin d'accès" hint="Dernier jour de lecture ; sans date, l'accès est refusé." error={champs.includes("access_until") ? "Date à corriger" : undefined} className="sm:w-56">
          <Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} aria-invalid={champs.includes("access_until") || undefined} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Sites audités</legend>
          <p className="mb-2 text-[12px] leading-snug text-muted">Sites des sociétés de l&apos;auditeur ; il ne lit que leurs objets.</p>
          {sites.length === 0 ? (
            <p className="text-[13px] text-muted">Aucun site en service dans ses sociétés.</p>
          ) : (
            <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
              {sites.map((s) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] text-ink hover:bg-panel-2">
                    <input type="checkbox" checked={choisis.includes(s.id)} onChange={(e) => basculer(s.id, e.target.checked)} />
                    {s.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {champs.includes("site_ids") && <p className="mt-1.5 text-[12px] font-medium text-danger">Un site choisi n&apos;appartient à aucune société de l&apos;auditeur.</p>}
        </fieldset>
      </div>
    </Modal>
  );
}
