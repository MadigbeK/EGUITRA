"use client";

import { useState } from "react";
import { CheckCircle2, Lock, LockOpen, Plus, ShieldAlert, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Notice, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { MoveDetailModal } from "@/components/finance/MoveDetailModal";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi, useAutorise, useSaisieLibre } from "@/lib/api-client";
import { MOVE_STATES } from "@/lib/finance-types";
import { AIDE_NOMBRE, MONTHS_FR, fmtDate, fmtDateTime, fmtGNF, lireNombre, nombreIllisible } from "@/lib/format";
import type { Profile } from "@/lib/types";

// Profils des routes du noyau (addons/eguitra_finance/controllers/closing.py) : l'OD d'affectation est une
// écriture de la finance (avec le droit « Saisie libre des comptes ») ; le verrouillage définitif revient,
// comme la réouverture d'un mois, à la direction et à l'administration.
const AFFECTATION: Profile[] = ["admin", "finance"];
const VERROUILLAGE: Profile[] = ["admin", "direction"];

interface Controle { code: string; label: string; detail: string; count: number | null }
interface MoisExercice { period: string; state: "open" | "closed"; closed_at: string | null; closed_by: string | null }
interface CompteAffectation { id: number; code: string; name: string; group: "legal_reserve" | "reserves" | "retained_earnings" | "dividends"; label: string }
interface OdAffectation {
  id: number;
  name: string | null;
  ref: string | null;
  date: string;
  state: "draft" | "posted";
  amount: number;
  approval: { state: string; pending_with: string | null } | null;
  lines: Array<{ account: { id: number; code: string; name: string }; label: string | null; debit: number; credit: number }>;
}
interface Exercice {
  company: string;
  year: number;
  fiscal_year: { start: string; end: string };
  months: MoisExercice[];
  months_closed: number;
  result: number;
  allocated: { posted: number; draft: number };
  to_allocate: number;
  previous_unallocated: number;
  allocations: OdAffectation[];
  allocation_accounts: CompteAffectation[];
  unaffected_account: { id: number; code: string; name: string } | null;
  allocation: { can_allocate: boolean; blocking: Controle[] };
  hard_lock_date: string | null;
  locked: boolean;
  lock: { can_lock: boolean; blocking: Controle[] };
  events: Array<{ action: string; user: string; date: string; reason: string | null }>;
}

/** Ce que le verrouillage définitif exige, dans l'ordre où le noyau le contrôle. */
const CONDITIONS = [
  { code: "year_running", label: "Exercice terminé" },
  { code: "months_open", label: "Douze mois clôturés" },
  { code: "draft_moves", label: "Aucune pièce en brouillon jusqu'à la fin de l'exercice" },
];

/**
 * Clôture de l'exercice : état des douze mois, résultat et son affectation décidée par l'assemblée (OD en
 * brouillon qui suit ensuite le circuit des OD), verrouillage définitif. L'exercice suivant s'ouvre sans
 * écriture : le résultat non affecté figure au bilan en report à nouveau.
 */
export function ClotureExercice({ year }: { year: number }) {
  const { data, error, mutate } = useApi<Exercice>(`/finance/closing/year?year=${year}`);
  const affecter = useAutorise(AFFECTATION);
  const libre = useSaisieLibre(affecter);
  const verrouiller = useAutorise(VERROUILLAGE);
  const [piece, setPiece] = useState<number | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function verrouillerExercice(exercice: Exercice) {
    const fin = fmtDate(exercice.fiscal_year.end);
    const question =
      `Verrouiller définitivement l'exercice ${exercice.year} ? Cette opération est irréversible : aucune écriture ne pourra plus être passée, modifiée ou supprimée jusqu'au ${fin}, ` +
      "même par l'administration, et aucun mois de l'exercice ne pourra plus être rouvert. L'affectation du résultat reste possible : elle se passe à la date de l'assemblée, dans l'exercice suivant.";
    if (!(await demanderConfirmation(question, { action: "Verrouiller définitivement", danger: true }))) return;
    setEnvoi(true);
    setMessage(null);
    try {
      await apiSend("POST", "/finance/closing/year/lock", { year: exercice.year });
      setMessage({ tone: "ok", text: `Exercice ${exercice.year} verrouillé définitivement au ${fin}.` });
      await mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Verrouillage impossible." });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Card
      className="mt-6"
      title={`Clôture de l'exercice ${year}`}
      actions={data && <Badge tone={data.locked ? "ok" : "neutral"}>{data.locked ? "Verrouillé définitivement" : "Non verrouillé"}</Badge>}
    >
      {!data ? (
        <Etat error={error} onRetry={() => mutate()} label="Chargement de l'exercice…" />
      ) : (
        <div className="space-y-6">
          <p className="text-sm leading-relaxed text-muted">
            Exercice du {fmtDate(data.fiscal_year.start)} au {fmtDate(data.fiscal_year.end)}, {data.company}. L&apos;exercice suivant s&apos;ouvre sans écriture : le résultat non affecté figure au bilan en report à nouveau
            jusqu&apos;à l&apos;OD d&apos;affectation décidée par l&apos;assemblée. Une fois les douze mois clôturés, la direction verrouille définitivement l&apos;exercice.
          </p>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <DouzeMois months={data.months} />
          <Chiffres data={data} />
          {data.previous_unallocated !== 0 && (
            <Notice tone="warn">
              Résultat d&apos;exercices antérieurs à {data.year} non encore affecté : {fmtGNF(data.previous_unallocated)}. Il figure au bilan en report à nouveau ; passez son OD d&apos;affectation depuis l&apos;exercice concerné.
            </Notice>
          )}
          <Affectation
            data={data}
            affecter={affecter}
            libre={libre}
            onOuvrir={setPiece}
            onCreee={(texte) => {
              setMessage({ tone: "ok", text: texte });
              void mutate();
            }}
          />
          <Verrouillage data={data} verrouiller={verrouiller} envoi={envoi} onVerrouiller={() => verrouillerExercice(data)} />
        </div>
      )}
      {piece !== null && <MoveDetailModal moveId={piece} onClose={() => setPiece(null)} onChanged={() => void mutate()} />}
    </Card>
  );
}

function DouzeMois({ months }: { months: MoisExercice[] }) {
  return (
    <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-12" aria-label="Les douze mois de l'exercice">
      {months.map((m) => {
        const clos = m.state === "closed";
        const libelle = `${MONTHS_FR[Number(m.period.slice(5, 7)) - 1]} ${m.period.slice(2, 4)}`;
        return (
          <li key={m.period} title={clos ? `Clôturé le ${fmtDateTime(m.closed_at)}${m.closed_by ? ` par ${m.closed_by}` : ""}` : "Ouvert"} className={cx("flex items-center justify-between gap-1 rounded-lg px-2.5 py-2 text-xs", clos ? "bg-ok/[0.08] text-ink" : "bg-panel-2 text-muted")}>
            <span className="font-semibold capitalize">{libelle}</span>
            {clos ? <Lock className="h-3.5 w-3.5 text-ok" aria-label="clôturé" /> : <LockOpen className="h-3.5 w-3.5" aria-label="ouvert" />}
          </li>
        );
      })}
    </ul>
  );
}

function Chiffres({ data }: { data: Exercice }) {
  const perte = data.result < 0;
  const lignes: Array<[string, string]> = [
    ["Mois clôturés", `${data.months_closed}/12`],
    [perte ? "Résultat de l'exercice (perte)" : "Résultat de l'exercice", fmtGNF(data.result)],
    ["Affecté (OD validées)", fmtGNF(Math.abs(data.allocated.posted))],
    ["OD en brouillon", fmtGNF(Math.abs(data.allocated.draft))],
    ["Restant à affecter", fmtGNF(Math.abs(data.to_allocate))],
    ["Verrouillage définitif", data.hard_lock_date ? `jusqu'au ${fmtDate(data.hard_lock_date)}` : "aucun"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 xl:grid-cols-3">
      {lignes.map(([label, valeur]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1">
          <dt className="text-muted">{label}</dt>
          <dd className="text-right font-mono text-ink">{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

function Affectation({ data, affecter, libre, onOuvrir, onCreee }: { data: Exercice; affecter: boolean; libre: boolean; onOuvrir: (id: number) => void; onCreee: (texte: string) => void }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[15px] font-semibold text-ink">Affectation du résultat</h3>
      {data.allocations.length > 0 && (
        <>
          <DataTable
            dense
            rows={data.allocations}
            rowKey={(a) => a.id}
            onRowClick={(a) => onOuvrir(a.id)}
            columns={[
              { key: "name", label: "Pièce", render: (a) => a.name ?? "Brouillon" },
              { key: "date", label: "Date de l'assemblée", render: (a) => fmtDate(a.date) },
              { key: "lines", label: "Affectation", render: (a) => a.lines.map((l) => `${l.account.code} ${fmtGNF(l.credit || l.debit)}`).join(" ; ") },
              {
                key: "state",
                label: "État",
                render: (a) =>
                  a.approval?.state === "pending" ? <Badge tone="warn">{a.approval.pending_with ? `À approuver (${a.approval.pending_with})` : "À approuver"}</Badge> : <Badge tone={MOVE_STATES[a.state]?.tone ?? "neutral"}>{MOVE_STATES[a.state]?.label ?? a.state}</Badge>,
              },
              { key: "amount", label: "Montant", align: "right", render: (a) => fmtGNF(a.amount) },
            ]}
          />
          <p className="text-xs text-muted">Ouvrez une OD pour la valider (circuit de validation des OD), y joindre le procès-verbal de l&apos;assemblée, ou la supprimer tant qu&apos;elle est en brouillon.</p>
        </>
      )}
      {!data.allocation.can_allocate ? (
        <Notice tone="accent">{data.allocation.blocking.map((c) => c.detail).join(" ")}</Notice>
      ) : !affecter ? (
        <Notice tone="accent">Restant à affecter : {fmtGNF(Math.abs(data.to_allocate))}. L&apos;OD d&apos;affectation décidée par l&apos;assemblée est saisie par la finance.</Notice>
      ) : !libre ? (
        <Notice tone="accent">L&apos;OD d&apos;affectation porte des comptes choisis : elle demande le droit « Saisie libre des comptes » (Administration &gt; Utilisateurs).</Notice>
      ) : (
        <FormulaireAffectation key={`${data.year}-${data.to_allocate}`} data={data} onCreee={onCreee} />
      )}
    </div>
  );
}

interface Ligne { cle: number; account_id: string; name: string; amount: string; partner: { id: number; name: string } | null }

function FormulaireAffectation({ data, onCreee }: { data: Exercice; onCreee: (texte: string) => void }) {
  const perte = data.to_allocate < 0;
  const restant = Math.round(Math.abs(data.to_allocate));
  const comptes = data.allocation_accounts;
  const premier = comptes.find((c) => c.group === (perte ? "retained_earnings" : "legal_reserve")) ?? comptes[0];
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [lignes, setLignes] = useState<Ligne[]>([{ cle: 1, account_id: premier ? String(premier.id) : "", name: "", amount: "", partner: null }]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const compte = (id: string) => comptes.find((c) => String(c.id) === id);
  const montants = lignes.map((l) => lireNombre(l.amount));
  const illisible = lignes.some((l) => nombreIllisible(l.amount));
  const total = montants.reduce<number>((s, m) => s + (m ?? 0), 0);
  const ecart = restant - Math.round(total);
  const complet = lignes.every((l, i) => l.account_id && (montants[i] ?? 0) > 0);
  const pret = Boolean(date) && complet && !illisible && ecart === 0;
  const changer = (cle: number, modif: Partial<Ligne>) => setLignes(lignes.map((l) => (l.cle === cle ? { ...l, ...modif } : l)));

  async function envoyer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await apiSend("POST", "/finance/closing/year/allocation", {
        year: data.year,
        date,
        note,
        lines: lignes.map((l, i) => ({ account_id: Number(l.account_id), amount: montants[i], name: l.name.trim() || undefined, partner_id: l.partner?.id })),
      });
      onCreee(`OD d'affectation du résultat ${data.year} créée en brouillon : ouvrez-la ci-dessus pour la valider (circuit de validation des OD) et y joindre le procès-verbal de l'assemblée.`);
    } catch (e) {
      setErreur(e instanceof ApiError ? e.message : "Création impossible.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl bg-panel-2 p-4">
      <p className="text-sm text-ink-2">
        {perte ? "Perte" : "Bénéfice"} à affecter : <span className="font-mono font-semibold">{fmtGNF(restant)}</span>, en contrepartie du compte {data.unaffected_account ? `${data.unaffected_account.code} ${data.unaffected_account.name}` : "d'affectation du résultat"}
        {perte ? " (imputation sur les réserves ou report à nouveau débiteur, jamais en dividendes)." : " (réserve légale, réserves, report à nouveau, dividendes)."}
      </p>
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Date de l'assemblée" hint={`Après le ${fmtDate(data.fiscal_year.end)}, dans un mois encore ouvert.`}>
          <Input type="date" value={date} min={data.fiscal_year.end} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Décision (facultatif)" hint="Reprise dans la note de la pièce." className="md:col-span-2">
          <Textarea className="min-h-9" rows={1} value={note} placeholder="Assemblée générale ordinaire, résolution n° 2" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-[12.5px] font-medium text-muted">
            <tr>
              <th scope="col" className="px-2 py-1 text-left">Compte</th>
              <th scope="col" className="px-2 py-1 text-left">Libellé</th>
              <th scope="col" className="w-44 px-2 py-1 text-right">Montant (GNF)</th>
              <th scope="col" className="w-8"><span className="sr-only">Supprimer</span></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => {
              const c = compte(l.account_id);
              return (
                <tr key={l.cle} className="align-top">
                  <td className="px-2 py-1">
                    <Select value={l.account_id} placeholder="Compte…" aria-label={`Compte, ligne ${i + 1}`} onChange={(e) => changer(l.cle, { account_id: e.target.value, partner: null })} options={comptes.map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))} />
                    {c?.group === "dividends" && (
                      <div className="mt-1.5">
                        <PartnerPicker kind="supplier" value={l.partner} onChange={(p) => changer(l.cle, { partner: p })} placeholder="Associé bénéficiaire (facultatif)" />
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <Input value={l.name} placeholder={c?.label ?? `Affectation du résultat ${data.year}`} aria-label={`Libellé, ligne ${i + 1}`} onChange={(e) => changer(l.cle, { name: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Input className="text-right font-mono" inputMode="decimal" value={l.amount} aria-label={`Montant, ligne ${i + 1}`} aria-invalid={nombreIllisible(l.amount) || undefined} onChange={(e) => changer(l.cle, { amount: e.target.value })} />
                    {nombreIllisible(l.amount) && <span className="mt-1 block text-[12px] font-medium text-danger">{AIDE_NOMBRE}</span>}
                    {!nombreIllisible(l.amount) && montants[i] !== null && (montants[i] ?? 0) <= 0 && <span className="mt-1 block text-[12px] font-medium text-danger">Montant positif attendu.</span>}
                  </td>
                  <td className="py-2">
                    {lignes.length > 1 && (
                      <button type="button" className="text-muted hover:text-danger" onClick={() => setLignes(lignes.filter((x) => x.cle !== l.cle))} aria-label={`Supprimer la ligne ${i + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={2}>
                <Button variant="ghost" size="sm" onClick={() => setLignes([...lignes, { cle: Math.max(...lignes.map((l) => l.cle)) + 1, account_id: "", name: "", amount: "", partner: null }])}>
                  <Plus className="h-4 w-4" /> Ligne
                </Button>
              </td>
              <td className="px-2 py-2 text-right font-mono">{fmtGNF(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {ecart !== 0 && total > 0 && (
        <Notice tone="warn">
          Le total doit être égal au restant à affecter ({fmtGNF(restant)}) : {ecart > 0 ? `il manque ${fmtGNF(ecart)}` : `${fmtGNF(-ecart)} de trop`}.
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-xs text-muted">L&apos;OD est créée en brouillon, puis validée par le circuit des OD.</span>
        <Button variant="primary" disabled={!pret} loading={envoi} onClick={envoyer}>
          Créer l&apos;OD d&apos;affectation
        </Button>
      </div>
    </div>
  );
}

function Verrouillage({ data, verrouiller, envoi, onVerrouiller }: { data: Exercice; verrouiller: boolean; envoi: boolean; onVerrouiller: () => void }) {
  const evenement = data.events[0];
  return (
    <div className="space-y-3">
      <h3 className="text-[15px] font-semibold text-ink">Verrouillage définitif</h3>
      {data.locked ? (
        <Notice tone="ok">
          Exercice verrouillé définitivement : plus aucune écriture ne peut être passée, modifiée ou supprimée jusqu&apos;au {fmtDate(data.hard_lock_date)}
          {evenement ? `, par ${evenement.user} le ${fmtDateTime(evenement.date)}` : ""}.
        </Notice>
      ) : (
        <>
          <ul className="space-y-2">
            {CONDITIONS.map((condition) => {
              const manque = data.lock.blocking.find((c) => c.code === condition.code);
              const Icone = manque ? ShieldAlert : CheckCircle2;
              return (
                <li key={condition.code} className="flex items-start gap-3 rounded-lg bg-panel-2 px-3 py-2">
                  <Icone className={cx("mt-0.5 h-4 w-4 flex-none", manque ? "text-danger" : "text-ok")} />
                  <div className="flex-1">
                    <div className="text-sm text-ink">{condition.label}</div>
                    {manque && <div className="text-xs text-muted">{manque.detail}</div>}
                  </div>
                  <Badge tone={manque ? "danger" : "ok"}>{manque ? "Manquant" : "Conforme"}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="text-xs leading-relaxed text-muted">
            Le verrouillage définitif est irréversible : il interdit toute écriture jusqu&apos;au {fmtDate(data.fiscal_year.end)} et toute réouverture d&apos;un mois de l&apos;exercice. Il n&apos;empêche pas l&apos;affectation du
            résultat, passée à la date de l&apos;assemblée dans l&apos;exercice suivant.
          </p>
          {verrouiller ? (
            <div className="flex justify-end">
              <Button variant="danger" disabled={!data.lock.can_lock} loading={envoi} onClick={onVerrouiller}>
                <Lock className="h-4 w-4" /> Verrouiller définitivement l&apos;exercice
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">Le verrouillage définitif est réservé à la direction et à l&apos;administration.</p>
          )}
        </>
      )}
    </div>
  );
}
