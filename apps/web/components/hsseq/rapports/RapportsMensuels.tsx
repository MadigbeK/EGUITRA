"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { ArrowUpRight, Download, RotateCcw } from "@/components/icons";
import { Badge, Button, Card, Empty, ErrorBox, Etat, Field, Modal, Notice, PANNEAU, Select, Squelette, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { Tampon, texteErreur, tonHsseq } from "@/components/hsseq/commun";
import { requete, useAdresse } from "@/components/hsseq/actions/outils";
import { apiDownload, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { fmtDate, fmtDateTime, pluriel } from "@/lib/format";
import type { Me } from "@/lib/types";
import { BROUILLON_VIDE, Historique, Indicateurs, Synthese, type Brouillon, type Lecture } from "./Tableaux";
import { aujourdhui, deMois, lireNombre, moisCourt, moisLong } from "./outils";
import type { MonthlyReport, MonthlyReportPatch, ReportMonthItem, ReportMonths, ReportTemplate } from "./types";

/** Profils qui paramètrent les modèles (CONFIG du noyau). */
const PARAMETRAGE = ["admin", "hsseq"] as const;

/** Mois clos : ses valeurs calculées sont figées, ou le 5 du mois suivant est passé. */
const clos = (x: ReportMonthItem) => x.frozen || x.freeze_date <= aujourdhui();

/**
 * Rapport mensuel HSSE au format de chaque donneur d'ordre (lecture : administration, direction,
 * Responsable HSSEQ) : choix du modèle, de la société pour un modèle des deux sociétés, de l'année et
 * du mois (frise des mois et leur état) ; puis le rapport du mois. Choix portés par l'adresse (modele,
 * societe, annee, mois) ; par défaut, le dernier mois clos, celui que l'on complète et valide.
 */
export function RapportsMensuels() {
  const { lire, ecrire } = useAdresse();
  const { data: me } = useApi<Me>("/auth/me");
  const parametrage = useAutorise(PARAMETRAGE);
  const { data: modeles, error: erreurModeles, mutate: muterModeles } = useApi<ReportTemplate[]>("/hsseq/reports/templates");
  const [saisies, setSaisies] = useState(0);

  const modele = modeles?.find((t) => t.id === Number(lire("modele"))) ?? modeles?.[0] ?? null;
  const societes = me?.companies ?? [];
  // Modèle des deux sociétés : la société choisie, sinon celle du compte ; un modèle d'une société la porte.
  const societe = modele && !modele.company ? Number(lire("societe")) || me?.company_id || null : null;
  const pret = Boolean(modele && (modele.company || societe));
  const demande = /^\d{4}-\d{2}$/.test(lire("mois")) ? lire("mois") : "";
  // L'année suit le mois demandé (lien vers un mois d'une autre année), sinon l'année courante.
  const annee = Number(lire("annee")) || Number(demande.slice(0, 4)) || new Date().getFullYear();
  const { data: mois, error: erreurMois, mutate: muterMois } = useApi<ReportMonths>(pret && modele ? `/hsseq/reports?${requete({ template_id: modele.id, year: annee, company_id: societe })}` : null);
  const items = mois?.items ?? [];
  const choisi = items.find((x) => x.month === demande)?.month ?? items.filter(clos).at(-1)?.month ?? items.at(-1)?.month ?? null;

  /** Change de choix ; des saisies non enregistrées se confirment avant d'être abandonnées. */
  async function choisir(maj: Record<string, string | number | null>) {
    if (saisies > 0 && !(await demanderConfirmation(`Abandonner ${pluriel(saisies, "saisie non enregistrée", "saisies non enregistrées")} ?`, { titre: "Saisies non enregistrées", action: "Abandonner", danger: true }))) return;
    setSaisies(0);
    ecrire(maj);
  }

  if (!modeles) {
    return (
      <Card>
        <Etat error={erreurModeles} onRetry={() => void muterModeles()} label="Chargement des modèles de rapport…" />
      </Card>
    );
  }
  if (!modele) {
    return (
      <Card>
        <Empty title="Aucun modèle de rapport en service." hint={parametrage ? "Créez le modèle d'un donneur d'ordre dans les paramètres d'HSSEQ, onglet « Modèles de rapport »." : "L'administration ou le Responsable HSSEQ crée les modèles des donneurs d'ordre."} />
        {parametrage && (
          <div className="flex justify-center pb-6">
            <Link href="/hsseq/parametres?onglet=rapports" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
              Modèles de rapport <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </Card>
    );
  }

  const anneeCourante = new Date().getFullYear();
  return (
    <div className="space-y-5">
      <div role="group" aria-label="Choix du rapport" className="no-print flex flex-wrap items-end gap-3">
        <Field label="Modèle du donneur d'ordre" className="w-full sm:w-[26rem]">
          <Select value={modele.id} onChange={(e) => void choisir({ modele: e.target.value, mois: null, societe: null })} options={modeles.map((t) => ({ value: t.id, label: t.client_label && !t.name.includes(t.client_label) ? `${t.name} (${t.client_label})` : t.name }))} />
        </Field>
        {!modele.company && societes.length > 1 && (
          <Field label="Société" className="w-full sm:w-64">
            <Select value={societe ?? ""} onChange={(e) => void choisir({ societe: e.target.value, mois: null })} options={societes.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
        <Field label="Année" className="w-full sm:w-28">
          <Select value={annee} onChange={(e) => void choisir({ annee: Number(e.target.value) === anneeCourante ? null : e.target.value, mois: null })} options={[...new Set([anneeCourante, anneeCourante - 1, annee])].sort((a, b) => b - a).map((a) => ({ value: a, label: String(a) }))} />
        </Field>
        {parametrage && (
          <Link href={`/hsseq/parametres?onglet=rapports&modele=${modele.id}`} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
            Modifier le modèle <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {erreurMois && !mois && <ErrorBox error={erreurMois} onRetry={() => void muterMois()} />}
      {!mois && !erreurMois && <Squelette className="h-[52px]" />}
      {mois && (
        <FriseMois
          items={items}
          choisi={choisi}
          onChoisir={(m) => {
            if (m !== choisi) void choisir({ mois: m });
          }}
        />
      )}

      {mois && choisi && (
        <Rapport
          key={`${modele.id}|${societe ?? ""}|${choisi}`}
          modele={modele}
          mois={choisi}
          societe={societe}
          onSaisies={setSaisies}
          onTransition={() => void muterMois()}
        />
      )}
      {mois && !choisi && <Empty title="Aucun mois pour cette année." hint="Le rapport d'un mois s'ouvre au premier jour du mois." />}
    </div>
  );
}

/** Frise des mois de l'année : le mois choisi, et l'état de chacun (validé, à valider, en cours). */
function FriseMois({ items, choisi, onChoisir }: { items: ReportMonthItem[]; choisi: string | null; onChoisir: (m: string) => void }) {
  return (
    <div role="group" aria-label="Mois du rapport" className="no-print -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {items.map((x) => {
        const etat = x.state === "validated" ? "Validé" : clos(x) ? "À valider" : "En cours";
        const actif = x.month === choisi;
        return (
          <button
            key={x.month}
            type="button"
            aria-pressed={actif}
            aria-label={`${moisLong(x.month)} : ${etat.toLocaleLowerCase("fr")}`}
            title={x.state === "validated" ? `${moisLong(x.month)} : validé` : clos(x) ? `${moisLong(x.month)} : clos, à valider` : `${moisLong(x.month)} : en cours ; ses valeurs calculées se figent le ${fmtDate(x.freeze_date)}`}
            onClick={() => onChoisir(x.month)}
            className={cx(
              "flex min-w-[4.75rem] flex-none flex-col items-start rounded-[10px] border px-2.5 py-1.5 text-left outline-offset-2 transition-colors",
              actif ? "border-accent bg-accent-doux" : "border-line bg-panel hover:border-line-strong",
            )}
          >
            <span className="text-[13px] font-semibold capitalize text-ink">{moisCourt(x.month)}</span>
            <span className={cx("whitespace-nowrap text-[11.5px] font-medium", etat === "À valider" ? "text-warn" : etat === "Validé" ? "text-ink-2" : "text-muted")}>{etat}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Rapport d'un mois : en-tête (donneur d'ordre, société, période, état, valeurs figées ou provisoires),
 * exports Excel et PDF, validation et réouverture selon `transitions`, synthèse du comité, indicateurs
 * avec la saisie des valeurs et des commentaires (rights.can_edit), commentaire du mois et journal. Les
 * saisies s'envoient ensemble, seulement celles qui changent.
 */
function Rapport({ modele, mois, societe, onSaisies, onTransition }: { modele: ReportTemplate; mois: string; societe: number | null; onSaisies: (n: number) => void; onTransition: () => void }) {
  const chemin = `/hsseq/reports/${modele.id}/${mois}`;
  const qs = societe ? `?company_id=${societe}` : "";
  const { data: r, error, mutate } = useApi<MonthlyReport>(`${chemin}${qs}`);
  const { mutate: muterCles } = useSWRConfig();
  const [b, setB] = useState<Brouillon>(BROUILLON_VIDE);
  const [lecture, setLecture] = useState<Lecture>("cumul");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [reouvrir, setReouvrir] = useState(false);

  const corps = r ? patch(r, b) : null;
  const nbSaisies = corps ? (corps.values?.length ?? 0) + (corps.comment !== undefined ? 1 : 0) : 0;
  const illisibles = r ? r.indicators.filter((i) => i.mode === "manual" && (b.valeurs[i.id] ?? "").trim() !== "" && lireNombre(b.valeurs[i.id] ?? "") === null) : [];
  useEffect(() => onSaisies(nbSaisies), [nbSaisies, onSaisies]);
  // Saisies non enregistrées : le navigateur demande avant de quitter la page.
  useEffect(() => {
    if (!nbSaisies) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [nbSaisies]);

  if (!r) {
    return (
      <Card>
        <Etat error={error} onRetry={() => void mutate()} label="Calcul du rapport du mois…" />
      </Card>
    );
  }

  const client = r.template.client_label || r.template.partner?.name || r.template.name;
  const aSaisir = r.indicators.filter((i) => i.mode === "manual" && i.value === null && i.target !== null);
  const textes = { month_not_frozen: `Les valeurs ${deMois(r.month)} se figent le ${fmtDate(r.freeze_date)} : la validation s'ouvre à cette date.` };

  /** Envoi d'une écriture ; la réponse est le rapport à jour, la frise des mois se relit. */
  async function envoyer(cle: string, appel: () => Promise<MonthlyReport>, texte: string, apres?: () => void) {
    setOccupe(cle);
    setMessage(null);
    try {
      const maj = await appel();
      await mutate(maj, { revalidate: false });
      void muterCles((k) => typeof k === "string" && k.startsWith("/hsseq/reports?"));
      setB(BROUILLON_VIDE);
      setMessage({ tone: "ok", text: texte });
      apres?.();
      return true;
    } catch (e) {
      setMessage({ tone: "danger", text: texteErreur(e, textes, "L'opération n'a pas abouti.") });
      return false;
    } finally {
      setOccupe(null);
    }
  }

  const avecSociete = <T extends object>(c: T): T => (societe ? { ...c, company_id: societe } : c);
  function enregistrer() {
    if (corps) void envoyer("enregistrer", () => apiSend<MonthlyReport>("PATCH", chemin, avecSociete(corps)), "Saisies enregistrées.");
  }

  /** Réouverture : l'erreur éventuelle reste dans la fenêtre du motif. */
  async function rouvrir(reason: string): Promise<string | null> {
    if (!r) return null;
    try {
      const maj = await apiSend<MonthlyReport>("POST", `${chemin}/reopen`, avecSociete({ reason }));
      await mutate(maj, { revalidate: false });
      void muterCles((k) => typeof k === "string" && k.startsWith("/hsseq/reports?"));
      setMessage({ tone: "ok", text: `Rapport ${deMois(r.month)} rouvert : il revient en brouillon.` });
      onTransition();
      return null;
    } catch (e) {
      return texteErreur(e, textes, "La réouverture n'a pas abouti.");
    }
  }

  async function valider() {
    if (!r) return;
    const manque = aSaisir.length ? ` ${pluriel(aSaisir.length, "valeur saisie manque", "valeurs saisies manquent")} (${aSaisir.map((i) => i.code).join(", ")}) : elles resteront vides dans le rapport.` : "";
    const ok = await demanderConfirmation(`${r.frozen ? "" : "Les valeurs calculées du mois seront figées. "}Une fois validé, le rapport ne se modifie plus sans réouverture motivée.${manque}`, { titre: `Valider le rapport ${deMois(r.month)}`, action: "Valider le mois" });
    if (ok) await envoyer("validate", () => apiSend<MonthlyReport>("POST", `${chemin}/validate`, avecSociete({})), `Rapport ${deMois(r.month)} validé.`, onTransition);
  }

  async function telecharger(format: "xlsx" | "pdf") {
    setOccupe(format);
    setMessage(null);
    try {
      await apiDownload(`${chemin}/report.${format}${qs}`, `rapport_hsse_${modele.code ?? modele.id}_${mois.replace("-", "_")}.${format}`);
    } catch (e) {
      setMessage({ tone: "danger", text: texteErreur(e, {}, "Le téléchargement n'a pas abouti.") });
    } finally {
      setOccupe(null);
    }
  }

  const exportBloque = nbSaisies > 0 ? "Enregistrez d'abord vos saisies : l'export reprend le rapport enregistré." : undefined;
  return (
    <div className="space-y-5">
      <Card
        title={`Rapport ${deMois(r.month)}`}
        actions={
          <span className="no-print flex flex-wrap gap-2">
            <Button size="sm" loading={occupe === "xlsx"} disabled={Boolean(exportBloque)} title={exportBloque} onClick={() => void telecharger("xlsx")}>
              <Download className="h-3.5 w-3.5" /> Excel
            </Button>
            <Button size="sm" loading={occupe === "pdf"} disabled={Boolean(exportBloque)} title={exportBloque} onClick={() => void telecharger("pdf")}>
              <Download className="h-3.5 w-3.5" /> PDF
            </Button>
          </span>
        }
      >
        <p className="max-w-[90ch] text-[13.5px] leading-relaxed text-ink-2">
          Pour <span className="font-semibold text-ink">{client}</span>, {r.company.name}. Période analysée : {r.period_label.toLocaleLowerCase("fr")}.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {r.state === "validated" ? <Badge tone={tonHsseq("Validé", "ok")}>Validé</Badge> : <Tampon mot="Brouillon" />}
          <span className="text-[12.5px] text-muted">{r.frozen && r.frozen_on ? `Valeurs calculées figées le ${fmtDate(r.frozen_on)}.` : `Valeurs calculées provisoires : elles se figent le ${fmtDate(r.freeze_date)}.`}</span>
        </div>

        <div className="mt-4 space-y-3">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <OuEnEst r={r} aSaisir={aSaisir.map((i) => i.code)} />
          {(r.transitions.length > 0 || r.rights.can_edit) && (
            <div className="no-print flex flex-wrap gap-2">
              {r.transitions.includes("validate") && (
                <Button variant="primary" loading={occupe === "validate"} disabled={nbSaisies > 0} title={nbSaisies > 0 ? "Enregistrez d'abord vos saisies." : undefined} onClick={() => void valider()}>
                  Valider le mois
                </Button>
              )}
              {r.transitions.includes("reopen") && (
                <Button onClick={() => setReouvrir(true)}>
                  <RotateCcw className="h-4 w-4" /> Rouvrir le mois
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Synthese r={r} modele={modele} />

      <Indicateurs
        r={r}
        lecture={lecture}
        onLecture={setLecture}
        saisie={r.rights.can_edit}
        brouillon={b}
        onValeur={(id, texte) => setB({ ...b, valeurs: { ...b.valeurs, [id]: texte } })}
        onCommentaire={(id, texte) => setB({ ...b, commentaires: { ...b.commentaires, [id]: texte } })}
      />

      <Card title="Commentaire du mois">
        {r.rights.can_edit ? (
          <Field label="Faits marquants, explications des écarts, décisions" hint="Repris au pied du classeur Excel et du PDF.">
            <Textarea value={b.commentaire ?? r.comment ?? ""} onChange={(e) => setB({ ...b, commentaire: e.target.value })} />
          </Field>
        ) : r.comment ? (
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">{r.comment}</p>
        ) : (
          <p className="text-[13px] text-muted">Aucun commentaire pour ce mois.</p>
        )}
        <div className="mt-5">
          <Historique entrees={r.history} />
        </div>
      </Card>

      {nbSaisies > 0 && (
        <div role="region" aria-label="Saisies non enregistrées" className={cx(PANNEAU, "no-print sticky bottom-4 z-20 flex flex-wrap items-center gap-3 px-4 py-3")}>
          <span className="mr-auto text-[13px] font-medium text-ink">
            {pluriel(nbSaisies, "saisie non enregistrée", "saisies non enregistrées")}
            {illisibles.length > 0 && <span className="block text-[12.5px] font-semibold text-danger">Nombre illisible : {illisibles.map((i) => i.code).join(", ")}.</span>}
          </span>
          <Button onClick={() => setB(BROUILLON_VIDE)} disabled={occupe === "enregistrer"}>
            Annuler
          </Button>
          <Button variant="primary" loading={occupe === "enregistrer"} disabled={illisibles.length > 0} onClick={enregistrer}>
            Enregistrer
          </Button>
        </div>
      )}

      {reouvrir && <FenetreReouverture titre={`Rouvrir le rapport ${deMois(r.month)}`} onClose={() => setReouvrir(false)} envoyer={rouvrir} />}
    </div>
  );
}

/** Où en est le mois, et ce qu'il reste à faire, selon l'état, les transitions et les droits. */
function OuEnEst({ r, aSaisir }: { r: MonthlyReport; aSaisir: string[] }) {
  const reste = aSaisir.length > 0 && r.rights.can_edit ? ` ${pluriel(aSaisir.length, "valeur reste", "valeurs restent")} à saisir : ${aSaisir.join(", ")}.` : "";
  if (r.state === "validated") {
    return (
      <Notice tone="ok">
        Validé le {fmtDateTime(r.validated_at)}
        {r.validated_by ? ` par ${r.validated_by.name}` : ""}.{r.transitions.includes("reopen") ? " Rouvrir le mois exige un motif, inscrit au journal." : ""}
      </Notice>
    );
  }
  if (r.transitions.includes("validate")) return <Notice tone="warn">Mois clos : complétez les valeurs saisies et les commentaires, puis validez le rapport.{reste}</Notice>;
  if (r.rights.can_edit) return <Notice tone="accent">Mois en cours : saisissez au fil du mois. La validation s&apos;ouvre le {fmtDate(r.freeze_date)}, quand les valeurs calculées se figent.{reste}</Notice>;
  const ouvert = r.frozen || r.freeze_date <= aujourdhui();
  return <Notice tone="neutral">{ouvert ? "Rapport en brouillon : le Responsable HSSEQ le complète, puis le valide." : `Rapport en brouillon : le Responsable HSSEQ le complète au fil du mois et le valide à partir du ${fmtDate(r.freeze_date)}.`}</Notice>;
}

/** Corps de PATCH : les valeurs saisies et les commentaires qui changent, et le commentaire du mois. */
function patch(r: MonthlyReport, b: Brouillon): MonthlyReportPatch {
  const values: NonNullable<MonthlyReportPatch["values"]> = [];
  for (const i of r.indicators) {
    const item: { indicator_id: number; value?: number | null; comment?: string | null } = { indicator_id: i.id };
    const texte = b.valeurs[i.id];
    if (i.mode === "manual" && texte !== undefined) {
      const n = lireNombre(texte);
      if (n !== i.value && !(texte.trim() !== "" && n === null)) item.value = n;
    }
    const commentaire = b.commentaires[i.id];
    if (commentaire !== undefined && commentaire.trim() !== (i.comment ?? "")) item.comment = commentaire.trim() || null;
    if ("value" in item || "comment" in item) values.push(item);
  }
  const corps: MonthlyReportPatch = values.length ? { values } : {};
  if (b.commentaire !== null && b.commentaire.trim() !== (r.comment ?? "")) corps.comment = b.commentaire.trim() || null;
  return corps;
}

/** Réouverture d'un mois validé (Responsable HSSEQ) : motif écrit obligatoire, inscrit au journal. */
function FenetreReouverture({ titre, onClose, envoyer }: { titre: string; onClose: () => void; envoyer: (reason: string) => Promise<string | null> }) {
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <Modal
      open
      title={titre}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Retour</Button>
          <Button
            variant="primary"
            loading={envoi}
            disabled={motif.trim().length < 5}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              const refus = await envoyer(motif.trim());
              setEnvoi(false);
              if (refus) setErreur(refus);
              else onClose();
            }}
          >
            Rouvrir le mois
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-ink-2">Le mois revient en brouillon : ses valeurs saisies et ses commentaires se modifient de nouveau, puis il se valide une nouvelle fois. Les valeurs calculées restent celles figées.</p>
        <Field label="Motif (obligatoire)" hint="Cinq caractères au moins ; inscrit au journal du mois.">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} />
        </Field>
        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </div>
    </Modal>
  );
}
