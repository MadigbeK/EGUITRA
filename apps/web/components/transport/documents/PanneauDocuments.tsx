"use client";

import { useState } from "react";
import { CheckCircle2, Download, FileText, Printer } from "@/components/icons";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { ApiError, apiDownload } from "@/lib/api-client";
import type { DocumentStatut } from "./types";

/** Message d'une erreur de l'API, ou un texte par défaut. */
export function texteErreur(e: unknown, defaut = "Action impossible."): string {
  return e instanceof ApiError ? e.message : defaut;
}

/**
 * Panneau « Documents » d'une opération ou d'un ordre de transport : chaque document est prêt (bouton
 * Télécharger) ou incomplet (ce qui manque, en clair). Les documents apparaissent d'eux-mêmes quand leurs
 * informations sont complètes ; « Tout imprimer » rend les documents prêts en un seul PDF.
 */
export function PanneauDocuments({ documents, combine, nomCombine, titre = "Documents" }: {
  documents: DocumentStatut[];
  /** Adresse du PDF unique (documents prêts de l'opération) ; absent : pas de bouton « Tout imprimer ». */
  combine?: string;
  nomCombine?: string;
  titre?: string;
}) {
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const prets = documents.filter((d) => d.ready).length;

  async function telecharger(cle: string, chemin: string, nom: string) {
    setEnCours(cle);
    setErreur(null);
    try {
      await apiDownload(chemin, nom);
    } catch (e) {
      setErreur(texteErreur(e, "Téléchargement impossible."));
    } finally {
      setEnCours(null);
    }
  }

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><FileText className="h-4 w-4" /> {titre} <Badge tone={prets === documents.length ? "ok" : "warn"}>{prets} sur {documents.length} prêts</Badge></span>}
      actions={combine && prets > 0 ? (
        <Button size="sm" loading={enCours === "tout"} disabled={enCours !== null} onClick={() => void telecharger("tout", combine, nomCombine ?? "Documents.pdf")}>
          <Printer className="h-4 w-4" /> Tout imprimer
        </Button>
      ) : undefined}
    >
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {documents.map((d) => (
          <li key={d.code} className="rounded-xl p-3 ring-1 ring-line">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  {d.ready && <CheckCircle2 className="h-4 w-4 text-ok" />}
                  {d.label}
                </div>
                <div className="text-[12.5px] text-muted">{d.number ?? (d.ready ? "Numéro attribué à la première impression" : "")}</div>
              </div>
              {d.ready && d.pdf ? (
                <Button size="sm" loading={enCours === d.code} disabled={enCours !== null} onClick={() => void telecharger(d.code, d.pdf!, `${d.label}.pdf`)}>
                  <Download className="h-4 w-4" /> Télécharger
                </Button>
              ) : (
                <Badge tone="warn">Incomplet</Badge>
              )}
            </div>
            {!d.ready && d.missing.length > 0 && (
              <div className="mt-2 text-[13px] text-ink">
                Il manque :
                <ul className="ml-4 list-disc text-muted">
                  {d.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
            {d.warnings.length > 0 && <p className="mt-2 text-[12.5px] text-warn">{d.warnings.join(" ")}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
