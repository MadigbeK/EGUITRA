"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "@/components/icons";
import { Button, Card, Empty, Field, Kpi, Notice, PageHeader, Segmented, Select, cx } from "@/components/ui";
import { apiSend } from "@/lib/api-client";
import { INSECABLE, fmtDec, fmtGNF, fmtInt, fmtPct, fmtRatio } from "@/lib/format";
import type { ContractType, Simulation, SimulationInput } from "@/lib/rh-types";
import { ChampMontant, erreurNombre, messageErreur, nombre, useMeta } from "./commun";

type Mode = "brut" | "net";

/**
 * Simulateur de salaire : du salaire de base au net et au coût employeur, ou du net cible au
 * salaire de base (offre d'embauche). Calculé par le moteur de paie du noyau, avec les paramètres
 * de la société de travail ; rien n'est enregistré.
 */
export function SimulateurSalaire() {
  const { data: meta } = useMeta();
  const [mode, setMode] = useState<Mode>("brut");
  const [montant, setMontant] = useState("");
  const [contrat, setContrat] = useState<ContractType>("cdi");
  const [lignes, setLignes] = useState<Array<{ rubric_id: string; valeur: string }>>([]);
  const [resultat, setResultat] = useState<Simulation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [calcul, setCalcul] = useState(false);
  const rubriques = (meta?.rubrics ?? []).filter((r) => r.active && !r.system && r.kind === "gain");
  const valeur = nombre(montant);
  const cle = JSON.stringify([mode, valeur, contrat, lignes]);

  useEffect(() => {
    if (valeur <= 0) {
      setResultat(null);
      setErreur(null);
      return;
    }
    let abandon = false;
    const t = window.setTimeout(() => {
      setCalcul(true);
      const fixed_lines = lignes
        .filter((l) => l.rubric_id && nombre(l.valeur) > 0)
        .map((l) => (rubriques.find((r) => String(r.id) === l.rubric_id)?.input === "hours" ? { rubric_id: Number(l.rubric_id), quantity: nombre(l.valeur) } : { rubric_id: Number(l.rubric_id), amount: nombre(l.valeur) }));
      const body: SimulationInput = { contract_type: contrat, fixed_lines, ...(mode === "brut" ? { base_salary: valeur } : { net_target: valeur }) };
      apiSend<Simulation>("POST", "/rh/simulate", body)
        .then((r) => {
          if (abandon) return;
          setResultat(r);
          setErreur(null);
        })
        .catch((e) => !abandon && setErreur(messageErreur(e)))
        .finally(() => !abandon && setCalcul(false));
    }, 350);
    return () => {
      abandon = true;
      window.clearTimeout(t);
    };
    // La clé résume les champs (mode, montant, contrat, éléments) : un seul calcul par saisie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  return (
    <div>
      <PageHeader title="Simulateur de salaire" subtitle="Net, cotisations et coût employeur d'un salaire, ou salaire de base à proposer pour un net cible. Paramètres de paie de la société de travail ; rien n'est enregistré." />
      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-5" title="Hypothèses">
          <div className="space-y-4">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { key: "brut", label: "Du salaire de base au net" },
                { key: "net", label: "Du net au salaire de base" },
              ]}
            />
            <Field label={mode === "brut" ? "Salaire de base mensuel (GNF)" : "Net à payer souhaité (GNF)"} error={erreurNombre(montant)}>
              <ChampMontant value={montant} onChange={setMontant} placeholder="Par exemple 4 500 000" />
            </Field>
            <Field label="Type de contrat" hint="Stage et apprentissage : ni CNSS ni VF (dans les limites légales)">
              <Select value={contrat} onChange={(e) => setContrat(e.target.value as ContractType)} options={(meta?.contract_types ?? [{ code: "cdi", label: "CDI" }]).map((c) => ({ value: c.code, label: c.label }))} />
            </Field>
            <div>
              <div className="mb-2 text-[13px] font-medium text-ink-2">Primes et indemnités fixes</div>
              <div className="space-y-2">
                {lignes.map((l, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_9rem_auto] gap-2">
                    <Select value={l.rubric_id} placeholder="Rubrique" onChange={(e) => setLignes(lignes.map((x, j) => (j === i ? { ...x, rubric_id: e.target.value } : x)))} options={rubriques.map((r) => ({ value: r.id, label: r.name }))} />
                    <ChampMontant value={l.valeur} placeholder={rubriques.find((r) => String(r.id) === l.rubric_id)?.input === "hours" ? "heures" : "GNF"} onChange={(v) => setLignes(lignes.map((x, j) => (j === i ? { ...x, valeur: v } : x)))} />
                    <Button variant="ghost" aria-label="Retirer" onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" onClick={() => setLignes([...lignes, { rubric_id: "", valeur: "" }])}>
                  <Plus className="h-3.5 w-3.5" /> Ajouter une prime ou indemnité
                </Button>
              </div>
            </div>
          </div>
        </Card>
        <div className={cx("space-y-6 xl:col-span-7", calcul && "opacity-70 transition-opacity")}>
          {erreur && <Notice tone="danger">{erreur}</Notice>}
          {!resultat ? (
            <Card>
              <Empty title="Saisissez un montant" hint="Le calcul se fait à mesure de la saisie, avec le barème de la RTS, les taux de la CNSS et des taxes sur salaires paramétrés." />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Kpi label={mode === "net" ? "Salaire de base à proposer" : "Salaire brut"} value={fmtGNF(mode === "net" ? resultat.base_salary : resultat.gross)} hint={mode === "net" ? `Brut ${fmtGNF(resultat.gross)}` : undefined} />
                <Kpi label="Net à payer" value={fmtGNF(resultat.net)} tone="ok" hint={resultat.gross ? `${fmtPct((resultat.net / resultat.gross) * 100, 0)} du brut` : undefined} />
                <Kpi label="Coût employeur" value={fmtGNF(resultat.employer_cost)} tone="accent" hint={resultat.gross ? `${fmtRatio(resultat.employer_cost / resultat.gross)} fois le brut` : undefined} />
              </div>
              <Card title="Détail du calcul">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[12.5px] text-muted">
                      <th className="py-2 font-medium">Rubrique</th>
                      <th className="py-2 text-right font-medium">Base</th>
                      <th className="py-2 text-right font-medium">Taux</th>
                      <th className="py-2 text-right font-medium">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultat.lines.map((l, i) => (
                      <tr key={i} className={cx("border-b border-line/60", l.kind === "employer" && "text-muted", l.kind === "info" && "text-muted italic")}>
                        <td className="py-1.5">
                          {l.name}
                          {l.kind === "deduction" && <span className="text-muted"> (retenue)</span>}
                          {l.kind === "employer" && <span> (employeur)</span>}
                        </td>
                        <td className="py-1.5 text-right font-mono tabular">{l.base !== null ? fmtInt(l.base) : ""}</td>
                        <td className="py-1.5 text-right font-mono tabular">{l.rate !== null ? `${fmtDec(l.rate)}${INSECABLE}%` : l.quantity !== null ? fmtDec(l.quantity) : ""}</td>
                        <td className={cx("py-1.5 text-right font-mono tabular", l.kind === "deduction" && "text-danger")}>{l.kind === "deduction" ? `− ${fmtInt(l.amount)}` : fmtInt(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <Ligne label="Assiette CNSS" value={fmtGNF(resultat.cnss_base)} />
                  <Ligne label="CNSS salarié / employeur" value={`${fmtGNF(resultat.cnss_employee)} / ${fmtGNF(resultat.cnss_employer)}`} />
                  <Ligne label="Brut imposable" value={fmtGNF(resultat.taxable_base)} />
                  <Ligne label="Base de la RTS" value={fmtGNF(resultat.rts_base)} />
                  <Ligne label="RTS" value={fmtGNF(resultat.rts)} />
                  <Ligne label="Taux marginal de RTS" value={fmtPct(resultat.marginal_rate, 0)} />
                  <Ligne label="Versement forfaitaire" value={fmtGNF(resultat.vf)} />
                  <Ligne label="Taxe de formation" value={fmtGNF(resultat.training_tax)} />
                </dl>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Ligne({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 rounded-lg bg-panel-2 px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular text-ink">{value}</dd>
    </div>
  );
}
