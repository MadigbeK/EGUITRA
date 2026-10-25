"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lock, Pencil, Plus, Trash2 } from "@/components/icons";
import { Button, Card, Etat, FEUILLE, Field, Input, Modal, Notice, Segmented, Select, Tag, cx } from "@/components/ui";
import { NATURE_CONTROLE, TYPE_VEHICULE, Tampon } from "@/components/hsseq/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, pluriel } from "@/lib/format";
import type { CheckItem, CheckKind, CheckTemplate, VehicleKind } from "@/lib/hsseq-types";
import { champsEnErreur, messageErreur } from "./outils";

const NATURES = Object.entries(NATURE_CONTROLE).map(([value, label]) => ({ value: value as CheckKind, label }));

/** Points dans l'ordre de la grille. */
const ordonnes = (items: CheckItem[]) => [...items].sort((a, b) => a.sequence - b.sequence);

/**
 * Grilles de contrôle par profil (citerne, benne) et par nature : points, ordre, caractère bloquant
 * et activation de la grille. Toute modification crée une version ; un contrôle déjà saisi garde les
 * libellés de la sienne (contrat, §7).
 */
export function Grilles() {
  const { data, error, mutate } = useApi<CheckTemplate[]>("/hsseq/checks/templates");
  const [profil, setProfil] = useState<VehicleKind>("tanker");
  const [edition, setEdition] = useState<CheckTemplate | "nouvelle" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Profil de véhicule"
          options={[
            { key: "tanker", label: TYPE_VEHICULE.tanker },
            { key: "tipper", label: TYPE_VEHICULE.tipper },
          ]}
          value={profil}
          onChange={setProfil}
        />
        <Button size="sm" onClick={() => setEdition("nouvelle")}>
          <Plus className="h-3.5 w-3.5" /> Nouvelle grille
        </Button>
      </div>
      <Notice tone="accent">
        Une grille par nature de contrôle et par profil. Un point bloquant non conforme ouvre le motif V02 du verrou ; photo obligatoire sur toute non-conformité. Objectif : moins de 4 minutes de saisie au terrain. Toute modification crée une nouvelle version ; un contrôle déjà saisi garde les libellés de la sienne.
      </Notice>
      {message && <Notice tone="ok">{message}</Notice>}
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des grilles…">
        {(liste) => {
          const grilles = liste.filter((g) => g.vehicle_kind === profil).sort((a, b) => Number(b.active) - Number(a.active) || a.kind.localeCompare(b.kind));
          if (grilles.length === 0)
            return (
              <Card>
                <p className="py-6 text-center text-sm text-muted">Aucune grille pour le profil {TYPE_VEHICULE[profil].toLocaleLowerCase("fr")}.</p>
              </Card>
            );
          return (
            <div className="grid gap-5 xl:grid-cols-2">
              {grilles.map((g) => (
                <CarteGrille key={g.id} g={g} onModifier={() => setEdition(g)} />
              ))}
            </div>
          );
        }}
      </Etat>
      {edition && (
        <EditeurGrille
          grille={edition === "nouvelle" ? null : edition}
          profil={profil}
          onClose={() => setEdition(null)}
          onDone={(g, cree) => {
            setEdition(null);
            setMessage(cree ? `Grille « ${g.name} » créée.` : `Grille « ${g.name} » enregistrée : version ${g.version}.`);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function CarteGrille({ g, onModifier }: { g: CheckTemplate; onModifier: () => void }) {
  const points = ordonnes(g.items);
  const bloquants = points.filter((p) => p.blocking).length;
  return (
    <section aria-labelledby={`grille-${g.id}`} className={cx(FEUILLE, "min-w-0 p-6", !g.active && "opacity-80")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`grille-${g.id}`} className="font-display text-[17px] font-[620] leading-snug text-ink">
            {g.name}
          </h2>
          <p className="mt-1 text-[12.5px] text-muted">
            {NATURE_CONTROLE[g.kind]} · {TYPE_VEHICULE[g.vehicle_kind]} · version {g.version}
            {g.updated_at ? `, modifiée le ${fmtDate(g.updated_at)}` : ""}
            {g.updated_by ? ` par ${g.updated_by.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tampon mot={g.active ? "En service" : "Archivée"} />
          <Button size="sm" onClick={onModifier} aria-label={`Modifier la grille ${g.name}`}>
            <Pencil className="h-3.5 w-3.5" /> Modifier
          </Button>
        </div>
      </div>
      <p className="mt-3 text-[13px] text-ink-2">
        {pluriel(points.length, "point")}, dont {pluriel(bloquants, "bloquant")}.
      </p>
      {points.length > 0 && (
        <ol className="mt-3 divide-y divide-line/70 border-t border-line/70">
          {points.map((p, i) => (
            <li key={p.id} className="flex items-start gap-3 py-2 text-[13.5px]">
              <span className="w-5 flex-none pt-px text-right font-semibold tabular text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 text-ink">
                {p.label}
                {p.linked_to === "breath_test" && (
                  <span className="ml-2">
                    <Tag>Formulaire d&apos;alcootest, motif V03</Tag>
                  </span>
                )}
              </span>
              {p.blocking ? (
                <span className="inline-flex flex-none items-center gap-1 text-[12px] font-semibold text-danger">
                  <Lock className="h-3.5 w-3.5" /> Bloquant
                </span>
              ) : (
                <span className="flex-none text-[12px] text-muted">Non bloquant</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Point en cours de saisie ; `cle` tient le point à sa place pendant les déplacements. */
interface PointEdite {
  cle: string;
  id: number | null;
  label: string;
  blocking: boolean;
  linked_to: CheckItem["linked_to"];
}

let compteur = 0;
const nouvelleCle = () => `nouveau-${++compteur}`;

function EditeurGrille({ grille, profil, onClose, onDone }: { grille: CheckTemplate | null; profil: VehicleKind; onClose: () => void; onDone: (g: CheckTemplate, cree: boolean) => void }) {
  const [nom, setNom] = useState(grille?.name ?? "");
  const [nature, setNature] = useState<CheckKind>(grille?.kind ?? "pre_departure");
  const [type, setType] = useState<VehicleKind>(grille?.vehicle_kind ?? profil);
  const [active, setActive] = useState(grille?.active ?? true);
  const [points, setPoints] = useState<PointEdite[]>(() => ordonnes(grille?.items ?? []).map((p) => ({ cle: `point-${p.id}`, id: p.id, label: p.label, blocking: p.blocking, linked_to: p.linked_to })));
  const [erreur, setErreur] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const champs = champsEnErreur(erreur);
  const vides = points.filter((p) => !p.label.trim()).length;
  const complet = nom.trim() !== "" && vides === 0;

  const modifier = (cle: string, modif: Partial<PointEdite>) => setPoints(points.map((p) => (p.cle === cle ? { ...p, ...modif } : p)));
  const deplacer = (i: number, sens: -1 | 1) => {
    const j = i + sens;
    if (j < 0 || j >= points.length) return;
    const suite = [...points];
    const [p] = suite.splice(i, 1);
    if (p) suite.splice(j, 0, p);
    setPoints(suite);
  };

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    const items = points.map((p, i) => ({ ...(p.id ? { id: p.id } : {}), label: p.label.trim(), blocking: p.blocking, sequence: (i + 1) * 10, linked_to: p.linked_to }));
    try {
      const g = grille
        ? await apiSend<CheckTemplate>("PATCH", `/hsseq/checks/templates/${grille.id}`, { name: nom.trim(), active, items })
        : await apiSend<CheckTemplate>("POST", "/hsseq/checks/templates", { name: nom.trim(), kind: nature, vehicle_kind: type, active, items });
      onDone(g, !grille);
    } catch (e) {
      setErreur(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      title={grille ? `Grille « ${grille.name} »` : "Nouvelle grille de contrôle"}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-[12.5px] text-muted">
            {grille ? `Enregistrer crée la version ${grille.version + 1}.` : "Première version de la grille."} {vides > 0 ? `${pluriel(vides, "point")} sans libellé.` : ""}
          </span>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} disabled={!complet} onClick={enregistrer}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {erreur !== null && <Notice tone="danger">{messageErreur(erreur)}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom de la grille" className="sm:col-span-2" error={champs.includes("name") ? "Nom à renseigner" : undefined}>
            <Input value={nom} onChange={(e) => setNom(e.target.value)} required />
          </Field>
          <Field label="Nature du contrôle" hint={grille ? "Fixée à la création" : undefined}>
            <Select value={nature} onChange={(e) => setNature(e.target.value as CheckKind)} options={NATURES} disabled={Boolean(grille)} />
          </Field>
          <Field label="Profil de véhicule" hint={grille ? "Fixé à la création" : undefined}>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as VehicleKind)}
              options={[
                { value: "tanker", label: TYPE_VEHICULE.tanker },
                { value: "tipper", label: TYPE_VEHICULE.tipper },
              ]}
              disabled={Boolean(grille)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Grille en service (proposée au terrain)
          </label>
        </div>

        <fieldset>
          <legend className="mb-1 text-[15px] font-semibold text-ink">Points de contrôle</legend>
          <p className="mb-3 text-[12.5px] leading-snug text-muted">
            Dans l&apos;ordre de saisie au terrain. Un point bloquant non conforme interdit le départ (V02) jusqu&apos;à sa levée par le chef de parc, photo de la correction à l&apos;appui.
          </p>
          {champs.includes("items") && (
            <div className="mb-3">
              <Notice tone="danger">Chaque point porte un libellé.</Notice>
            </div>
          )}
          {points.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Aucun point : ajoutez le premier.</p>
          ) : (
            <ol className="space-y-2">
              {points.map((p, i) => {
                const relie = p.linked_to === "breath_test";
                return (
                  <li key={p.cle} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel px-3 py-2.5 sm:flex-nowrap">
                    <span className="w-5 flex-none text-right text-[13px] font-semibold tabular text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1 basis-60">
                      <Input aria-label={`Libellé du point ${i + 1}`} value={p.label} onChange={(e) => modifier(p.cle, { label: e.target.value })} aria-invalid={!p.label.trim() || undefined} />
                      {relie && <p className="mt-1 text-[12px] text-muted">Renseigné par le formulaire d&apos;alcootest, pas par le contrôle : relève du motif V03.</p>}
                    </div>
                    <label className={cx("flex flex-none items-center gap-2 text-[13px]", relie ? "text-muted" : "text-ink")} title={relie ? "Le motif V03 décide du départ" : undefined}>
                      <input type="checkbox" checked={p.blocking} disabled={relie} onChange={(e) => modifier(p.cle, { blocking: e.target.checked })} /> Bloquant
                    </label>
                    <span className="flex flex-none items-center">
                      <Button variant="ghost" size="sm" aria-label={`Monter le point ${i + 1}`} title="Monter" disabled={i === 0} onClick={() => deplacer(i, -1)}>
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Descendre le point ${i + 1}`} title="Descendre" disabled={i === points.length - 1} onClick={() => deplacer(i, 1)}>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Retirer le point ${i + 1}`} title="Retirer" onClick={() => setPoints(points.filter((x) => x.cle !== p.cle))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <Button size="sm" className="mt-3" onClick={() => setPoints([...points, { cle: nouvelleCle(), id: null, label: "", blocking: false, linked_to: null }])}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un point
          </Button>
          <p className="mt-2 text-[12.5px] text-muted">
            {pluriel(points.length, "point")}, dont {pluriel(points.filter((p) => p.blocking).length, "bloquant")}.
          </p>
        </fieldset>
      </div>
    </Modal>
  );
}
