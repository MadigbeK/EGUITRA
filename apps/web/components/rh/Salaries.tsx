"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileUp, Grid, Menu, Plus, Search } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, Etat, Input, PageHeader, Segmented, cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF, pluriel } from "@/lib/format";
import { CONTRACT_LABELS, type EmployeeRow } from "@/lib/rh-types";
import { EtatSalarie, FiltreSociete, PastilleSociete, avecSociete, jours, useMeta } from "./commun";
import { FormulaireSalarie } from "./FormulaireSalarie";
import { ImportSalaries } from "./ImportSalaries";
import { PhotoSalarie, cheminPhoto } from "./Photo";

type Filtre = "active" | "sorti" | "all";
type Vue = "cartes" | "liste";

/** Choix de la vue, mémorisé dans ce navigateur (commodité : la page s'affiche sans lui). */
const CLE_VUE = "nimova.rh.salaries.vue";
/** Département choisi : tous, sans département (0) ou un département. */
type ChoixDepartement = "tous" | number;

function lireVue(): Vue {
  try {
    return window.localStorage.getItem(CLE_VUE) === "liste" ? "liste" : "cartes";
  } catch {
    return "cartes";
  }
}

/**
 * Personnel des sociétés du compte : trombinoscope (photo ou initiales, poste, coordonnées, contrat) ou
 * liste ; départements avec leurs effectifs, recherche, état, société ; import des fiches existantes.
 */
export function ListeSalaries() {
  const router = useRouter();
  const [filtre, setFiltre] = useState<Filtre>("active");
  const [departement, setDepartement] = useState<ChoixDepartement>("tous");
  const [societe, setSociete] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [vue, setVue] = useState<Vue>("cartes");
  const [creation, setCreation] = useState(false);
  const [importation, setImportation] = useState(false);
  const { data: meta } = useMeta();
  const { data, error, mutate } = useApi<EmployeeRow[]>(avecSociete(`/rh/employees?state=${filtre}`, societe));
  const plusieurs = (meta?.companies.length ?? 0) > 1;

  useEffect(() => {
    setVue(lireVue());
  }, []);
  function choisirVue(v: Vue) {
    setVue(v);
    try {
      window.localStorage.setItem(CLE_VUE, v);
    } catch {
      // Stockage refusé (navigation privée) : le choix vaut pour cette page.
    }
  }

  // Recherche d'abord, puis effectifs par département sur le résultat ; le département filtre en dernier.
  const trouves = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!data || !t) return data ?? [];
    return data.filter((e) => [e.name, e.matricule, e.job_title ?? "", e.department?.name ?? "", e.phone ?? "", e.email ?? ""].some((v) => v.toLowerCase().includes(t)));
  }, [data, q]);
  const departements = useMemo(() => {
    const compte = new Map<number, { id: number; name: string; n: number }>();
    for (const e of trouves) {
      const id = e.department?.id ?? 0;
      const d = compte.get(id) ?? { id, name: e.department?.name ?? "Sans département", n: 0 };
      d.n += 1;
      compte.set(id, d);
    }
    return [...compte.values()].sort((a, b) => (a.id === 0 ? 1 : b.id === 0 ? -1 : a.name.localeCompare(b.name, "fr")));
  }, [trouves]);
  const lignes = departement === "tous" ? trouves : trouves.filter((e) => (e.department?.id ?? 0) === departement);
  const incomplets = (data ?? []).filter((e) => e.issues.length > 0).length;
  const aCompleter = (data ?? []).filter((e) => e.to_complete).length;

  return (
    <div>
      <PageHeader
        title="Salariés"
        subtitle="Dossiers du personnel des deux sociétés, chacune restant l'employeur légal : poste, contrat, rémunération, congés, documents."
        actions={
          meta?.can_write && (
            <>
              <Button onClick={() => setImportation(true)}>
                <FileUp className="h-4 w-4" /> Importer
              </Button>
              <Button variant="primary" onClick={() => setCreation(true)}>
                <Plus className="h-4 w-4" /> Nouveau salarié
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="État"
          value={filtre}
          onChange={setFiltre}
          options={[
            { key: "active", label: "En poste" },
            { key: "sorti", label: "Sortis" },
            { key: "all", label: "Tous" },
          ]}
        />
        <FiltreSociete
          companies={meta?.companies}
          value={societe}
          onChange={(id) => {
            setSociete(id);
            setDepartement("tous");
          }}
        />
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" placeholder="Nom, matricule, poste, courriel…" aria-label="Rechercher un salarié" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-line bg-panel-2 p-1" role="group" aria-label="Affichage">
          {(
            [
              { key: "cartes", label: "Cartes", I: Grid },
              { key: "liste", label: "Liste", I: Menu },
            ] as const
          ).map(({ key, label, I }) => (
            <button
              key={key}
              type="button"
              aria-pressed={vue === key}
              title={`Vue en ${label.toLowerCase()}`}
              onClick={() => choisirVue(key)}
              className={cx("flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[13px] font-semibold transition-colors", vue === key ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink")}
            >
              <I className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>
      {(incomplets > 0 || aCompleter > 0) && (
        <p className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-warn">
          {aCompleter > 0 && (
            <span className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4" /> {pluriel(aCompleter, "fiche à compléter avant la paie", "fiches à compléter avant la paie")}
            </span>
          )}
          {incomplets > 0 && <span>{pluriel(incomplets, "dossier avec des points à compléter", "dossiers avec des points à compléter")}</span>}
        </p>
      )}
      {!data ? (
        <Card>
          <Etat error={error} onRetry={() => mutate()} label="Chargement du personnel…" />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Départements" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0">
            <p className="hidden px-3 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted lg:block">Département</p>
            <BoutonDepartement actif={departement === "tous"} nom="Tous" n={trouves.length} onClick={() => setDepartement("tous")} />
            {departements.map((d) => (
              <BoutonDepartement key={d.id} actif={departement === d.id} nom={d.name} n={d.n} onClick={() => setDepartement(d.id)} />
            ))}
          </nav>
          <div className="min-w-0">
            {vue === "cartes" ? (
              lignes.length === 0 ? (
                <Card>
                  <Empty title={q ? "Aucun salarié ne correspond à la recherche." : "Aucun salarié."} />
                </Card>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {lignes.map((e) => (
                    <li key={e.id}>
                      <CarteSalarie e={e} plusieurs={plusieurs} />
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <Card padded={false}>
                <ListeTableau lignes={lignes} plusieurs={plusieurs} vide={q ? "Aucun salarié ne correspond à la recherche." : "Aucun salarié."} onOuvrir={(e) => router.push(`/rh/salaries/${e.id}`)} />
              </Card>
            )}
          </div>
        </div>
      )}
      {creation && meta && (
        <FormulaireSalarie
          meta={meta}
          onClose={() => setCreation(false)}
          onDone={(e) => {
            setCreation(false);
            void mutate();
            router.push(`/rh/salaries/${e.id}`);
          }}
        />
      )}
      {importation && meta && (
        <ImportSalaries
          meta={meta}
          onClose={() => setImportation(false)}
          onDone={() => {
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function BoutonDepartement({ actif, nom, n, onClick }: { actif: boolean; nom: string; n: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cx(
        "flex flex-none items-center justify-between gap-3 whitespace-nowrap rounded-xl border px-3 py-2 text-left text-[13.5px] transition-colors lg:w-full lg:border-transparent",
        actif ? "border-accent/30 bg-accent-doux font-semibold text-accent" : "border-line bg-panel text-ink-2 hover:bg-panel-2 lg:bg-transparent",
      )}
    >
      <span className="truncate">{nom}</span>
      <span className={cx("rounded-full px-2 py-0.5 text-[12px] tabular-nums", actif ? "bg-panel text-accent" : "bg-panel-2 text-muted")}>{n}</span>
    </button>
  );
}

/** Carte du trombinoscope : photo, nom, poste, courriel, téléphone, contrat et état. */
function CarteSalarie({ e, plusieurs }: { e: EmployeeRow; plusieurs: boolean }) {
  return (
    <Link
      href={`/rh/salaries/${e.id}`}
      className="flex h-full gap-3.5 rounded-2xl border border-line bg-panel p-3.5 transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--ombre-flottante)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-vif"
    >
      <PhotoSalarie chemin={cheminPhoto(e.id, e.photo)} nom={e.name} taille="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{e.name}</p>
        <p className="truncate text-[13px] text-ink-2">{e.job_title ?? "Poste à préciser"}</p>
        <p className="mt-1 truncate text-[12.5px] text-muted">{e.email ?? "Courriel non renseigné"}</p>
        <p className="truncate text-[12.5px] text-muted">{e.phone ?? "Téléphone non renseigné"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{CONTRACT_LABELS[e.contract_type]}</Badge>
          {e.state !== "actif" && <EtatSalarie state={e.state} />}
          {e.absent_today && <Badge tone="neutral">Absent</Badge>}
          {e.to_complete && (
            <span title={`Manque pour la paie : ${e.payroll_missing.join(", ").toLowerCase()}`}>
              <Badge tone="warn">À compléter</Badge>
            </span>
          )}
          {plusieurs && <PastilleSociete company={e.company} />}
        </div>
      </div>
    </Link>
  );
}

function ListeTableau({ lignes, plusieurs, vide, onOuvrir }: { lignes: EmployeeRow[]; plusieurs: boolean; vide: string; onOuvrir: (e: EmployeeRow) => void }) {
  return (
    <DataTable
      rows={lignes}
      rowKey={(e) => e.id}
      onRowClick={onOuvrir}
      empty={vide}
      columns={[
        { key: "matricule", label: "Matricule", render: (e) => <span className="font-mono text-xs">{e.matricule}</span>, sortValue: (e) => e.matricule },
        {
          key: "name",
          label: "Salarié",
          sortValue: (e) => e.name,
          render: (e) => (
            <Link href={`/rh/salaries/${e.id}`} className="flex min-w-0 items-center gap-2.5" onClick={(ev) => ev.stopPropagation()}>
              <PhotoSalarie chemin={cheminPhoto(e.id, e.photo)} nom={e.name} taille="sm" />
              <span className="min-w-0">
                <span className="block font-medium text-ink hover:underline">{e.name}</span>
                <span className="block text-[12.5px] text-muted">{[e.job_title, e.department?.name].filter(Boolean).join(", ") || "–"}</span>
              </span>
            </Link>
          ),
        },
        ...(plusieurs ? [{ key: "company", label: "Société", render: (e: EmployeeRow) => <PastilleSociete company={e.company} />, sortValue: (e: EmployeeRow) => e.company.name }] : []),
        { key: "contract_type", label: "Contrat", render: (e) => CONTRACT_LABELS[e.contract_type], sortValue: (e) => e.contract_type },
        { key: "hire_date", label: "Embauche", render: (e) => fmtDate(e.hire_date), sortValue: (e) => e.hire_date ?? "" },
        { key: "monthly_gross", label: "Brut mensuel", align: "right", render: (e) => fmtGNF(e.monthly_gross), sortValue: (e) => e.monthly_gross },
        { key: "leave_balance", label: "Congés", align: "right", render: (e) => <span className={e.leave_balance < 0 ? "text-danger" : ""}>{jours(e.leave_balance)}</span>, sortValue: (e) => e.leave_balance },
        {
          key: "state",
          label: "État",
          sortValue: (e) => e.state,
          render: (e) => (
            <span className="flex flex-wrap items-center gap-1.5">
              <EtatSalarie state={e.state} />
              {e.absent_today && <Badge tone="accent">Absent</Badge>}
              {e.to_complete && (
                <span title={`Manque pour la paie : ${e.payroll_missing.join(", ").toLowerCase()}`}>
                  <Badge tone="warn">Fiche à compléter</Badge>
                </span>
              )}
              {e.issues.length > 0 && (
                <span title={e.issues.join("\n")}>
                  <Badge tone="warn">{e.issues.length} à compléter</Badge>
                </span>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}
