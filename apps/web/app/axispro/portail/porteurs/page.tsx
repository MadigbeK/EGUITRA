"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import { Recherche, correspond, pluriel, telechargerCsv } from "@/components/portail/cabinet/outils";
import { quand } from "@/components/portail/commun";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Kpi, Loading, PageHeader, Repartition, Segmented, Tabs, cx, type Column, type Tone } from "@/components/ui";
import { ETATS } from "@/lib/couleurs";
import { useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { FeedbackRow, FeedbackTopic, PorteurRow } from "@/lib/portail-types";

type Vue = "porteurs" | "avis";
type FiltrePorteur = "tous" | "jamais" | "inactifs";

const SUJET: Record<FeedbackTopic, string> = { global: "Accompagnement", consultant: "Consultant", portail: "Portail", event: "Événement" };
const TRENTE_JOURS = 30 * 86_400_000;

function toneNote(score: number): Tone {
  return score >= 4 ? "ok" : score === 3 ? "warn" : "danger";
}

function virgule(n: number, d = 1) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function signe(n: number) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

/** Indicateur de recommandation : promoteurs (9 et 10) moins détracteurs (0 à 6), sur les avis qui la donnent. */
function nps(avis: FeedbackRow[]) {
  const notes = avis.map((a) => a.recommend).filter((r): r is number => r !== null);
  const promoteurs = notes.filter((r) => r >= 9).length;
  const detracteurs = notes.filter((r) => r <= 6).length;
  return { n: notes.length, promoteurs, passifs: notes.length - promoteurs - detracteurs, detracteurs, valeur: notes.length ? Math.round((100 * (promoteurs - detracteurs)) / notes.length) : null };
}

export default function PorteursAvisPage() {
  const { data: porteurs, error: erreurPorteurs, mutate: majPorteurs } = useApi<PorteurRow[]>("/axispro/portail/porteurs");
  const { data: avis, error: erreurAvis, mutate: majAvis } = useApi<FeedbackRow[]>("/axispro/portail/avis");
  const [vue, setVue] = useState<Vue>("porteurs");
  const [maintenant] = useState(() => Date.now());

  const liste = porteurs ?? [];
  const actifs = liste.filter((p) => p.active);
  const recents = actifs.filter((p) => p.last_login && maintenant - new Date(p.last_login).getTime() <= TRENTE_JOURS).length;
  const jamais = actifs.filter((p) => !p.last_login).length;
  const tousAvis = avis ?? [];
  const moyenne = tousAvis.length ? tousAvis.reduce((s, a) => s + a.score, 0) / tousAvis.length : null;
  const indice = nps(tousAvis);

  return (
    <div>
      <PageHeader title="Porteurs et avis" subtitle="Les porteurs inscrits au portail, leur activité, et ce qu'ils disent de l'accompagnement du cabinet." />
      <OngletsPortail />
      <div className="space-y-5">
        <section aria-label="Chiffres clés" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Porteurs inscrits" value={porteurs ? String(actifs.length) : "–"} hint={porteurs && liste.length > actifs.length ? `${pluriel(liste.length - actifs.length, "compte fermé", "comptes fermés")} en plus` : "Comptes ouverts au portail"} />
          <Kpi label="Actifs sur 30 jours" value={porteurs ? String(recents) : "–"} tone={porteurs && actifs.length ? (recents / actifs.length >= 0.5 ? "ok" : "warn") : "neutral"} hint={porteurs && actifs.length ? `${Math.round((recents / actifs.length) * 100)} % des porteurs inscrits` : undefined} />
          <Kpi label="Jamais connectés" value={porteurs ? String(jamais) : "–"} tone={jamais ? "warn" : "neutral"} hint={jamais ? "À relancer par leur consultant" : "Tous se sont connectés au moins une fois"} />
          <Kpi
            label="Satisfaction"
            value={moyenne === null ? "–" : `${virgule(moyenne)} / 5`}
            tone={moyenne === null ? "neutral" : moyenne >= 4 ? "ok" : moyenne >= 3 ? "warn" : "danger"}
            hint={avis ? (tousAvis.length ? `NPS ${indice.valeur === null ? "non calculé" : signe(indice.valeur)}, sur ${pluriel(tousAvis.length, "avis", "avis")}` : "Aucun avis reçu") : undefined}
          />
        </section>

        <Tabs
          value={vue}
          onChange={setVue}
          tabs={[
            { key: "porteurs", label: "Porteurs inscrits", count: porteurs ? liste.length : undefined },
            { key: "avis", label: "Avis des porteurs", count: avis ? tousAvis.length : undefined },
          ]}
        />

        {vue === "porteurs" ? (
          erreurPorteurs ? (
            <ErrorBox error={erreurPorteurs} onRetry={() => void majPorteurs()} />
          ) : !porteurs ? (
            <Loading label="Chargement des porteurs…" />
          ) : (
            <Porteurs rows={liste} maintenant={maintenant} />
          )
        ) : erreurAvis ? (
          <ErrorBox error={erreurAvis} onRetry={() => void majAvis()} />
        ) : !avis ? (
          <Loading label="Chargement des avis…" />
        ) : (
          <Avis avis={tousAvis} />
        )}
      </div>
    </div>
  );
}

/* ─── Porteurs ─────────────────────────────────────────────────────────── */

function Porteurs({ rows, maintenant }: { rows: PorteurRow[]; maintenant: number }) {
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState<FiltrePorteur>("tous");
  const visibles = rows.filter((p) => {
    if (filtre === "jamais" && (p.last_login || !p.active)) return false;
    if (filtre === "inactifs" && (!p.active || (p.last_login && maintenant - new Date(p.last_login).getTime() <= TRENTE_JOURS))) return false;
    return correspond(q, p.name, p.login, p.phone, ...p.dossiers.flatMap((d) => [d.reference, d.name]));
  });

  function exporter() {
    telechargerCsv("porteurs-portail.csv", [
      ["Porteur", "Identifiant", "Téléphone", "Dossiers", "Dernière connexion", "Dernier message", "Compte"],
      ...visibles.map((p) => [p.name, p.login, p.phone, p.dossiers.map((d) => d.reference).join(", "), p.last_login ? fmtDateTime(p.last_login) : "Jamais", p.last_message ? fmtDateTime(p.last_message) : "", p.active ? "Ouvert" : "Fermé"]),
    ]);
  }

  const colonnes: Column<PorteurRow>[] = [
    {
      key: "name",
      label: "Porteur",
      sortValue: (p) => p.name.toLowerCase(),
      render: (p) => (
        <div className="min-w-[170px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-ink">{p.name}</span>
            {!p.active && <Badge>Compte fermé</Badge>}
          </div>
          <div className="text-[12px] text-muted">{p.login}</div>
        </div>
      ),
    },
    { key: "phone", label: "Téléphone", sortValue: (p) => p.phone, render: (p) => (p.phone ? <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="whitespace-nowrap text-ink-2 hover:text-accent hover:underline">{p.phone}</a> : <span className="text-muted">–</span>) },
    {
      key: "dossiers",
      label: "Dossiers",
      sortValue: (p) => p.dossiers[0]?.reference ?? "",
      render: (p) => (
        <ul className="min-w-[200px] space-y-0.5">
          {p.dossiers.map((d) => (
            <li key={d.id} className="text-[13px]">
              <Link href={`/axispro/dossiers/${d.id}`} className="font-semibold text-accent hover:underline">
                {d.reference}
              </Link>{" "}
              <span className="text-ink-2">{d.name}</span>
              {d.current_gate && (
                <span className="ml-1.5 rounded bg-panel-3 px-1.5 py-px text-[11px] font-semibold text-ink-2" title={d.current_gate.name}>
                  {d.current_gate.code}
                </span>
              )}
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "last_login",
      label: "Dernière connexion",
      sortValue: (p) => p.last_login,
      render: (p) =>
        p.last_login ? (
          <span className={cx("whitespace-nowrap", maintenant - new Date(p.last_login).getTime() > TRENTE_JOURS ? "text-warn" : "text-ink-2")} title={fmtDateTime(p.last_login)}>
            {quand(p.last_login)}
          </span>
        ) : (
          <Badge tone="warn">Jamais connecté</Badge>
        ),
    },
    { key: "last_message", label: "Dernier message", sortValue: (p) => p.last_message, render: (p) => (p.last_message ? <span className="whitespace-nowrap text-ink-2" title={fmtDateTime(p.last_message)}>{quand(p.last_message)}</span> : <span className="text-muted">Aucun</span>) },
    {
      key: "feedback",
      label: "Dernières notes",
      sortValue: (p) => (p.feedback.length ? p.feedback.reduce((s, f) => s + f.score, 0) / p.feedback.length : null),
      render: (p) =>
        p.feedback.length ? (
          <div className="flex flex-wrap gap-1">
            {p.feedback.map((f, i) => (
              <span key={i} title={`${SUJET[f.topic]}, ${fmtDate(f.date)}`}>
                <Badge tone={toneNote(f.score)}>{`${f.score}/5`}</Badge>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-5">
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented
            label="Porteurs affichés"
            value={filtre}
            onChange={setFiltre}
            options={[
              { key: "tous", label: "Tous" },
              { key: "jamais", label: "Jamais connectés" },
              { key: "inactifs", label: "Absents depuis 30 jours" },
            ]}
          />
        </div>
        <Recherche className="min-w-[200px] flex-1" label="Rechercher un porteur" placeholder="Nom, identifiant, téléphone, dossier" value={q} onChange={setQ} />
        <Button disabled={!visibles.length} onClick={exporter}>
          <Download className="h-4 w-4" /> Exporter (CSV)
        </Button>
      </div>
      <DataTable columns={colonnes} rows={visibles} rowKey={(p) => p.id} empty={rows.length ? "Aucun porteur dans cette sélection." : "Aucun porteur inscrit au portail."} />
    </Card>
  );
}

/* ─── Avis ─────────────────────────────────────────────────────────────── */

function Etoiles({ score }: { score: number }) {
  return (
    <span role="img" aria-label={`${score} sur 5`} className="inline-flex gap-px text-[14px] leading-none">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden className={i <= score ? "text-or" : "text-line-strong"}>
          ★
        </span>
      ))}
    </span>
  );
}

function Avis({ avis }: { avis: FeedbackRow[] }) {
  const [sujet, setSujet] = useState<"tous" | FeedbackTopic>("tous");
  const [commentes, setCommentes] = useState(true);
  const [q, setQ] = useState("");
  const indice = nps(avis);
  const moyenne = avis.length ? avis.reduce((s, a) => s + a.score, 0) / avis.length : null;
  const repartition = [5, 4, 3, 2, 1].map((n) => ({ note: n, nombre: avis.filter((a) => a.score === n).length }));
  const max = Math.max(1, ...repartition.map((r) => r.nombre));
  const parSujet = (Object.keys(SUJET) as FeedbackTopic[])
    .map((t) => {
      const lot = avis.filter((a) => a.topic === t);
      return { t, n: lot.length, moyenne: lot.length ? lot.reduce((s, a) => s + a.score, 0) / lot.length : null };
    })
    .filter((x) => x.n > 0);
  const liste = useMemo(
    () =>
      [...avis]
        .filter((a) => (sujet === "tous" || a.topic === sujet) && (!commentes || a.comment) && correspond(q, a.comment, a.author, a.dossier.reference, a.dossier.name, a.event))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [avis, sujet, commentes, q],
  );

  if (!avis.length) {
    return (
      <Card>
        <Empty title="Aucun avis pour l'instant." hint="Les porteurs notent l'accompagnement, leur consultant, le portail et les événements depuis leur espace." />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      <div className="space-y-5 xl:col-span-5">
        <Card title="Notes reçues">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <div className="text-[12.5px] text-muted">Moyenne</div>
              <div className="font-display text-[34px] font-[650] leading-none text-ink">
                {moyenne === null ? "–" : virgule(moyenne)}
                <span className="ml-1 text-[15px] font-medium text-muted">/ 5</span>
              </div>
              <div className="mt-1 text-[12px] text-muted">{pluriel(avis.length, "avis", "avis")}</div>
            </div>
            <div>
              <div className="text-[12.5px] text-muted">Recommandation (NPS)</div>
              <div className={cx("font-display text-[34px] font-[650] leading-none", indice.valeur === null ? "text-muted" : indice.valeur >= 30 ? "text-ok-texte" : indice.valeur >= 0 ? "text-ink" : "text-danger")}>{indice.valeur === null ? "–" : signe(indice.valeur)}</div>
              <div className="mt-1 text-[12px] text-muted">sur {pluriel(indice.n, "réponse", "réponses")}</div>
            </div>
          </div>
          <ul className="mt-5 space-y-1.5" aria-label="Répartition des notes">
            {repartition.map((r) => (
              <li key={r.note} className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]">
                <Etoiles score={r.note} />
                <span className="h-2.5 overflow-hidden rounded-full bg-panel-3">
                  <span className="n-pousser-x block h-full rounded-full" style={{ width: `${(r.nombre / max) * 100}%`, background: r.note >= 4 ? "var(--g-jade)" : r.note === 3 ? "var(--warn-vif)" : "var(--danger-vif)" }} />
                </span>
                <span className="text-right tabular text-ink-2">
                  {r.nombre} <span className="text-muted">({Math.round((r.nombre / avis.length) * 100)} %)</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {indice.n > 0 && (
          <Card title="Promoteurs et détracteurs">
            <Repartition
              parts={[
                { key: "promoteurs", label: "Promoteurs (9 ou 10)", value: indice.promoteurs, color: ETATS.bon },
                { key: "passifs", label: "Passifs (7 ou 8)", value: indice.passifs, color: ETATS.neutre },
                { key: "detracteurs", label: "Détracteurs (0 à 6)", value: indice.detracteurs, color: ETATS.risque },
              ]}
            />
            <p className="mt-3 text-[12px] leading-snug text-muted">NPS : part des promoteurs moins part des détracteurs, sur les avis qui donnent une recommandation de 0 à 10.</p>
          </Card>
        )}

        {parSujet.length > 0 && (
          <Card title="Par sujet" padded={false}>
            <ul className="divide-y divide-line">
              {parSujet.map((x) => (
                <li key={x.t} className="flex items-center justify-between gap-3 px-6 py-2.5 text-[13.5px]">
                  <span className="text-ink-2">{SUJET[x.t]}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-[12px] text-muted">{pluriel(x.n, "avis", "avis")}</span>
                    {x.moyenne !== null && <Badge tone={toneNote(Math.round(x.moyenne))}>{`${virgule(x.moyenne)} / 5`}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card title="Commentaires" className="xl:col-span-7" padded={false} actions={<span className="text-[12.5px] text-muted">{pluriel(liste.length, "avis affiché", "avis affichés")}</span>}>
        <div className="space-y-2.5 px-5 pb-4 pt-1">
          <div className="-mx-1 overflow-x-auto px-1">
            <Segmented
              label="Sujet des avis"
              value={sujet}
              onChange={setSujet}
              options={[{ key: "tous" as const, label: "Tous" }, ...(Object.keys(SUJET) as FeedbackTopic[]).map((t) => ({ key: t, label: SUJET[t] }))]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Recherche className="min-w-[200px] flex-1" label="Rechercher dans les avis" placeholder="Mot, porteur, dossier" value={q} onChange={setQ} />
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" aria-label="Avec commentaire seulement" checked={commentes} onChange={(e) => setCommentes(e.target.checked)} />
              Avec commentaire seulement
            </label>
          </div>
        </div>
        {liste.length === 0 ? (
          <Empty title="Aucun avis dans cette sélection." />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {liste.map((a) => (
              <li key={a.id} className="px-5 py-3.5 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Etoiles score={a.score} />
                  <Badge tone="neutral">{a.topic_label || SUJET[a.topic]}</Badge>
                  {a.recommend !== null && <span className={cx("text-[12px] font-semibold", a.recommend >= 9 ? "text-ok-texte" : a.recommend <= 6 ? "text-danger" : "text-muted")}>Recommandation {a.recommend}/10</span>}
                  <span className="ml-auto text-[12px] text-muted" title={fmtDateTime(a.date)}>
                    {quand(a.date)}
                  </span>
                </div>
                {a.comment ? <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">« {a.comment} »</p> : <p className="mt-1.5 text-[13px] italic text-muted">Sans commentaire.</p>}
                <p className="mt-1 text-[12px] text-muted">
                  {a.author},{" "}
                  <Link href={`/axispro/dossiers/${a.dossier.id}`} className="font-semibold text-accent hover:underline">
                    {a.dossier.reference}
                  </Link>{" "}
                  {a.dossier.name}
                  {a.event ? `. Événement : ${a.event}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
