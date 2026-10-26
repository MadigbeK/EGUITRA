"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Kpi, Modal, Notice, ProgressBar, Select, Textarea, tonEtat } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { ESPACES } from "@/lib/config";
import { INSECABLE, fmtDec, pluriel } from "@/lib/format";
import {
  GRAVITES,
  PLATEFORME,
  TYPES,
  libelleApp,
  libelleEtat,
  libelleGravite,
  type DelaisGravite,
  type Delai,
  type EtatDemande,
  type FicheDemande,
  type GraviteDemande,
  type SyntheseDemandes,
  type TypeDemande,
} from "@/lib/support-types";
import type { Me } from "@/lib/types";

export const CHEMIN_DEMANDES = "/compte/demandes";

/** Message d'une erreur d'appel, pour une notice. */
export function messageErreur(e: unknown, defaut = "Action impossible."): string {
  return e instanceof ApiError ? e.message : defaut;
}

export function BadgeEtat({ etat }: { etat: EtatDemande }) {
  const mot = libelleEtat(etat);
  return <Badge tone={tonEtat(mot)}>{mot}</Badge>;
}

/** La gravité ne concerne que les anomalies et les remarques de recette (offre, chapitre 7.2). */
export function graviteUtile(kind: TypeDemande): boolean {
  return kind === "anomalie" || kind === "recette";
}

export function BadgeGravite({ gravite }: { gravite: GraviteDemande }) {
  const mot = libelleGravite(gravite);
  return <Badge tone={tonEtat(mot)}>{mot}</Badge>;
}

/** Heures ouvrées : « 1,5 h », « 20 h ». */
export function heures(h: number | null | undefined): string {
  return h === null || h === undefined ? "–" : `${fmtDec(h)}${INSECABLE}h`;
}

/** Délai engagé dans les mots de l'offre : « 2 heures ouvrées », « 1 jour ouvré », « 2 jours ouvrés ». */
export function engagement(h: number): string {
  if (h >= 10 && h % 10 === 0) return h === 10 ? "1 jour ouvré" : `${h / 10} jours ouvrés`;
  return `${fmtDec(h)} ${h > 1 ? "heures ouvrées" : "heure ouvrée"}`;
}

/** Délai de prise en charge ou de résolution en clair, pour la fiche. */
export function texteDelai(d: Delai, etape: "prise en charge" | "résolution"): string {
  if (d.target_hours === null) return d.done ? `Résolue en ${heures(d.hours)} ouvrées` : "Sans délai fixe : prochaine livraison planifiée";
  if (d.hours === null) return `Engagement : ${engagement(d.target_hours)}`;
  const fait = d.done ? `${etape === "prise en charge" ? "Prise en charge" : "Résolue"} en ${heures(d.hours)} ouvrées` : `${heures(d.hours)} ouvrées écoulées`;
  return `${fait} ; engagement : ${engagement(d.target_hours)}`;
}

/** Applications qu'une demande peut concerner pour ce compte : les siennes, le portail pour le cabinet, la plateforme. */
function applicationsDe(me: Me): string[] {
  const apps: string[] = me.apps.filter((a) => a !== "portail");
  if (me.apps.includes("axispro")) apps.push("portail");
  return [...apps, PLATEFORME];
}

/** Dépôt d'une demande : le numéro revient aussitôt (accusé de dépôt), la fiche s'ouvre. */
export function NouvelleDemande({ me, onClose, onDeposee }: { me: Me; onClose: () => void; onDeposee: (fiche: FicheDemande) => void }) {
  const apps = applicationsDe(me);
  const [kind, setKind] = useState<TypeDemande>("anomalie");
  const [severity, setSeverity] = useState<GraviteDemande>("mineure");
  const [app, setApp] = useState<string>(ESPACES.find((a) => me.apps.includes(a)) ?? PLATEFORME);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [company, setCompany] = useState<number>(me.company_id);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const gravite = graviteUtile(kind);
  const choisie = GRAVITES.find((g) => g.value === severity);

  async function deposer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const fiche = await apiSend<FicheDemande>("POST", "/support/requests", {
        kind,
        severity: gravite ? severity : "mineure",
        app,
        title: title.trim(),
        description: description.trim(),
        company_id: company,
      });
      onDeposee(fiche);
    } catch (e) {
      setErreur(messageErreur(e, "Dépôt impossible."));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="Nouvelle demande"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={envoi}>
            Annuler
          </Button>
          <Button variant="primary" loading={envoi} disabled={!title.trim() || !description.trim()} onClick={deposer}>
            Déposer la demande
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Type de demande</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TYPES.map((t) => (
              <label key={t.value} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${kind === t.value ? "border-accent bg-accent-doux" : "border-line bg-panel-2 hover:border-line-strong"}`}>
                <input type="radio" name="type-demande" className="mt-1" checked={kind === t.value} onChange={() => setKind(t.value)} />
                <span>
                  <span className="block text-sm font-semibold text-ink">{t.label}</span>
                  <span className="block text-[12.5px] leading-snug text-muted">{t.aide}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Application concernée">
            <Select value={app} onChange={(e) => setApp(e.target.value)} options={apps.map((a) => ({ value: a, label: libelleApp(a) }))} />
          </Field>
          {gravite ? (
            <Field label="Gravité" hint={choisie ? `${choisie.definition} : ${choisie.delais}.` : undefined}>
              <Select value={severity} onChange={(e) => setSeverity(e.target.value as GraviteDemande)} options={GRAVITES.map((g) => ({ value: g.value, label: `${g.label} : ${g.definition.toLowerCase()}` }))} />
            </Field>
          ) : kind === "evolution" ? (
            <Notice tone="neutral">Qualifiée par écrit sous 2 jours ouvrés : incluse dans le crédit du trimestre (2 jours au plus par évolution, 6 par trimestre) ou facturable sur devis.</Notice>
          ) : (
            <Notice tone="neutral">Réponse écrite dans ce fil, sous 1 jour ouvré.</Notice>
          )}
          {me.companies.length > 1 && (
            <Field label="Société concernée">
              <Select value={company} onChange={(e) => setCompany(Number(e.target.value))} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
          )}
        </div>
        <Field label="Titre">
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Ce qui ne va pas, ou ce que vous souhaitez, en une ligne" />
        </Field>
        <Field label="Description" hint="Qui (identifiant), quand (date et heure), où (écran), ce qui était attendu, ce qui s'est produit, le message affiché. Jamais de mot de passe ni de code de double authentification.">
          <Textarea rows={7} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {gravite && severity === "bloquante" && (
          <Notice tone="warn">Anomalie bloquante : appelez aussi le support au +224 628 86 22 55, du lundi au vendredi de 8 h à 18 h.</Notice>
        )}
      </div>
    </Modal>
  );
}

/* ─── Synthèse de l'administration ─────────────────────────────────────── */

function libelleGroupe(g: DelaisGravite): string {
  return g.key === "evolution" ? "Évolutions (qualification)" : libelleGravite(g.key);
}

/** Synthèse pour l'administration : demandes par état, délais de prise en charge, crédit d'évolutions. */
export function SyntheseSupport() {
  const { data, error, mutate } = useApi<SyntheseDemandes>("/support/summary");
  if (!data) return <Etat data={data} error={error} onRetry={() => void mutate()} label="Calcul de la synthèse…" />;
  const t = data.take_over;
  const courant = data.credit.quarters[0];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="À prendre en charge" value={String(t.waiting)} tone={t.waiting_late ? "danger" : t.waiting ? "warn" : "ok"} hint={t.waiting_late ? `${pluriel(t.waiting_late, "demande")} hors délai` : "Aucune hors délai"} />
        <Kpi label="En traitement" value={String(data.open)} hint={data.resolution_late ? `${pluriel(data.resolution_late, "résolution")} hors délai` : "Résolutions dans les délais"} tone={data.resolution_late ? "danger" : "neutral"} />
        <Kpi label="Délai moyen de prise en charge" value={heures(t.average_hours)} hint={t.count ? `${pluriel(t.count, "prise")} en charge, dont ${t.late} hors délai ; la plus longue : ${heures(t.max_hours)}` : "Aucune prise en charge encore"} tone={t.late ? "warn" : "neutral"} />
        {courant && <Kpi label={`Crédit d'évolutions, ${courant.label}`} value={`${fmtDec(courant.remaining)}${INSECABLE}j`} hint={`restants sur ${fmtDec(courant.per_quarter)} ; ${fmtDec(courant.used)} consommés`} tone={courant.remaining > 0 ? "neutral" : "warn"} />}
      </div>

      <Card title="Délais de prise en charge" padded={false}>
        <DataTable
          rows={t.by_severity}
          rowKey={(g) => g.key}
          columns={[
            { key: "key", label: "Gravité", render: (g) => libelleGroupe(g) },
            { key: "target_hours", label: "Engagement", align: "right", render: (g) => engagement(g.target_hours) },
            { key: "count", label: "Prises en charge", align: "right" },
            { key: "average_hours", label: "Délai moyen", align: "right", render: (g) => heures(g.average_hours) },
            { key: "max_hours", label: "Le plus long", align: "right", render: (g) => heures(g.max_hours) },
            { key: "late", label: "Hors délai", align: "right", render: (g) => (g.late ? <Badge tone="danger">{String(g.late)}</Badge> : "0") },
          ]}
        />
        <p className="px-5 pb-4 pt-3 text-[12.5px] leading-snug text-muted">Heures ouvrées : du lundi au vendredi, de 8 h à 18 h, jours fériés exclus. Une évolution est prise en charge par sa qualification écrite, sous 2 jours ouvrés.</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Demandes par état et par type">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {(Object.keys(data.counts) as EtatDemande[]).map((etat) => (
              <div key={etat} className="flex items-center justify-between gap-3 border-b border-line/70 py-1.5">
                <dt className="text-ink-2">{libelleEtat(etat)}</dt>
                <dd className="font-semibold tabular text-ink">{data.counts[etat]}</dd>
              </div>
            ))}
            {TYPES.map((t2) => (
              <div key={t2.value} className="flex items-center justify-between gap-3 border-b border-line/70 py-1.5">
                <dt className="text-ink-2">{t2.label}</dt>
                <dd className="font-semibold tabular text-ink">{data.kinds[t2.value]}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Crédit d'évolutions par trimestre">
          <p className="mb-4 text-[13px] leading-snug text-muted">
            {fmtDec(data.credit.per_quarter)} jours par trimestre, cumulables dans le trimestre et non reportables ; {fmtDec(data.credit.max_per_request)} jours au plus par évolution incluse (offre, chapitre 7.4). Décompte à communiquer au client chaque trimestre.
          </p>
          <ul className="space-y-5">
            {data.credit.quarters.map((q) => (
              <li key={q.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-semibold text-ink">{q.label}</span>
                  <span className="tabular text-ink-2">
                    {fmtDec(q.used)}{INSECABLE}j consommés, {fmtDec(q.remaining)}{INSECABLE}j restants
                  </span>
                </div>
                <ProgressBar value={(q.used / q.per_quarter) * 100} tone={q.remaining > 0 ? "accent" : "warn"} />
                {q.requests && q.requests.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[13px]">
                    {q.requests.map((r) => (
                      <li key={r.id} className="flex items-baseline justify-between gap-3">
                        <Link href={`${CHEMIN_DEMANDES}/${r.id}`} className="min-w-0 truncate text-ink-2 hover:text-accent">
                          <span className="font-semibold tabular">{r.name}</span> {r.title}
                        </Link>
                        <span className="flex-none tabular text-muted">{fmtDec(r.credit_days)} j</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
