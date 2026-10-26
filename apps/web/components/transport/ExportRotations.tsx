"use client";

import { useState } from "react";
import { Download } from "@/components/icons";
import { Button, Field, Input, Modal, Notice, Select } from "@/components/ui";
import { ApiError, apiDownload } from "@/lib/api-client";

/** États exportables ; « hors annulées » par défaut. */
const STATUTS = [
  { value: "draft,en_route,done,invoiced", label: "Toutes, hors annulées" },
  { value: "done,invoiced", label: "Validées et facturées" },
  { value: "draft,en_route", label: "Saisies et en route (à valider)" },
  { value: "done", label: "À facturer (validées)" },
  { value: "invoiced", label: "Facturées" },
  { value: "draft,en_route,done,invoiced,cancelled", label: "Toutes, annulées comprises" },
];

/** « AAAA-MM-JJ » du jour à Conakry (le noyau date les rotations à l'heure de Conakry). */
function jour(d = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Conakry", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Export des rotations (GET /transport/exports/rotations, profils de lecture du transport) : période et
 * statut choisis, au lieu du 1er janvier à aujourd'hui, tous états confondus. Le téléchargement montre
 * son chargement et son échec.
 */
export function ExportRotations() {
  const [ouvert, setOuvert] = useState(false);
  const aujourdhui = jour();
  const [du, setDu] = useState(`${aujourdhui.slice(0, 4)}-01-01`);
  const [au, setAu] = useState(aujourdhui);
  const [statut, setStatut] = useState(STATUTS[0]!.value);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const incoherent = Boolean(du && au && du > au);

  async function exporter() {
    setBusy(true);
    setErreur(null);
    try {
      const params = new URLSearchParams({ date_from: du, date_to: au, state: statut, format });
      await apiDownload(`/transport/exports/rotations?${params.toString()}`, `rotations_${du}_${au}.${format}`);
      setOuvert(false);
    } catch (e) {
      setErreur(e instanceof ApiError ? e.message : "Export impossible : vérifiez le réseau, puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => { setErreur(null); setOuvert(true); }}>
        <Download className="h-4 w-4" /> Exporter les rotations
      </Button>
      {ouvert && (
        <Modal open title="Exporter les rotations" onClose={() => !busy && setOuvert(false)} footer={
          <Button variant="primary" loading={busy} disabled={!du || !au || incoherent} onClick={() => void exporter()}>
            <Download className="h-4 w-4" /> Télécharger
          </Button>
        }>
          <div className="grid gap-3 sm:grid-cols-2">
            {erreur && <div className="sm:col-span-2"><Notice tone="danger">{erreur}</Notice></div>}
            <Field label="Chargées du"><Input type="date" value={du} onChange={(e) => setDu(e.target.value)} /></Field>
            <Field label="au" error={incoherent ? "La fin précède le début." : undefined}><Input type="date" value={au} min={du} onChange={(e) => setAu(e.target.value)} /></Field>
            <Field label="Statut" className="sm:col-span-2"><Select value={statut} onChange={(e) => setStatut(e.target.value)} options={STATUTS} /></Field>
            <Field label="Format" className="sm:col-span-2"><Select value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv")} options={[{ value: "xlsx", label: "Excel (XLSX)" }, { value: "csv", label: "CSV" }]} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
