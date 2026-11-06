"use client";

import { useMemo } from "react";
import { Badge, Button, Card, DataTable, Etat, Select, classesBouton, cx, demanderConfirmation } from "@/components/ui";
import { messageErreur, useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { DataRoom } from "@/components/axispro/dossier/DataRoom";
import { deposerPieces, modifierPiece, retirerPiece, telechargerPiece, usePieces, useReference } from "@/lib/axispro-api";
import { VERIFICATIONS, estV2 } from "@/lib/axispro-parcours";
import type { Piece, PiecesDossier } from "@/lib/axispro-types";
import { fmtDate, fmtInt } from "@/lib/format";
import { SelectGroupe } from "./commun";
import { useDossier } from "./DossierParcours";
import { CarteLienDepot } from "./LienDepot";

/** Taille d'une pièce : « 305 Ko », « 2,4 Mo ». */
function taille(octets: number): string {
  if (octets < 1024 * 1024) return `${fmtInt(Math.max(1, Math.round(octets / 1024)))} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

/** Fichiers proposés au dépôt, d'après les formats du noyau. */
function extensions(formats: string[]): string {
  return formats.flatMap((f) => (f === "JPG" ? [".jpg", ".jpeg"] : [`.${f.toLowerCase()}`])).join(",");
}

/**
 * Étape 2, data room (EC-06) : dix catégories, dépôt multiple, critère justifié et vérification de chaque
 * pièce. Le noyau renomme les pièces (RG-06-01) et contrôle format et taille (RG-06-02). Dépôt et
 * modification : profil cabinet, projet non clos. Rattacher une pièce ne change jamais le statut du critère
 * (RG-06-03). Un dossier de l'ancienne méthode, que la route refuse, garde sa data room.
 */
export function EtapePieces() {
  const { d, relire } = useDossier();
  return estV2(d) ? <PiecesDuNoyau /> : <DataRoom d={d} onChanged={relire} />;
}

function PiecesDuNoyau() {
  const { d } = useDossier();
  const { data, error, mutate } = usePieces(d.id);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement de la data room…">
      {(salle: PiecesDossier) => <Salle salle={salle} relire={() => void mutate()} />}
    </Etat>
  );
}

function Salle({ salle, relire }: { salle: PiecesDossier; relire: () => void }) {
  const { d, relire: relireDossier } = useDossier();
  const { cabinet } = useCabinet();
  const { data: reference } = useReference();
  const { envoyer, enCours, occupe, bandeau, setRetour } = useRetour();
  const deposable = cabinet && d.state !== "closed";
  const groupes = useMemo(() => salle.criteria.map((g) => ({ nom: g.domain, options: g.items.map((c) => ({ value: c.evaluation_id, label: c.name })) })), [salle.criteria]);
  const verifications = reference?.verifications.map((v) => ({ value: v.key, label: v.label })) ?? VERIFICATIONS;
  const maximum = salle.max_file_mb * 1024 * 1024;

  function apres() {
    relire();
    relireDossier();
  }

  /** Dépose ce que le noyau peut recevoir ; un fichier refusé n'empêche pas les autres et son motif s'affiche. */
  async function deposer(lettre: string, fichiers: File[]) {
    const tropGros = fichiers.filter((f) => f.size > maximum).map((f) => `${f.name} : plus de ${salle.max_file_mb} Mo, compressez le fichier`);
    const envoyes = fichiers.filter((f) => f.size <= maximum);
    if (envoyes.length === 0) {
      setRetour({ tone: "danger", text: tropGros.join(" ; ") });
      return;
    }
    const r = await envoyer(() => deposerPieces(d.id, envoyes, { lettre }), undefined, `depot-${lettre}`);
    if (!r) return;
    const refus = [...tropGros, ...r.errors.map((e) => e.message)];
    const depot = `${fmtInt(r.pieces.length)} pièce(s) déposée(s) en catégorie ${lettre}.`;
    setRetour(refus.length ? { tone: "warn", text: `${depot} ${refus.join(" ; ")}` } : { tone: "ok", text: depot });
    apres();
  }

  async function rattacher(f: Piece, evaluationId: number | null) {
    const r = await envoyer(() => modifierPiece(f.id, { evaluation_id: evaluationId }), undefined, `rattache-${f.id}`);
    if (r) apres();
  }

  async function verifier(f: Piece, valeur: string) {
    const r = await envoyer(() => modifierPiece(f.id, { verification: valeur }), undefined, `verif-${f.id}`);
    if (r) apres();
  }

  async function retirer(f: Piece) {
    if (!(await demanderConfirmation(`Retirer « ${f.name} » du projet ? Le fichier stocké est supprimé.`, { action: "Retirer", danger: true }))) return;
    const r = await envoyer(() => retirerPiece(f.id), undefined, `retire-${f.id}`);
    if (r) apres();
  }

  function modifiable(f: Piece) {
    return deposable && (!d.locked || f.after_lock);
  }

  function tableau(pieces: Piece[]) {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-line">
        <DataTable
          dense
          rows={pieces}
          rowKey={(f) => f.id}
          columns={[
            {
              key: "name",
              label: "Fichier",
              render: (f) => (
                <div className="min-w-[200px] max-w-[320px]">
                  <button
                    type="button"
                    className="break-all text-left font-medium text-accent underline underline-offset-2"
                    onClick={() => void telechargerPiece(f.id, f.name).catch((e: unknown) => setRetour({ tone: "danger", text: messageErreur(e) }))}
                  >
                    {f.name}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    {taille(f.size)}
                    {f.source === "portal" && <Badge tone="neutral">Portail</Badge>}
                  </div>
                </div>
              ),
            },
            {
              key: "critere",
              label: "Critère justifié",
              render: (f) => {
                if (!modifiable(f)) return <span>{f.criterion?.name ?? "Aucun critère"}</span>;
                return (
                  <SelectGroupe
                    aria-label={`Critère justifié par ${f.name}`}
                    className="min-w-[260px]"
                    vide="Aucun critère"
                    groupes={groupes}
                    value={f.criterion?.evaluation_id ?? ""}
                    disabled={occupe}
                    onChange={(e) => void rattacher(f, e.target.value ? Number(e.target.value) : null)}
                  />
                );
              },
            },
            {
              key: "verification",
              label: "Vérification",
              render: (f) => {
                if (!modifiable(f)) return <Badge tone={f.verification === "conforming" ? "ok" : f.verification === "to_check" ? "neutral" : "warn"}>{f.verification_label}</Badge>;
                return <Select aria-label={`Vérification de ${f.name}`} className="min-w-[132px]" value={f.verification} disabled={occupe} options={verifications} onChange={(e) => void verifier(f, e.target.value)} />;
              },
            },
            { key: "uploaded_at", label: "Déposé le", render: (f) => <span className="whitespace-nowrap">{fmtDate(f.uploaded_at)}</span> },
            ...(deposable
              ? [{ key: "retirer", label: "", render: (f: Piece) => (modifiable(f) ? <Button size="sm" disabled={occupe} loading={enCours === `retire-${f.id}`} onClick={() => void retirer(f)}>Retirer</Button> : null) }]
              : []),
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {bandeau}
      <Card title={`Data room · ${fmtInt(salle.count)} pièce(s) déposée(s)`} actions={<span className="text-[12.5px] text-muted">Formats acceptés : {salle.formats.join(", ")} · {fmtInt(salle.max_file_mb)} Mo maximum par fichier.</span>}>
        <div>
          {salle.categories.map((cat) => (
            <section key={cat.letter} className="border-t border-line py-3 first:border-0">
              <div className="flex items-center justify-between gap-3">
                <h3 className="min-w-0 text-[13px] font-semibold leading-snug text-muted">
                  <span className="text-[14.5px] text-ink">{cat.letter}. {cat.name}</span> · {fmtInt(cat.count)} déposée(s){cat.expected.length > 0 ? ` · attendues : ${cat.expected.map((p) => p.name).join(", ")}` : ""}
                </h3>
                {deposable && (
                  <label className={cx(classesBouton("secondary", "md", "flex-none"), occupe ? "pointer-events-none opacity-60" : "cursor-pointer")}>
                    {enCours === `depot-${cat.letter}` ? "Dépôt…" : "Déposer"}
                    <input
                      type="file"
                      multiple
                      accept={extensions(salle.formats)}
                      className="sr-only"
                      disabled={occupe}
                      aria-label={`Déposer en catégorie ${cat.letter}. ${cat.name}`}
                      onChange={(e) => {
                        const fichiers = [...(e.target.files ?? [])];
                        e.target.value = "";
                        if (fichiers.length) void deposer(cat.letter, fichiers);
                      }}
                    />
                  </label>
                )}
              </div>
              {cat.pieces.length > 0 && tableau(cat.pieces)}
            </section>
          ))}
          {salle.others.length > 0 && (
            <section className="border-t border-line py-3">
              <h3 className="text-[14.5px] font-semibold text-ink">Pièces sans catégorie · {fmtInt(salle.others.length)}</h3>
              {tableau(salle.others)}
            </section>
          )}
        </div>
      </Card>
      {deposable && <CarteLienDepot />}
      <p className="text-[13px] text-muted">Rattacher une pièce à un critère renseigne sa référence dans le scoring. Le statut du critère reste à fixer à l&apos;étape 3 après vérification.</p>
    </div>
  );
}
