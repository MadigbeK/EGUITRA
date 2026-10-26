"use client";

import { useState } from "react";
import { Button, Card, DataTable, ErrorBox, Etat, Field, Kpi, Modal, Notice, Segmented, Textarea, type Column } from "@/components/ui";
import { ALCOOTEST_FAIT, STATUT_ALCOOTEST, Tampon, nomRotation } from "@/components/hsseq/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtDateTime, fmtFixe, fmtInt, fmtPct, pluriel } from "@/lib/format";
import type { BreathTest, BreathTestCounts, BreathTestDetail, BreathTestStatusValue, CheckCounts, CheckLine, Page, Referentials, VehicleKind } from "@/lib/hsseq-types";
import { Pages, aProfil, messageErreur, requete } from "@/components/hsseq/actions/outils";
import { ChampProfil, ChampSite, ChampsPeriode, Saisie, TYPE_ADRESSE, periode } from "./elements";

const PAR_PAGE = 50;

/** Statut dans l'adresse et sa clé dans l'API. */
const STATUT_ADRESSE: Record<string, BreathTestStatusValue> = { conforme: "compliant", "non-conforme": "non_compliant", "non-realise": "not_done" };
type FiltreStatut = "tous" | "conforme" | "non-conforme" | "non-realise";

/** Niveau de lecture du compte (§2, §9.4) : détail chiffré (hsseq), statut (exploitation, direction, admin), fait ou non (conducteur). */
type Lecture = "detail" | "status" | "done";

function lecture(ref: Referentials | undefined): Lecture {
  if (aProfil(ref, "hsseq")) return "detail";
  if (aProfil(ref, "exploitation", "direction", "admin")) return "status";
  return "done";
}

/**
 * Alcootests : taux de réalisation sur les départs de la période et liste des tests, lus selon le
 * profil. Le détail chiffré (résultat, taux, appareil, heure, auteur) n'est servi qu'au Responsable
 * HSSEQ, et chaque lecture est journalisée ; exploitation, direction et administration lisent le
 * statut ; le conducteur ne lit que « fait » (§9.4). Le Responsable HSSEQ annule un test saisi par
 * erreur, motif écrit obligatoire (POST /hsseq/breath-tests/{id}/cancel) ; les tests annulés se
 * relisent à part (cancelled=1), connus de lui seul.
 */
export function Alcootests({ ref_, lire, ecrire }: { ref_: Referentials | undefined; lire: (cle: string) => string; ecrire: (maj: Record<string, string | number | null>) => void }) {
  const niveau = lecture(ref_);
  const { du, au } = periode(lire);
  const site = lire("site");
  // Profil de l'ensemble de la rotation du test : un test pas encore rattaché n'en a pas.
  const type: VehicleKind | null = TYPE_ADRESSE[lire("type")] ?? null;
  const statut: FiltreStatut = lire("test") in STATUT_ADRESSE ? (lire("test") as FiltreStatut) : "tous";
  const annules = niveau === "detail" && lire("annules") === "1";
  const filtres = { date_from: du, date_to: au, site_id: site || null, vehicle_kind: type, cancelled: annules ? 1 : null };
  const [annulation, setAnnulation] = useState<BreathTestDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cle = `${requete(filtres)}|${statut}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;

  // Les départs de la période viennent des contrôles (mêmes filtres de date et de site).
  const { data: departs } = useApi<Page<CheckLine, CheckCounts>>(ref_ && niveau !== "done" ? `/hsseq/checks?${requete({ ...filtres, limit: 1 })}` : null, { keepPreviousData: true });
  const filtreStatut = statut !== "tous" && niveau !== "done";
  const { data, error, mutate } = useApi<Page<BreathTest, BreathTestCounts>>(
    ref_ ? `/hsseq/breath-tests?${requete({ ...filtres, status: filtreStatut ? STATUT_ADRESSE[statut] : null, offset, limit: PAR_PAGE })}` : null,
    { keepPreviousData: true },
  );
  // Sans filtre de statut, la liste porte déjà les nombres : pas de seconde lecture (chaque lecture du détail est journalisée).
  const { data: compteSeul } = useApi<Page<BreathTest, BreathTestCounts>>(ref_ && filtreStatut ? `/hsseq/breath-tests?${requete({ ...filtres, limit: 1 })}` : null, { keepPreviousData: true });
  const compte = filtreStatut ? compteSeul : data;

  // Comptes par statut : servis aux profils qui lisent le statut, vides pour le conducteur.
  const c = compte?.counts.by_status;
  const conformes = c?.compliant ?? 0;
  const nonConformes = c?.non_compliant ?? 0;
  const nonRealises = c?.not_done ?? 0;
  const realises = conformes + nonConformes;
  const nbDeparts = departs?.counts.departures ?? null;
  const taux = nbDeparts ? (realises / nbDeparts) * 100 : null;

  const colonnes = colonnesSelon(niveau, annules ? undefined : (t) => setAnnulation(t));

  return (
    <div className="space-y-5">
      {niveau === "detail" ? (
        <Notice tone="accent">Détail chiffré réservé au Responsable HSSEQ : chaque lecture de cette liste est journalisée. Ailleurs, l&apos;alcootest ne se lit qu&apos;en statut.</Notice>
      ) : niveau === "status" ? (
        <Notice tone="neutral">Statut seul : ni résultat chiffré, ni appareil, ni heure. Le détail est réservé au Responsable HSSEQ.</Notice>
      ) : null}

      {message && <Notice tone="ok">{message}</Notice>}

      <div className="flex flex-wrap items-end gap-3">
        <ChampsPeriode du={du} au={au} ecrire={ecrire} />
        <ChampSite ref_={ref_} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <ChampProfil valeur={lire("type")} onChange={(v) => ecrire({ type: v })} />
        {niveau === "detail" && (
          <Segmented
            label="Tests"
            value={annules ? "annules" : "valides"}
            onChange={(v) => ecrire({ annules: v === "annules" ? "1" : null, test: null })}
            options={[
              { key: "valides", label: "Tests en vigueur" },
              { key: "annules", label: "Tests annulés" },
            ]}
          />
        )}
      </div>
      {annules && <Notice tone="neutral">Tests annulés pour saisie erronée : sortis du verrou et des indicateurs, connus du seul Responsable HSSEQ.</Notice>}

      {niveau !== "done" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi
            label="Taux de réalisation"
            value={taux === null ? "–" : fmtPct(taux, 1)}
            tone={taux === null ? "neutral" : taux >= 100 ? "ok" : "danger"}
            hint={nbDeparts === null ? undefined : `${pluriel(realises, "alcootest réalisé", "alcootests réalisés")} pour ${pluriel(nbDeparts, "départ")} ; objectif 100${INSECABLE}%`}
          />
          <Kpi label="Non conformes" value={compte ? fmtInt(nonConformes) : "–"} tone={!compte ? "neutral" : nonConformes > 0 ? "danger" : "ok"} hint="Test positif : conducteur retiré de la rotation (V03)" />
          <Kpi label="Non réalisés" value={compte ? fmtInt(nonRealises) : "–"} tone={!compte ? "neutral" : nonRealises > 0 ? "warn" : "ok"} hint="Départ bloqué (V03) tant que le test n'est pas fait" />
        </div>
      )}

      {niveau !== "done" && (
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented
            label="Alcootests affichés"
            value={statut}
            onChange={(s) => ecrire({ test: s === "tous" ? null : s })}
            options={[
              { key: "tous", label: `Tous (${fmtInt(compte?.total_count ?? 0)})` },
              { key: "conforme", label: `Conformes (${fmtInt(conformes)})` },
              { key: "non-conforme", label: `Non conformes (${fmtInt(nonConformes)})` },
              { key: "non-realise", label: `Non réalisés (${fmtInt(nonRealises)})` },
            ]}
          />
        </div>
      )}

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des alcootests…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable rows={data.items} rowKey={(t) => t.id} empty={annules ? "Aucun alcootest annulé pour ces filtres." : "Aucun alcootest pour ces filtres."} columns={colonnes} />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="alcootests" onPage={(o) => setPosition({ cle, offset: o })} />
          </>
        )}
      </Card>

      {annulation && (
        <FenetreAnnulation
          t={annulation}
          onClose={() => setAnnulation(null)}
          onAnnule={() => {
            setMessage(`Alcootest de ${annulation.driver.name} annulé : il sort du verrou et des indicateurs.`);
            setAnnulation(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

/** Annulation d'un alcootest saisi par erreur (Responsable HSSEQ) : motif écrit obligatoire, journalisé. */
function FenetreAnnulation({ t, onClose, onAnnule }: { t: BreathTestDetail; onClose: () => void; onAnnule: () => void }) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  return (
    <Modal
      open
      title={`Annuler l'alcootest de ${t.driver.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Retour</Button>
          <Button
            variant="danger"
            loading={envoi}
            disabled={!motif.trim()}
            onClick={async () => {
              setEnvoi(true);
              setErreur(null);
              try {
                await apiSend("POST", `/hsseq/breath-tests/${t.id}/cancel`, { reason: motif.trim() });
                onAnnule();
              } catch (e) {
                setErreur(messageErreur(e, "Annulation impossible."));
              } finally {
                setEnvoi(false);
              }
            }}
          >
            Annuler l&apos;alcootest
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-ink-2">
          Test du {fmtDateTime(t.reported_at)}
          {t.rotation ? `, ${nomRotation(t.rotation)}` : ", sans rotation"}. Annulé, il sort du verrou (V03) et des indicateurs ; un conducteur retiré par un positif est rétabli sur la rotation encore saisie.
        </p>
        <Field label="Motif de l'annulation (obligatoire)">
          <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Saisie erronée : conducteur, rotation ou résultat." />
        </Field>
        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </div>
    </Modal>
  );
}

const estDetail = (t: BreathTest): t is BreathTestDetail => t.access === "detail";

/**
 * Colonnes selon le niveau de lecture ; chaque ligne n'affiche que ce que le noyau lui a servi.
 * `onAnnuler` ajoute la commande d'annulation (Responsable HSSEQ, tests en vigueur).
 */
function colonnesSelon(niveau: Lecture, onAnnuler?: (t: BreathTestDetail) => void): Column<BreathTest>[] {
  const conducteur: Column<BreathTest> = { key: "driver", label: "Conducteur", sortValue: (t) => t.driver.name, render: (t) => t.driver.name };
  const rotation: Column<BreathTest> = { key: "rotation", label: "Rotation", sortValue: (t) => t.rotation?.date_loading ?? null, render: (t) => <span className="whitespace-nowrap">{nomRotation(t.rotation)}</span> };

  if (niveau === "done") {
    return [
      conducteur,
      rotation,
      { key: "done", label: "Test", render: (t) => (t.access === "done" ? <Tampon mot={ALCOOTEST_FAIT[t.done ? "true" : "false"]} /> : null) },
      { key: "done_at", label: "Heure", render: (t) => (t.access === "done" && t.done_at ? fmtDateTime(t.done_at) : <span className="text-muted">–</span>) },
    ];
  }

  const statut: Column<BreathTest> = {
    key: "status",
    label: "Statut",
    sortValue: (t) => (t.access === "done" ? null : t.status),
    render: (t) => (t.access === "done" ? <Tampon mot={ALCOOTEST_FAIT[t.done ? "true" : "false"]} /> : <Tampon mot={STATUT_ALCOOTEST[t.status]} />),
  };

  if (niveau === "status") {
    return [{ key: "date", label: "Date", sortValue: (t) => (t.access === "done" ? t.done_at : t.date), render: (t) => <span className="whitespace-nowrap">{fmtDate(t.access === "done" ? t.done_at : t.date)}</span> }, conducteur, rotation, statut];
  }

  return [
    { key: "reported_at", label: "Saisi le", sortValue: (t) => (estDetail(t) ? t.reported_at : null), render: (t) => (estDetail(t) ? <Saisie s={t} /> : fmtDate(t.access === "status" ? t.date : t.done_at)) },
    conducteur,
    rotation,
    {
      key: "result",
      label: "Résultat",
      sortValue: (t) => (t.access === "done" ? null : t.status),
      render: (t) =>
        estDetail(t) ? (
          <span className="inline-flex flex-col items-start gap-1">
            <Tampon mot={!t.performed ? "Non réalisé" : t.result === "positive" ? "Positif" : "Négatif"} />
            {!t.performed && t.not_done_reason && <span className="max-w-[28ch] text-[12px] leading-snug text-muted">{t.not_done_reason}</span>}
          </span>
        ) : (
          statut.render?.(t)
        ),
    },
    {
      key: "reading",
      label: "Taux (mg/L)",
      align: "right",
      sortValue: (t) => (estDetail(t) ? t.reading_mg_l : null),
      render: (t) => (estDetail(t) && t.reading_mg_l !== null ? <span className={t.result === "positive" ? "font-semibold text-danger" : undefined}>{fmtFixe(t.reading_mg_l, 2)}</span> : <span className="text-muted">–</span>),
    },
    { key: "device", label: "Appareil", render: (t) => (estDetail(t) && t.device ? t.device : <span className="text-muted">–</span>) },
    { key: "performed_by", label: "Réalisé par", sortValue: (t) => (estDetail(t) ? (t.performed_by?.name ?? null) : null), render: (t) => (estDetail(t) && t.performed_by ? t.performed_by.name : <span className="text-muted">–</span>) },
    {
      key: "suite",
      label: "Suite",
      render: (t) =>
        estDetail(t) && t.cancelled ? (
          <span className="inline-flex max-w-[30ch] flex-col text-[12.5px] leading-snug">
            <span className="font-semibold text-ink">Annulé{t.cancelled_at ? ` le ${fmtDateTime(t.cancelled_at)}` : ""}</span>
            <span className="text-muted">
              {t.cancelled_by ? `${t.cancelled_by.name} : ` : ""}
              {t.cancel_reason ?? "sans motif lu"}
            </span>
          </span>
        ) : estDetail(t) && t.driver_removed ? (
          <span className="text-[12.5px] font-semibold text-danger">Conducteur retiré de la rotation</span>
        ) : (
          <span className="text-muted">–</span>
        ),
    },
    ...(onAnnuler
      ? [
          {
            key: "commandes",
            label: "",
            render: (t: BreathTest) =>
              estDetail(t) && !t.cancelled ? (
                <Button size="sm" variant="ghost" onClick={() => onAnnuler(t)} aria-label={`Annuler l'alcootest de ${t.driver.name} du ${fmtDateTime(t.reported_at)}`}>
                  Annuler l&apos;alcootest
                </Button>
              ) : null,
          } satisfies Column<BreathTest>,
        ]
      : []),
  ];
}
