"use client";

import { useState } from "react";
import { Pencil, Plus } from "@/components/icons";
import { Button, Card, DataTable, Etat, Field, Input, Modal, Notice, Select } from "@/components/ui";
import { TYPE_VEHICULE, Tampon } from "@/components/hsseq/commun";
import { apiSend, useApi } from "@/lib/api-client";
import type { HsseqSite, Ref, Referentials, SiteInput, VehicleKind } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { champsEnErreur, messageErreur } from "./outils";

const PROFILS: Array<{ value: VehicleKind; label: string }> = [
  { value: "tanker", label: TYPE_VEHICULE.tanker },
  { value: "tipper", label: TYPE_VEHICULE.tipper },
];

/**
 * Sites (eguitra.hsseq.site) : nom, code, société, profil de véhicule par défaut et chefs de parc.
 * Un compte Exploitation rattaché à des sites ne lit que leurs objets (contrat, §2).
 */
export function Sites() {
  const { data: sites, error, mutate } = useApi<HsseqSite[]>("/hsseq/sites");
  const { data: ref } = useApi<Referentials>("/hsseq/referentials");
  const { data: me } = useApi<Me>("/auth/me");
  const [edition, setEdition] = useState<HsseqSite | "nouveau" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const societes: Ref[] = me?.companies.map((s) => ({ id: s.id, name: s.name })) ?? [];
  return (
    <Card
      padded={false}
      title="Sites"
      actions={
        <Button size="sm" onClick={() => setEdition("nouveau")} disabled={!me}>
          <Plus className="h-3.5 w-3.5" /> Nouveau site
        </Button>
      }
    >
      <p className="max-w-[90ch] px-6 pb-4 text-[13px] leading-relaxed text-muted">
        Le profil par défaut propose la grille de contrôle du site. Les chefs de parc sont des comptes du profil Exploitation : rattachés à des sites, ils ne lisent que leurs objets.
      </p>
      {message && (
        <div className="px-6 pb-4">
          <Notice tone="ok">{message}</Notice>
        </div>
      )}
      <Etat data={sites} error={error} onRetry={() => mutate()} label="Chargement des sites…" vide={{ title: "Aucun site", hint: "Créez le premier site, puis rattachez-y ses chefs de parc." }}>
        {(liste) => (
          <DataTable
            rows={liste}
            rowKey={(s) => s.id}
            columns={[
              { key: "code", label: "Code", render: (s) => <span className="font-mono text-[12.5px]">{s.code}</span>, sortValue: (s) => s.code },
              { key: "name", label: "Site", render: (s) => <span className="font-medium text-ink">{s.name}</span>, sortValue: (s) => s.name },
              { key: "company", label: "Société", render: (s) => s.company.name, sortValue: (s) => s.company.name },
              { key: "kind", label: "Profil par défaut", render: (s) => TYPE_VEHICULE[s.default_vehicle_kind], sortValue: (s) => s.default_vehicle_kind },
              { key: "managers", label: "Chefs de parc", render: (s) => (s.yard_managers.length ? s.yard_managers.map((m) => m.name).join(", ") : <span className="text-muted">Aucun</span>) },
              { key: "active", label: "État", render: (s) => <Tampon mot={s.active ? "En service" : "Inactif"} />, sortValue: (s) => (s.active ? 0 : 1) },
              {
                key: "x",
                label: "",
                align: "right",
                render: (s) => (
                  <Button variant="ghost" size="sm" aria-label={`Modifier le site ${s.name}`} title="Modifier" onClick={() => setEdition(s)} disabled={!me}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Etat>
      {edition && me && (
        <EditionSite
          site={edition === "nouveau" ? null : edition}
          societes={societes}
          societeDefaut={me.company_id}
          candidats={ref?.owners ?? []}
          onClose={() => setEdition(null)}
          onDone={(s, cree) => {
            setEdition(null);
            setMessage(cree ? `Site « ${s.name} » créé.` : `Site « ${s.name} » enregistré.`);
            void mutate();
          }}
        />
      )}
    </Card>
  );
}

function EditionSite({ site, societes, societeDefaut, candidats, onClose, onDone }: { site: HsseqSite | null; societes: Ref[]; societeDefaut: number; candidats: Ref[]; onClose: () => void; onDone: (s: HsseqSite, cree: boolean) => void }) {
  const [f, setF] = useState({
    name: site?.name ?? "",
    code: site?.code ?? "",
    company_id: site?.company.id ?? societeDefaut,
    default_vehicle_kind: site?.default_vehicle_kind ?? ("tanker" as VehicleKind),
    yard_manager_ids: site?.yard_managers.map((m) => m.id) ?? [],
    active: site?.active ?? true,
  });
  const [erreur, setErreur] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const champs = champsEnErreur(erreur);
  // Comptes proposés : responsables possibles servis par les référentiels, plus les chefs de parc déjà rattachés.
  const proposes = [...new Map([...(site?.yard_managers ?? []), ...candidats].map((c) => [c.id, c])).values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const complet = f.name.trim() !== "" && f.code.trim() !== "" && f.company_id > 0;

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const corps: SiteInput = { ...f, name: f.name.trim(), code: f.code.trim().toUpperCase() };
    try {
      const s = site ? await apiSend<HsseqSite>("PATCH", `/hsseq/sites/${site.id}`, corps) : await apiSend<HsseqSite>("POST", "/hsseq/sites", corps);
      onDone(s, !site);
    } catch (e) {
      setErreur(e);
    } finally {
      setBusy(false);
    }
  }

  const basculer = (id: number, coche: boolean) => setF({ ...f, yard_manager_ids: coche ? [...f.yard_manager_ids, id] : f.yard_manager_ids.filter((x) => x !== id) });

  return (
    <Modal
      open
      title={site ? `Site ${site.name}` : "Nouveau site"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} disabled={!complet} onClick={enregistrer}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {erreur !== null && (
          <div className="sm:col-span-2">
            <Notice tone="danger">{messageErreur(erreur)}</Notice>
          </div>
        )}
        <Field label="Nom du site" className="sm:col-span-2" error={champs.includes("name") ? "Nom à renseigner" : undefined}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required aria-invalid={champs.includes("name") || undefined} />
        </Field>
        <Field label="Code" hint="Code court et unique, repris dans les listes" error={champs.includes("code") ? "Code à corriger" : undefined}>
          <Input className="font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required aria-invalid={champs.includes("code") || undefined} />
        </Field>
        <Field label="Profil des véhicules par défaut" error={champs.includes("default_vehicle_kind") ? "Profil à corriger" : undefined}>
          <Select value={f.default_vehicle_kind} onChange={(e) => setF({ ...f, default_vehicle_kind: e.target.value as VehicleKind })} options={PROFILS} />
        </Field>
        <Field label="Société" className="sm:col-span-2" error={champs.includes("company_id") ? "Société à corriger" : undefined}>
          <Select value={f.company_id} onChange={(e) => setF({ ...f, company_id: Number(e.target.value) })} options={societes.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Chefs de parc</legend>
          <p className="mb-2 text-[12px] leading-snug text-muted">Comptes du profil Exploitation ; le noyau refuse un compte d&apos;un autre profil.</p>
          {proposes.length === 0 ? (
            <p className="text-[13px] text-muted">Aucun compte à proposer.</p>
          ) : (
            <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
              {proposes.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] text-ink hover:bg-panel-2">
                    <input type="checkbox" checked={f.yard_manager_ids.includes(c.id)} onChange={(e) => basculer(c.id, e.target.checked)} />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {champs.includes("yard_manager_ids") && <p className="mt-1.5 text-[12px] font-medium text-danger">Un chef de parc choisi n&apos;est pas un compte Exploitation.</p>}
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Site en service
        </label>
      </div>
    </Modal>
  );
}
