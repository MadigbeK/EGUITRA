"use client";

import type { ReactNode } from "react";
import { DataTable, Empty, type Column, type Tri } from "@/components/ui";
import { heureCk, jourCk } from "@/components/hsseq/trajets/outils";
import type { ViolationType } from "@/lib/hsseq-types";
import { INSECABLE } from "@/lib/format";
import { TYPE_VIOLATION } from "./outils";

/**
 * Violation telle qu'elle s'affiche, qu'elle vienne de la liste du noyau ou du contrôle à blanc d'un
 * fichier (valeurs brutes rapprochées des référentiels). `onVehicule` et `onConducteur` posent le filtre
 * correspondant (raccourci de la liste).
 */
export interface LigneViolation {
  cle: number | string;
  /** Horodatage ISO 8601 en UTC, l'heure de Conakry. */
  moment: string;
  type: ViolationType;
  releve: string | null;
  vehicule: string;
  /** Profil, plaque et, si le compte lit plusieurs sites, le site. */
  detailVehicule: string;
  /** Nom du conducteur ; nul quand il n'est pas identifié. Jamais servi à l'auditeur. */
  conducteur: string | null;
  /** Rotation en cours (« ROT/2026/01105, Conakry - Kankan »), ou « Hors rotation ». */
  rotation: string;
  lieu: string | null;
  /** Système et référence chez le fournisseur : « IVMS, réf. IV-20261011-04366 ». */
  source: string;
  onVehicule?: () => void;
  onConducteur?: () => void;
}

/** Bouton d'un nom qui pose un filtre, ou le nom seul. */
function Raccourci({ onClick, titre, children }: { onClick?: () => void; titre: string; children: ReactNode }) {
  if (!onClick) return <span className="font-semibold text-ink">{children}</span>;
  return (
    <button type="button" onClick={onClick} title={titre} className="rounded text-left font-semibold text-ink underline-offset-2 outline-offset-2 transition-colors hover:text-accent hover:underline">
      {children}
    </button>
  );
}

/**
 * Violations en tableau sur grand écran (le lieu passe sous 768 px), en fiches empilées sur téléphone.
 * `tri` et `onTri` commandent le tri du noyau (date, type) ; sans eux, le tableau trie ses lignes.
 * L'auditeur (`nomsCaches`) ne voit pas la colonne du conducteur : seulement la rotation.
 */
export function ListeViolations({ lignes, nomsCaches, tri, onTri, vide }: { lignes: LigneViolation[]; nomsCaches: boolean; tri?: Tri; onTri?: (t: Tri) => void; vide: { titre: string; aide?: string } }) {
  if (!lignes.length) return <Empty title={vide.titre} hint={vide.aide} />;
  const personne: Column<LigneViolation> = nomsCaches
    ? { key: "rotation", label: "Rotation", render: (l) => <span className="block min-w-[10rem] max-w-[28ch] leading-snug text-ink-2">{l.rotation}</span> }
    : {
        key: "conducteur",
        label: "Conducteur",
        sortValue: (l) => l.conducteur,
        render: (l) => (
          <span className="block min-w-[10rem] max-w-[28ch]">
            {l.conducteur ? (
              <Raccourci onClick={l.onConducteur} titre={`Violations de ${l.conducteur}`}>
                {l.conducteur}
              </Raccourci>
            ) : (
              <span className="text-muted">Non identifié</span>
            )}
            <span className="mt-0.5 block text-[12px] leading-snug text-muted">{l.rotation}</span>
          </span>
        ),
      };
  const colonnes: Column<LigneViolation>[] = [
    {
      key: "occurred_at",
      label: "Survenue",
      sortValue: (l) => l.moment,
      render: (l) => (
        <span className="block whitespace-nowrap">
          <span className="font-medium text-ink">{jourCk(l.moment)}</span>
          <span className="block text-[12px] text-muted">{heureCk(l.moment)}</span>
        </span>
      ),
    },
    {
      key: "violation_type",
      label: "Violation",
      sortValue: (l) => TYPE_VIOLATION[l.type].label,
      render: (l) => (
        <span className="block min-w-[12rem] max-w-[36ch]">
          <span className="font-semibold text-ink">{TYPE_VIOLATION[l.type].label}</span>
          {l.releve && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-2">{l.releve}</span>}
        </span>
      ),
    },
    {
      key: "vehicle",
      label: "Véhicule",
      sortValue: (l) => l.vehicule,
      render: (l) => (
        <span className="block whitespace-nowrap">
          <Raccourci onClick={l.onVehicule} titre={`Violations de ${l.vehicule}`}>
            {l.vehicule}
          </Raccourci>
          <span className="block text-[12px] text-muted">{l.detailVehicule}</span>
        </span>
      ),
    },
    personne,
    {
      key: "location",
      label: "Lieu et source",
      sortValue: (l) => l.lieu,
      render: (l) => (
        <span className="block min-w-[10rem] max-w-[30ch] leading-snug">
          <span className={l.lieu ? "text-ink-2" : "text-muted"}>{l.lieu ?? "Lieu non relevé"}</span>
          <span className="mt-0.5 block break-words text-[12px] text-muted">{l.source}</span>
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="hidden max-md:[&_tr>:nth-child(5)]:hidden sm:block">
        <DataTable rows={lignes} rowKey={(l) => l.cle} columns={colonnes} sort={tri ?? null} onSort={onTri} />
      </div>
      <ul className="sm:hidden">
        {lignes.map((l) => (
          <li key={l.cle} className="border-t border-line/80 px-5 py-3.5 first:border-t-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold leading-snug text-ink">{TYPE_VIOLATION[l.type].label}</span>
              <span className="flex-none whitespace-nowrap text-[12.5px] tabular text-muted">
                {jourCk(l.moment)} à {heureCk(l.moment)}
              </span>
            </div>
            {l.releve && <p className="m-0 mt-0.5 text-[13px] leading-snug text-ink-2">{l.releve}</p>}
            <p className="m-0 mt-1.5 text-[13px] leading-snug text-ink">
              <Raccourci onClick={l.onVehicule} titre={`Violations de ${l.vehicule}`}>
                {l.vehicule}
              </Raccourci>
              {!nomsCaches && (
                <>
                  {", "}
                  {l.conducteur ? (
                    <Raccourci onClick={l.onConducteur} titre={`Violations de ${l.conducteur}`}>
                      {l.conducteur}
                    </Raccourci>
                  ) : (
                    <span className="text-muted">conducteur non identifié</span>
                  )}
                </>
              )}
            </p>
            <p className="m-0 mt-0.5 text-[12.5px] leading-snug text-muted">{[l.rotation, l.lieu, l.source].filter(Boolean).join(`${INSECABLE}; `)}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
