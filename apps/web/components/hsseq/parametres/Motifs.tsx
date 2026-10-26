"use client";

import { useState } from "react";
import { MapPin } from "@/components/icons";
import { Button, Card, DataTable, Etat, Modal, Notice, Tag, cx, demanderConfirmation } from "@/components/ui";
import { MOTIFS, TYPE_VEHICULE } from "@/components/hsseq/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { pluriel } from "@/lib/format";
import type { HsseqSite, ReasonSetting } from "@/lib/hsseq-types";
import { messageErreur } from "./outils";

/**
 * Motifs du verrou de départ (§4.2) : activation de chaque motif et sites où il ne s'applique pas.
 * V01 et V03 ne se dérogent jamais. V06 à V09 (lot 2) sont livrés désactivés : l'administration ou le
 * Responsable HSSEQ les activent par type de véhicule et par site. Le noyau évalue le verrou à chaque
 * départ, sans contournement.
 */
export function Motifs() {
  const { data, error, mutate } = useApi<ReasonSetting[]>("/hsseq/lock/reasons");
  const { data: sites } = useApi<HsseqSite[]>("/hsseq/sites");
  const [enCours, setEnCours] = useState<string | null>(null);
  const [parSite, setParSite] = useState<ReasonSetting | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; texte: string } | null>(null);

  async function enregistrer(r: ReasonSetting, modif: { active?: boolean; disabled_sites?: number[] }, texte: string): Promise<boolean> {
    setEnCours(r.code);
    setMessage(null);
    try {
      const maj = await apiSend<ReasonSetting>("PATCH", "/hsseq/lock/reasons", { code: r.code, ...modif });
      await mutate((liste) => liste?.map((x) => (x.code === maj.code ? maj : x)), { revalidate: false });
      setMessage({ tone: "ok", texte });
      return true;
    } catch (e) {
      setMessage({ tone: "danger", texte: messageErreur(e) });
      return false;
    } finally {
      setEnCours(null);
    }
  }

  async function basculer(r: ReasonSetting) {
    const active = !r.active;
    if (!active) {
      const oui = await demanderConfirmation(`Désactiver le motif ${r.code} ? Tant qu'il est désactivé, « ${r.label || MOTIFS[r.code].libelle} » n'empêche plus aucun départ, sur aucun site.`, { action: "Désactiver", danger: true });
      if (!oui) return;
    }
    await enregistrer(r, { active }, `Motif ${r.code} ${active ? "activé" : "désactivé"}.`);
  }


  return (
    <Card padded={false} title="Motifs du verrou de départ">
      <div className="space-y-3 px-6 pb-4">
        <p className="max-w-[90ch] text-[13px] leading-relaxed text-muted">
          Le noyau évalue le verrou à chaque départ, sans contournement possible depuis un écran. V01 (contrôle absent) et V03 (alcootest) ne se dérogent jamais. V06 à V09 sont déclarés pour le lot 2 et ne s&apos;activent pas encore.
        </p>
        {message && <Notice tone={message.tone}>{message.texte}</Notice>}
      </div>
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des motifs…">
        {(liste) => (
          <DataTable
            rows={[...liste].sort((a, b) => a.code.localeCompare(b.code))}
            rowKey={(r) => r.code}
            columns={[
              { key: "code", label: "Code", render: (r) => <span className="font-mono text-[13px] font-semibold text-ink">{r.code}</span>, sortValue: (r) => r.code },
              {
                key: "label",
                label: "Motif",
                render: (r) => (
                  <span className="block min-w-[16rem] max-w-[34rem]">
                    <span className="block font-medium text-ink">{r.label || MOTIFS[r.code].libelle}</span>
                    <span className="mt-0.5 block text-[12px] text-muted">
                      Source : {r.source} · levée : {r.resolution}
                    </span>
                  </span>
                ),
              },
              {
                key: "kinds",
                label: "Profils",
                render: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.vehicle_kinds.map((k) => (
                      <Tag key={k}>{TYPE_VEHICULE[k]}</Tag>
                    ))}
                  </span>
                ),
              },
              { key: "waivable", label: "Dérogation", render: (r) => (r.waivable ? "Possible" : <span className="font-medium text-ink">Jamais</span>), sortValue: (r) => (r.waivable ? 1 : 0) },
              {
                key: "sites",
                label: "Sites",
                render: (r) => (
                  <span className="flex flex-col items-start gap-1">
                    <span className={cx("text-[13px]", r.disabled_sites.length ? "font-medium text-ink" : "text-ink-2")}>
                      {r.disabled_sites.length ? `Hors ${r.disabled_sites.map((x) => x.name).join(", ")}` : "Tous les sites"}
                    </span>
                    {r.lot <= 2 && (
                      <Button variant="ghost" size="sm" className="-ml-2.5" onClick={() => setParSite(r)} disabled={!sites} aria-label={`Sites du motif ${r.code}`}>
                        <MapPin className="h-3.5 w-3.5" /> Par site
                      </Button>
                    )}
                  </span>
                ),
              },
              {
                key: "active",
                label: "Activation",
                sortValue: (r) => (r.active ? 0 : 1),
                render: (r) =>
                  r.lot > 2 ? (
                    <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                      <Tag>Lot {r.lot}</Tag> non évalué
                    </span>
                  ) : (
                    <Interrupteur actif={r.active} occupe={enCours === r.code} nom={`Motif ${r.code} actif`} onBasculer={() => void basculer(r)} />
                  ),
              },
            ]}
          />
        )}
      </Etat>
      {parSite && sites && (
        <SitesDuMotif
          motif={parSite}
          sites={sites}
          onClose={() => setParSite(null)}
          onEnregistrer={async (desactives) => {
            const n = desactives.length;
            if (await enregistrer(parSite, { disabled_sites: desactives }, n ? `Motif ${parSite.code} désactivé sur ${pluriel(n, "site")}.` : `Motif ${parSite.code} appliqué sur tous les sites.`)) setParSite(null);
          }}
        />
      )}
    </Card>
  );
}

/** Interrupteur accessible (rôle switch) : état lu par le lecteur d'écran et écrit à côté. */
function Interrupteur({ actif, occupe, nom, onBasculer }: { actif: boolean; occupe: boolean; nom: string; onBasculer: () => void }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={actif}
        aria-label={nom}
        aria-busy={occupe || undefined}
        disabled={occupe}
        onClick={onBasculer}
        className={cx(
          "relative inline-flex h-6 w-11 flex-none items-center rounded-full border transition-colors duration-200 motion-reduce:transition-none disabled:cursor-wait disabled:opacity-60",
          actif ? "border-accent bg-accent" : "border-line-strong bg-panel-3",
        )}
      >
        <span aria-hidden className={cx("absolute h-[18px] w-[18px] rounded-full bg-panel shadow-[0_1px_2px_rgb(16_36_31/0.25)] transition-transform duration-200 motion-reduce:transition-none", actif ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </button>
      <span aria-hidden className={cx("text-[13px] font-medium", actif ? "text-ink" : "text-muted")}>
        {actif ? "Actif" : "Inactif"}
      </span>
    </span>
  );
}

/** Sites où le motif s'applique : décocher un site l'en retire (disabled_sites). */
function SitesDuMotif({ motif, sites, onClose, onEnregistrer }: { motif: ReasonSetting; sites: HsseqSite[]; onClose: () => void; onEnregistrer: (desactives: number[]) => Promise<void> }) {
  const [desactives, setDesactives] = useState<number[]>(motif.disabled_sites.map((x) => x.id));
  const [busy, setBusy] = useState(false);
  const proposes = sites.filter((s) => s.active || motif.disabled_sites.some((x) => x.id === s.id)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return (
    <Modal
      open
      title={`Sites du motif ${motif.code}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onEnregistrer(desactives);
              setBusy(false);
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-ink-2">{motif.label || MOTIFS[motif.code].libelle}.</p>
      {!motif.active && (
        <div className="mt-3">
          <Notice tone="warn">Ce motif est inactif : il ne bloque aucun départ, quels que soient les sites cochés.</Notice>
        </div>
      )}
      <fieldset className="mt-4">
        <legend className="mb-1 text-[13px] font-medium text-ink-2">Le motif s&apos;applique sur</legend>
        <p className="mb-2 text-[12px] leading-snug text-muted">Sur un site décoché, ce motif ne bloque plus aucun départ.</p>
        <ul className="space-y-1">
          {proposes.map((s) => {
            const concerne = motif.vehicle_kinds.includes(s.default_vehicle_kind);
            return (
              <li key={s.id}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-[13.5px] hover:bg-panel-2">
                  <input type="checkbox" className="mt-1" checked={!desactives.includes(s.id)} onChange={(e) => setDesactives(e.target.checked ? desactives.filter((x) => x !== s.id) : [...desactives, s.id])} />
                  <span>
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className="text-muted">
                      {" "}
                      · {s.code} · {TYPE_VEHICULE[s.default_vehicle_kind]}
                      {!s.active ? " · site inactif" : ""}
                    </span>
                    {!concerne && <span className="block text-[12px] text-muted">Profil par défaut non concerné par ce motif.</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </Modal>
  );
}
