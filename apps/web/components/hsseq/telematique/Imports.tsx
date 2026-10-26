"use client";

import { useState } from "react";
import { Button, Card, DataTable, Empty, ErrorBox, Etat, Modal, Notice, type Column, type Tri } from "@/components/ui";
import { Pages, requete } from "@/components/hsseq/actions/outils";
import { heureCk, jourCk } from "@/components/hsseq/trajets/outils";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtInt, pluriel } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { LignesSignalees } from "./elements";
import { NouvelImport } from "./NouvelImport";
import type { TelematicsImport } from "./types";

/** Imports par page d'historique. */
const PAR_PAGE = 20;

const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";

/** « 7 lignes lues : 5 violations créées, 2 doublons ignorés ». */
function bilan(b: TelematicsImport): string {
  return `${pluriel(b.rows, "ligne lue", "lignes lues")}${INSECABLE}: ${pluriel(b.created, "violation créée", "violations créées")}, ${pluriel(b.duplicates, "doublon ignoré", "doublons ignorés")}`;
}

/** Source de l'import : celle du formulaire, sinon lue ligne à ligne dans le fichier. */
const source = (b: TelematicsImport) => (b.source ? `Source ${b.source}` : "Source lue dans le fichier");

/**
 * Imports de la télématique (GET /hsseq/telematics/imports) : administration, direction et Responsable
 * HSSEQ. Le Responsable HSSEQ y importe un fichier (NouvelImport) ; l'historique donne pour chaque fichier
 * les lignes lues, les violations créées, les doublons ignorés et les avertissements, et mène à ses
 * violations. Un fichier refusé n'est pas enregistré : il n'apparaît pas dans l'historique.
 */
export function Imports({ importeur, onVoir }: { importeur: boolean; onVoir: (id: number) => void }) {
  const [tri, setTri] = useState<Tri>({ key: "imported_at", dir: -1 });
  const [position, setPosition] = useState({ dir: tri.dir, offset: 0 });
  const offset = position.dir === tri.dir ? position.offset : 0;
  const { data, error, mutate } = useApi<Page<TelematicsImport>>(`/hsseq/telematics/imports?${requete({ sort: tri.dir === -1 ? "-imported_at" : "imported_at", offset, limit: PAR_PAGE })}`, { keepPreviousData: true });
  const [signale, setSignale] = useState<TelematicsImport | null>(null);

  const avertissements = (b: TelematicsImport) =>
    b.warnings.length ? (
      <button type="button" className={LIEN} onClick={() => setSignale(b)}>
        {pluriel(b.warnings.length, "avertissement")}
      </button>
    ) : (
      <span className="text-muted">Aucun</span>
    );
  const voir = (b: TelematicsImport) =>
    b.created > 0 ? (
      <Button size="sm" variant="ghost" onClick={() => onVoir(b.id)} aria-label={`Voir les violations de l'import ${b.name}`}>
        Voir les violations
      </Button>
    ) : null;

  const colonnes: Column<TelematicsImport>[] = [
    {
      key: "name",
      label: "Fichier",
      render: (b) => (
        <span className="block min-w-[14rem] max-w-[44ch]">
          <span className="break-all font-semibold text-ink">{b.name}</span>
          <span className="mt-0.5 block text-[12px] text-muted">{source(b)}</span>
        </span>
      ),
    },
    {
      key: "imported_at",
      label: "Importé le",
      render: (b) => (
        <span className="block whitespace-nowrap">
          <span className="font-medium text-ink">
            {jourCk(b.imported_at)} à {heureCk(b.imported_at)}
          </span>
          <span className="block text-[12px] text-muted">{b.imported_by?.name ?? "–"}</span>
        </span>
      ),
    },
    { key: "rows", label: "Lignes lues", align: "right", render: (b) => fmtInt(b.rows) },
    { key: "created", label: "Violations créées", align: "right", render: (b) => fmtInt(b.created) },
    { key: "duplicates", label: "Doublons ignorés", align: "right", render: (b) => fmtInt(b.duplicates) },
    { key: "warnings", label: "Avertissements", render: avertissements },
    { key: "voir", label: "", render: voir },
  ];

  return (
    <div className="space-y-6">
      {importeur ? (
        <NouvelImport onVoir={onVoir} />
      ) : (
        <Notice tone="neutral">L&apos;import des fichiers des boîtiers revient au Responsable HSSEQ&nbsp;; l&apos;historique ci-dessous en garde la trace.</Notice>
      )}

      <Card padded={false} title={data ? `Historique des imports, ${fmtInt(data.total_count)}` : "Historique des imports"}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement de l'historique des imports…" />
        ) : (
          <>
            {error && (
              <div className="px-5 pb-3">
                <ErrorBox error={error} onRetry={() => void mutate()} titre="L'historique n'a pas pu être relu ; il est affiché tel qu'au dernier chargement." />
              </div>
            )}
            {data.items.length === 0 ? (
              <Empty title="Aucun import pour l'instant." hint={importeur ? "Contrôlez puis importez l'export des boîtiers ci-dessus." : "Le Responsable HSSEQ importe les fichiers exportés du système du fournisseur des boîtiers."} />
            ) : (
              <>
                <div className="hidden sm:block">
                  <DataTable
                    rows={data.items}
                    rowKey={(b) => b.id}
                    columns={colonnes}
                    sort={tri}
                    onSort={(t) => {
                      if (t.key === "imported_at") {
                        setTri(t);
                        setPosition({ dir: t.dir, offset: 0 });
                      }
                    }}
                  />
                </div>
                <ul className="sm:hidden">
                  {data.items.map((b) => (
                    <li key={b.id} className="border-t border-line/80 px-5 py-3.5 first:border-t-0">
                      <p className="break-all font-semibold leading-snug text-ink">{b.name}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
                        {jourCk(b.imported_at)} à {heureCk(b.imported_at)}
                        {b.imported_by ? `, ${b.imported_by.name}` : ""}
                        {`${INSECABLE}; ${source(b).toLocaleLowerCase("fr")}`}
                      </p>
                      <p className="mt-1 text-[13px] leading-snug text-ink-2">{bilan(b)}.</p>
                      {(b.warnings.length > 0 || b.created > 0) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                          {b.warnings.length > 0 && avertissements(b)}
                          {voir(b)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="imports" onPage={(o) => setPosition({ dir: tri.dir, offset: o })} />
          </>
        )}
      </Card>

      <Modal open={signale !== null} title="Avertissements de l'import" onClose={() => setSignale(null)}>
        {signale && (
          <div className="space-y-3">
            <p className="text-[13px] leading-snug text-ink-2">
              <span className="break-all font-semibold text-ink">{signale.name}</span>, importé le {jourCk(signale.imported_at)} à {heureCk(signale.imported_at)}
              {signale.imported_by ? ` par ${signale.imported_by.name}` : ""}.
            </p>
            <LignesSignalees lignes={signale.warnings} />
            <p className="text-[12.5px] leading-snug text-muted">
              Ces lignes ont créé leur violation, rattachée au conducteur de la rotation en cours quand il y en avait une. Pour les prochains imports, écrivez le nom du conducteur comme dans Transport, chez le fournisseur.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
