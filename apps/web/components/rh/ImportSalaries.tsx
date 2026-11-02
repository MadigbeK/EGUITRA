"use client";

import { useState } from "react";
import { Download } from "@/components/icons";
import { Badge, Button, DataTable, Field, Modal, Notice } from "@/components/ui";
import { ApiError, apiDownload, apiUpload } from "@/lib/api-client";
import { pluriel } from "@/lib/format";
import type { ImportLine, ImportResult, Meta } from "@/lib/rh-types";
import { PastilleSociete, messageErreur } from "./commun";

const MAX_TABLEAU = 5 * 1024 * 1024;
const MAX_ARCHIVE = 100 * 1024 * 1024;

/**
 * Import des salariés (RH et administration) : modèle à télécharger, fichier XLSX ou CSV, archive ZIP de
 * photos facultative ; aperçu d'abord (créés, mis à jour, inchangés, refusés avec leur motif, photos
 * trouvées ou manquantes), puis import, tout ou rien.
 */
export function ImportSalaries({ meta, onClose, onDone }: { meta: Meta; onClose: () => void; onDone: () => void }) {
  const [fichier, setFichier] = useState<File | null>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const [apercu, setApercu] = useState<ImportResult | null>(null);
  const [fait, setFait] = useState<ImportResult | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState<"apercu" | "import" | "modele" | null>(null);

  function choisir(setter: (f: File | null) => void, f: File | null, max: number, libelle: string) {
    setErreur(null);
    setApercu(null);
    if (f && f.size > max) {
      setErreur(`${libelle} trop volumineux : ${Math.round(max / 1024 / 1024)} Mo au plus.`);
      setter(null);
      return;
    }
    setter(f);
  }

  async function envoyer(mode: "preview" | "import") {
    if (!fichier) return;
    setBusy(mode === "preview" ? "apercu" : "import");
    setErreur(null);
    const form = new FormData();
    form.append("mode", mode);
    form.append("file", fichier);
    if (archive) form.append("photos", archive);
    try {
      const resultat = await apiUpload<ImportResult>("/rh/employees/import", form);
      if (mode === "preview") setApercu(resultat);
      else {
        setFait(resultat);
        onDone();
      }
    } catch (e) {
      const corps = e instanceof ApiError ? (e.body as unknown as { preview?: ImportResult }) : null;
      if (corps?.preview) setApercu(corps.preview);
      setErreur(messageErreur(e));
    } finally {
      setBusy(null);
    }
  }

  async function modele(format: "xlsx" | "csv") {
    setBusy("modele");
    setErreur(null);
    try {
      await apiDownload(`/rh/employees/import/template?format=${format}`, `import_salaries.${format}`);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(null);
    }
  }

  const refusees = apercu?.summary.refused ?? 0;
  return (
    <Modal
      open
      wide
      title="Importer des salariés"
      onClose={() => !busy && onClose()}
      footer={
        fait ? (
          <Button variant="primary" onClick={onClose}>
            Fermer
          </Button>
        ) : (
          <>
            <Button disabled={!fichier || busy !== null} loading={busy === "apercu"} onClick={() => void envoyer("preview")}>
              {apercu ? "Relancer l'aperçu" : "Voir l'aperçu"}
            </Button>
            <Button variant="primary" disabled={!apercu || refusees > 0 || busy !== null} loading={busy === "import"} onClick={() => void envoyer("import")}>
              Importer
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        {fait ? (
          <Notice tone="ok">
            Import terminé : {pluriel(fait.summary.create, "salarié créé", "salariés créés")}, {pluriel(fait.summary.update, "dossier mis à jour", "dossiers mis à jour")}
            {fait.summary.photos_found ? `, ${pluriel(fait.summary.photos_found, "photo rattachée", "photos rattachées")}` : ""}.
            {fait.summary.to_complete > 0 && ` ${pluriel(fait.summary.to_complete, "fiche reste à compléter", "fiches restent à compléter")} (date d'entrée, salaire de base) avant la paie.`}
          </Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink-2">Partez du modèle :</span>
              <Button size="sm" disabled={busy !== null} onClick={() => void modele("xlsx")}>
                <Download className="h-3.5 w-3.5" /> Modèle Excel
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => void modele("csv")}>
                <Download className="h-3.5 w-3.5" /> Modèle CSV
              </Button>
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Colonnes : Matricule, Nom complet, Poste, Département, Courriel professionnel, Téléphone, Contrat (CDI, CDD, Stage ou Apprentissage), Catégorie (Cadre, Agent de maîtrise, Employé, Ouvrier), Société
              {meta.companies.length > 1 ? ` (${meta.companies.map((c) => c.name).join(", ")}, « Groupe » ou « Cabinet » ; vide : société de travail)` : ""}, Date d&apos;entrée, Fin du contrat (obligatoire pour un CDD), Salaire de base. Un salarié déjà enregistré (même matricule, sinon même courriel, sinon même nom) est mis à jour, jamais dupliqué ; une cellule vide ne change rien.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fichier des salariés (XLSX ou CSV, 5 Mo au plus)">
                <input type="file" accept=".xlsx,.csv,text/csv" className="text-sm" onChange={(e) => choisir(setFichier, e.target.files?.[0] ?? null, MAX_TABLEAU, "Fichier")} />
              </Field>
              <Field label="Photos (facultatif) : archive ZIP" hint="Chaque image nommée par le matricule (eg-0001.jpg) ou par le nom sans accents ni espaces (aissata_thiam.png). JPEG, PNG ou WebP, 5 Mo au plus chacune.">
                <input type="file" accept=".zip,application/zip" className="text-sm" onChange={(e) => choisir(setArchive, e.target.files?.[0] ?? null, MAX_ARCHIVE, "Archive")} />
              </Field>
            </div>
          </>
        )}
        {apercu && !fait && <Apercu r={apercu} plusieurs={meta.companies.length > 1} />}
      </div>
    </Modal>
  );
}

const ACTIONS: Record<ImportLine["action"], { label: string; tone: "ok" | "accent" | "neutral" }> = {
  create: { label: "Créé", tone: "ok" },
  update: { label: "Mis à jour", tone: "accent" },
  unchanged: { label: "Inchangé", tone: "neutral" },
};

function Apercu({ r, plusieurs }: { r: ImportResult; plusieurs: boolean }) {
  const s = r.summary;
  const avecPhotos = r.lines.some((l) => l.photo !== null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone="ok">{pluriel(s.create, "à créer", "à créer")}</Badge>
        <Badge tone="accent">{pluriel(s.update, "à mettre à jour", "à mettre à jour")}</Badge>
        {s.unchanged > 0 && <Badge tone="neutral">{pluriel(s.unchanged, "inchangé", "inchangés")}</Badge>}
        {s.refused > 0 && <Badge tone="danger">{pluriel(s.refused, "refusée", "refusées")}</Badge>}
        {s.to_complete > 0 && <Badge tone="warn">{pluriel(s.to_complete, "fiche à compléter", "fiches à compléter")}</Badge>}
        {avecPhotos && <Badge tone="neutral">{pluriel(s.photos_found, "photo trouvée", "photos trouvées")}, {pluriel(s.photos_missing, "manquante", "manquantes")}</Badge>}
      </div>
      {s.refused > 0 ? (
        <Notice tone="danger">Corrigez les lignes refusées puis relancez l&apos;aperçu : rien n&apos;est importé tant qu&apos;une ligne est refusée.</Notice>
      ) : (
        <Notice tone="neutral">Aperçu seulement : rien n&apos;est encore enregistré. « Importer » enregistre toutes les lignes d&apos;un coup.</Notice>
      )}
      {r.departments_created.length > 0 && <p className="text-[12.5px] text-ink-2">Départements créés : {r.departments_created.join(", ")}.</p>}
      {r.photos_unmatched.length > 0 && <p className="text-[12.5px] text-warn">Photos sans salarié correspondant (ignorées) : {r.photos_unmatched.join(", ")}.</p>}
      {r.photos_ignored.length > 0 && <p className="text-[12.5px] text-muted">Fichiers écartés de l&apos;archive : {r.photos_ignored.map((p) => `${p.name} (${p.reason})`).join(", ")}.</p>}
      <div className="max-h-[45vh] overflow-auto rounded-xl border border-line">
        <DataTable
          dense
          rows={r.lines}
          rowKey={(l) => l.line}
          columns={[
            { key: "line", label: "Ligne", render: (l) => <span className="tabular-nums text-muted">{l.line}</span> },
            {
              key: "name",
              label: "Salarié",
              render: (l) => (
                <span className="block min-w-0">
                  <span className="block font-medium text-ink">{l.name || "–"}</span>
                  {l.matricule && <span className="font-mono text-[11.5px] text-muted">{l.matricule}</span>}
                </span>
              ),
            },
            ...(plusieurs ? [{ key: "company", label: "Société", render: (l: ImportLine) => (l.company ? <PastilleSociete company={l.company} /> : "–") }] : []),
            {
              key: "action",
              label: "Résultat",
              render: (l) => (l.errors.length ? <Badge tone="danger">Refusée</Badge> : <Badge tone={ACTIONS[l.action].tone}>{ACTIONS[l.action].label}</Badge>),
            },
            ...(avecPhotos
              ? [
                  {
                    key: "photo",
                    label: "Photo",
                    render: (l: ImportLine) =>
                      l.photo === "found" ? <span className="text-ok-texte">{l.photo_file}</span> : l.photo === "error" ? <span className="text-danger">{l.photo_file ?? "refusée"}</span> : <span className="text-muted">manquante</span>,
                  },
                ]
              : []),
            {
              key: "detail",
              label: "Détail",
              render: (l) => (
                <span className="block min-w-[14rem] text-[12.5px]">
                  {l.errors.map((m, i) => (
                    <span key={`e${i}`} className="block text-danger">
                      {m}
                    </span>
                  ))}
                  {l.warnings.map((m, i) => (
                    <span key={`w${i}`} className="block text-warn">
                      {m}
                    </span>
                  ))}
                  {l.changes.length > 0 && <span className="block text-ink-2">Modifié : {l.changes.join(", ")}</span>}
                  {l.department_new && !l.errors.length && <span className="block text-muted">Nouveau département : {l.department_new}</span>}
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
