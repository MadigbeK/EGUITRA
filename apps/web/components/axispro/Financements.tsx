"use client";

import Link from "next/link";
import { useState } from "react";
import { Calendar, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Etat, FEUILLE, Field, Input, Kpi, Notice, ProgressBar, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { apiSend, useApi } from "@/lib/api-client";
import { FUNDING_STATE, INSTRUMENTS, type Currency, type FinancementDevise, type FundingState } from "@/lib/axispro-types";
import { AIDE_NOMBRE, aujourdhui, fmtDate, fmtInt, fmtPct, lireNombre, nombreIllisible, pluriel } from "@/lib/format";
import { CelluleChoix, CelluleDate, CelluleNombre, CelluleTexte, RetourFlottant, borne, devisesOrdonnees, entier, montantDevise, montantsParDevise, totauxParDevise, type Refus } from "./cellules";
import { LectureSeuleCabinet, messageErreur, useCabinet, useRetour } from "./dossier/commun";

const EN_COURS: FundingState[] = ["identified", "submitted", "review", "agreed"];
const OBTENUS: FundingState[] = ["signed", "disbursed"];
/** Démarches affichées au plus (la route en sert 500 par défaut). */
const LIMITE = 500;
const POSITIF = borne(0, undefined, "Montant");
const TAUX = borne(0, 100, "Taux");
const MOIS = (n: number) => entier(n) ?? borne(0, 600, "Durée en mois")(n);

/** Envoi d'une commande : rend vrai s'il a réussi (faux en cas d'échec ou de second clic ignoré). */
type Envoi = (cle: string, fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

const montantUtile = (f: FinancementDevise) => (OBTENUS.includes(f.state) ? f.amount_granted : f.amount_requested);

/**
 * Financements recherchés : ceux d'un dossier (dossierId) ou tout le portefeuille, par étape. Les montants
 * d'une démarche sont dans la devise de son dossier (`devise` pour un dossier, à défaut celle que sert le
 * noyau) ; le portefeuille les totalise devise par devise, sans jamais les additionner. Écriture réservée
 * au profil cabinet (POST /axispro/dossiers/<id>/fundings, PATCH et DELETE /axispro/fundings/<id>) ; la
 * direction et l'administration lisent. `onChanged` est appelé après chaque écriture réussie.
 */
export function Financements({ dossierId, besoin, devise, onChanged }: { dossierId?: number; besoin?: number; devise?: string | null; onChanged?: () => void }) {
  const { data, error, mutate } = useApi<FinancementDevise[]>(dossierId ? `/axispro/fundings?dossier_id=${dossierId}&limit=${LIMITE}` : `/axispro/fundings?limit=${LIMITE}`);
  // Devise de la société en tête des totaux du portefeuille.
  const { data: devises } = useApi<Currency[]>(dossierId ? null : "/axispro/currencies");
  const { cabinet } = useCabinet();
  const { envoyer, enCours, occupe, retour, setRetour } = useRetour();

  const envoi: Envoi = async (cle, fn, ok) => {
    const fait = await envoyer(async () => {
      await fn();
      return true as const;
    }, ok, cle);
    if (!fait) return false;
    await mutate();
    onChanged?.();
    return true;
  };
  /** Changement sur place (montant, taux, étape, relance) : le motif d'un refus, ou null. */
  async function enregistrer(id: number, valeurs: Record<string, unknown>): Promise<Refus> {
    try {
      await apiSend("PATCH", `/axispro/fundings/${id}`, valeurs);
      await mutate();
      onChanged?.();
      return null;
    } catch (e) {
      void mutate();
      return messageErreur(e, "Enregistrement impossible.");
    }
  }

  if (!data) return <Etat error={error} onRetry={() => void mutate()} label="Chargement des financements…" />;
  const monnaie = devise ?? data.find((f) => f.currency)?.currency ?? null;
  const principale = dossierId ? monnaie : (devises?.[0]?.name ?? null);
  const actifs = data.filter((f) => f.state !== "rejected" && f.state !== "withdrawn");
  const obtenus = data.filter((f) => OBTENUS.includes(f.state));
  const sollicite = totauxParDevise(actifs, (f) => f.currency, (f) => f.amount_requested);
  const obtenu = totauxParDevise(obtenus, (f) => f.currency, (f) => f.amount_granted);
  const relances = data.filter((f) => EN_COURS.includes(f.state) && f.next_date).sort((a, b) => (a.next_date ?? "").localeCompare(b.next_date ?? ""));
  const jour = aujourdhui();
  // Dossier : ses démarches sont dans sa devise, comme son besoin.
  const obtenuDossier = Object.values(obtenu).reduce((s, v) => s + v, 0);
  const uneDevise = Object.keys({ ...sollicite, ...obtenu }).length <= 1;
  const taux = devisesOrdonnees(sollicite, principale)
    .filter((d) => sollicite[d])
    .map((d) => ({ devise: d, valeur: ((obtenu[d] ?? 0) / sollicite[d]!) * 100 }));

  return (
    <div className="space-y-6">
      {error && <ErrorBox titre="Rechargement impossible : les démarches affichées peuvent dater." error={error} onRetry={() => void mutate()} />}
      <LectureSeuleCabinet>Lecture seule : votre profil consulte les démarches de financement. Seul le profil cabinet les tient à jour.</LectureSeuleCabinet>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {besoin !== undefined ? (
          <Kpi label="Besoin de financement" value={montantDevise(besoin, monnaie)} hint="Annoncé à l'ouverture du dossier" />
        ) : (
          <Kpi label="Démarches en cours" value={fmtInt(data.filter((f) => EN_COURS.includes(f.state)).length)} />
        )}
        <Kpi label="Montant sollicité" value={montantsParDevise(sollicite, principale, montantDevise(0, monnaie))} hint={pluriel(actifs.length, "démarche active", "démarches actives")} />
        <Kpi label="Montant obtenu" value={montantsParDevise(obtenu, principale, montantDevise(0, monnaie))} tone={obtenus.length ? "ok" : "neutral"} hint="Conventions signées et décaissements" />
        {besoin !== undefined ? (
          <Kpi label="Couverture du besoin" value={besoin && uneDevise ? fmtPct((obtenuDossier / besoin) * 100, 0) : "–"} />
        ) : (
          <Kpi label="Taux d'obtention" value={taux[0] ? fmtPct(taux[0].valeur, 0) : "–"} hint={taux.length > 1 ? taux.map((t) => `${t.devise} ${fmtPct(t.valeur, 0)}`).join(", ") : taux[0] ? `Montants en ${taux[0].devise}` : undefined} />
        )}
      </div>
      {besoin && uneDevise ? (
        <div>
          <div className="mb-1 flex justify-between text-[12.5px] text-muted">
            <span>Obtenu sur besoin</span>
            <span className="tabular">{montantDevise(obtenuDossier, monnaie)} / {montantDevise(besoin, monnaie)}</span>
          </div>
          <ProgressBar value={Math.min(100, (obtenuDossier / besoin) * 100)} tone={obtenuDossier >= besoin ? "ok" : "accent"} />
        </div>
      ) : null}

      {!dossierId && <Pipeline data={data} principale={principale} />}

      {relances.length > 0 && (
        <Card title="Prochaines relances">
          <ul className="space-y-1.5 text-[13.5px]">
            {relances.slice(0, 8).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cx("inline-flex items-center gap-1.5 font-semibold tabular", (f.next_date ?? "") < jour ? "text-danger" : "text-ink")}>
                  <Calendar className="h-3.5 w-3.5" /> {fmtDate(f.next_date)}
                </span>
                <span className="text-ink-2">{f.funder.name}</span>
                {f.dossier && (
                  <Link href={`/axispro/dossiers/${f.dossier.id}`} className="text-[12.5px] font-semibold text-accent hover:underline">
                    {f.dossier.reference}
                  </Link>
                )}
                <span className="text-muted">{f.next_step ?? FUNDING_STATE[f.state].label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.length >= LIMITE && <Notice tone="warn">Les {fmtInt(LIMITE)} premières démarches sont affichées, et les totaux portent sur elles seules.</Notice>}
      <Card title={dossierId ? "Démarches auprès des financeurs" : "Toutes les démarches"} padded={false}>
        {data.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Aucune démarche de financement.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((f) => (
              <LigneFinancement key={f.id} f={f} global={!dossierId} envoi={envoi} enregistrer={enregistrer} enCours={enCours} occupe={occupe} ecriture={cabinet} />
            ))}
          </ul>
        )}
      </Card>

      {dossierId && cabinet && <NouveauFinancement devise={monnaie} occupe={occupe} enCours={enCours === "creer"} onCreate={(v) => envoi("creer", () => apiSend("POST", `/axispro/dossiers/${dossierId}/fundings`, v), "Démarche enregistrée.")} />}
      <RetourFlottant retour={retour} setRetour={setRetour} />
    </div>
  );
}

function Pipeline({ data, principale }: { data: FinancementDevise[]; principale: string | null }) {
  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3 px-1">
        {(Object.keys(FUNDING_STATE) as FundingState[]).map((etat) => {
          const items = data.filter((f) => f.state === etat);
          const totaux = totauxParDevise(items, (f) => f.currency, montantUtile);
          return (
            <section key={etat} className="w-[210px] flex-none rounded-2xl bg-panel-3/70 p-2.5">
              <header className="px-1 pb-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-ink">{FUNDING_STATE[etat].label}</h2>
                  <span className="rounded-full bg-panel px-2 py-0.5 text-[12px] font-bold tabular text-ink-2">{items.length}</span>
                </div>
                <div className="text-[12px] tabular text-muted">{montantsParDevise(totaux, principale, "Aucun montant")}</div>
              </header>
              <div className="space-y-2">
                {items.map((f) => (
                  <Link key={f.id} href={f.dossier ? `/axispro/dossiers/${f.dossier.id}` : "#"} className={cx(FEUILLE, "n-levable block p-2.5 text-[12.5px]")}>
                    <div className="font-semibold text-ink">{f.funder.name}</div>
                    <div className="truncate text-muted">{f.dossier ? `${f.dossier.reference} ${f.dossier.name}` : ""}</div>
                    <div className="mt-1 flex justify-between gap-2 tabular">
                      <span>{INSTRUMENTS[f.instrument] ?? f.instrument}</span>
                      <span className="whitespace-nowrap font-semibold">{montantDevise(montantUtile(f), f.currency)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Démarche auprès d'un financeur : modifiable sur place par le cabinet, figée pour les autres profils. */
function LigneFinancement({ f, global, envoi, enregistrer, enCours, occupe, ecriture }: { f: FinancementDevise; global: boolean; envoi: Envoi; enregistrer: (id: number, valeurs: Record<string, unknown>) => Promise<Refus>; enCours: string | null; occupe: boolean; ecriture: boolean }) {
  const patch = (v: Record<string, unknown>) => enregistrer(f.id, v);
  const etats = Object.fromEntries((Object.keys(FUNDING_STATE) as FundingState[]).map((k) => [k, FUNDING_STATE[k].label]));
  const unite = f.currency ? ` (${f.currency})` : "";
  async function supprimer() {
    if (occupe) return;
    if (await demanderConfirmation(`Supprimer la démarche auprès de ${f.funder.name} ? Son historique (dépôt, décision, relances) est perdu.`, { action: "Supprimer", danger: true })) {
      void envoi(`suppression-${f.id}`, () => apiSend("DELETE", `/axispro/fundings/${f.id}`), "Démarche supprimée.");
    }
  }
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{f.funder.name}</span>
            <Badge tone={FUNDING_STATE[f.state].tone}>{FUNDING_STATE[f.state].label}</Badge>
            <span className="text-[12.5px] text-muted">{INSTRUMENTS[f.instrument] ?? f.instrument}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {global && f.dossier && (
              <>
                <Link href={`/axispro/dossiers/${f.dossier.id}`} className="font-semibold text-accent hover:underline">
                  {f.dossier.reference}
                </Link>{" "}
                {f.dossier.name},{" "}
              </>
            )}
            {f.date_submitted ? `déposé le ${fmtDate(f.date_submitted)}` : "non déposé"}
            {f.date_decision ? `, décision le ${fmtDate(f.date_decision)}` : ""}
            {f.state_date ? `, étape atteinte le ${fmtDate(f.state_date)}` : ""}
          </div>
        </div>
        {ecriture && <CelluleChoix label={`Étape, ${f.funder.name}`} className="w-48" value={f.state} options={etats} onSave={(v) => patch({ state: v })} />}
        {ecriture && !global && (
          <button type="button" aria-label={`Supprimer la démarche ${f.funder.name}`} title="Supprimer" disabled={occupe} aria-busy={enCours === `suppression-${f.id}` || undefined} className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void supprimer()}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <fieldset disabled={!ecriture} className="mt-2.5 min-w-0">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] text-muted md:grid-cols-3 xl:grid-cols-6">
          <label className="block">Sollicité{unite}<CelluleNombre label={`Montant sollicité${unite}`} className="mt-0.5 w-full" value={f.amount_requested} controle={POSITIF} onSave={(v) => patch({ amount_requested: v })} /></label>
          <label className="block">Accordé{unite}<CelluleNombre label={`Montant accordé${unite}`} className="mt-0.5 w-full" value={f.amount_granted} controle={POSITIF} onSave={(v) => patch({ amount_granted: v })} /></label>
          <label className="block">Taux (%)<CelluleNombre label="Taux" className="mt-0.5 w-full" value={f.rate ?? 0} controle={TAUX} onSave={(v) => patch({ rate: v })} /></label>
          <label className="block">Durée (mois)<CelluleNombre label="Durée en mois" className="mt-0.5 w-full" value={f.duration_months ?? 0} controle={MOIS} onSave={(v) => patch({ duration_months: v })} /></label>
          <label className="block">Prochaine étape<CelluleTexte label="Prochaine étape" className="mt-0.5 w-full" value={f.next_step ?? ""} onSave={(v) => patch({ next_step: v })} /></label>
          <label className="block">Relance le<CelluleDate label="Date de relance" className="mt-0.5 w-full" value={f.next_date} onSave={(v) => patch({ next_date: v })} /></label>
        </div>
      </fieldset>
      {f.conditions && <p className="mt-2 text-[13px] text-ink-2"><b>Conditions et garanties :</b> {f.conditions}</p>}
    </li>
  );
}

/** Nombre facultatif d'un champ : vide → 0 (non renseigné), illisible → null (envoi bloqué). */
function lu(v: string): number | null {
  return v.trim() ? lireNombre(v) : 0;
}

function NouveauFinancement({ devise, occupe, enCours, onCreate }: { devise: string | null; occupe: boolean; enCours: boolean; onCreate: (v: Record<string, unknown>) => Promise<boolean> }) {
  const [financeur, setFinanceur] = useState<{ id: number; name: string } | null>(null);
  const vierge = { instrument: "bank_loan", amount_requested: "", rate: "", duration_months: "", next_step: "", next_date: "", conditions: "" };
  const [f, setF] = useState(vierge);
  const montant = lu(f.amount_requested);
  const taux = lu(f.rate);
  const duree = lu(f.duration_months);
  const erreurMontant = nombreIllisible(f.amount_requested) ? AIDE_NOMBRE : montant !== null ? (POSITIF(montant) ?? undefined) : undefined;
  const erreurTaux = nombreIllisible(f.rate) ? AIDE_NOMBRE : taux !== null ? (TAUX(taux) ?? undefined) : undefined;
  const erreurDuree = nombreIllisible(f.duration_months) ? AIDE_NOMBRE : duree !== null ? (MOIS(duree) ?? undefined) : undefined;
  const bloque = !financeur || montant === null || taux === null || duree === null || !!(erreurMontant || erreurTaux || erreurDuree);
  async function enregistrer() {
    if (bloque) return;
    const fait = await onCreate({ ...f, funder_id: financeur.id, amount_requested: montant, rate: taux, duration_months: duree, next_date: f.next_date || null });
    // Le formulaire ne se vide qu'une fois la démarche enregistrée : un refus garde la saisie à corriger.
    if (fait) {
      setF(vierge);
      setFinanceur(null);
    }
  }
  return (
    <Card title="Nouvelle démarche">
      <fieldset disabled={enCours} className="min-w-0">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Financeur (banque, fonds, investisseur)" className="md:col-span-2">
            <PartnerPicker value={financeur} onChange={setFinanceur} kind="supplier" placeholder="Rechercher ou créer le financeur…" />
          </Field>
          <Field label="Instrument">
            <Select value={f.instrument} onChange={(e) => setF({ ...f, instrument: e.target.value })} options={Object.entries(INSTRUMENTS).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label={devise ? `Montant sollicité (${devise})` : "Montant sollicité (devise du dossier)"} error={erreurMontant}>
            <Input inputMode="decimal" className="tabular" aria-invalid={erreurMontant ? true : undefined} value={f.amount_requested} onChange={(e) => setF({ ...f, amount_requested: e.target.value })} />
          </Field>
          <Field label="Taux (%)" error={erreurTaux}><Input inputMode="decimal" aria-invalid={erreurTaux ? true : undefined} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
          <Field label="Durée (mois)" error={erreurDuree}><Input inputMode="numeric" aria-invalid={erreurDuree ? true : undefined} value={f.duration_months} onChange={(e) => setF({ ...f, duration_months: e.target.value })} /></Field>
          <Field label="Prochaine étape"><Input value={f.next_step} placeholder="Exemple : remise du plan d'affaires" onChange={(e) => setF({ ...f, next_step: e.target.value })} /></Field>
          <Field label="Relance le"><Input type="date" value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></Field>
          <Field label="Conditions et garanties demandées" className="md:col-span-4">
            <Textarea className="min-h-[56px]" value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} />
          </Field>
        </div>
      </fieldset>
      <div className="mt-3 flex justify-end">
        <Button variant="primary" loading={enCours} disabled={occupe || bloque} onClick={() => void enregistrer()}>
          <Plus className="h-4 w-4" /> Enregistrer
        </Button>
      </div>
    </Card>
  );
}
