"use client";

import { useState } from "react";
import { Pencil, Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Etat, Loading, Notice, ProgressBar, cx, type Column, type Tri } from "@/components/ui";
import { AvecFiche, Bascule, ChampSite, Definitions, Pages, Panneau, Rubrique, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { Commandes, useEtroit } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtPct } from "@/lib/format";
import type { Page } from "@/lib/hsseq-types";
import { ChampsPeriode, Chiffre, ExportRegistres, Historique, Situation, TamponEnv, filtresCommuns, fmtPoussiere, nombre, useRafraichir, type Droits, type Message, type VueProps } from "./commun";
import { FenetreMesure } from "./fenetres";
import type { DustCounts, DustInput, DustMeasure, DustMeasureDetail } from "./types";

const PAR_PAGE = 50;
const TRIS = ["measured_on", "value"];

/** Part du seuil atteinte par une mesure, en pourcentage. */
const partDuSeuil = (m: Pick<DustMeasure, "value" | "threshold">) => (m.threshold ? (m.value * 100) / m.threshold : 0);

/** Résultat d'une mesure en toutes lettres. */
const resultat = (m: Pick<DustMeasure, "exceeded">) => (m.exceeded ? "Seuil dépassé" : "Sous le seuil");

/** Valeur au regard du seuil : la jauge se remplit jusqu'au seuil, en alerte au-delà. */
function Jauge({ m }: { m: DustMeasure }) {
  const part = partDuSeuil(m);
  return (
    <span className="flex min-w-[8rem] items-center gap-2.5">
      <span className="min-w-0 flex-1">
        <ProgressBar value={part} tone={m.exceeded ? "danger" : "accent"} epaisseur={6} />
      </span>
      <span className={cx("w-12 text-right text-[12px] font-semibold tabular", m.exceeded ? "text-danger" : "text-muted")}>{fmtPct(part, 0)}</span>
    </span>
  );
}

/**
 * Poussières mesurées sur site (GET /hsseq/dust-measurements) : mesures et dépassements en tête,
 * filtres « dépassements seulement », site et période, portés par l'adresse avec la mesure ouverte
 * (mesure), lue dans sa fiche (GET /hsseq/dust-measurements/{id}, avec son historique). Le Responsable
 * HSSEQ et le chef de parc (ses sites) saisissent et corrigent les mesures ; le noyau calcule le
 * dépassement.
 */
export function Poussieres({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const etroit = useEtroit();
  const rafraichir = useRafraichir();
  const { site, du, au, api } = filtresCommuns(lire);
  const depassements = lire("depassements") === "1";
  const choisi = Number(lire("mesure")) || null;
  const [tri, setTri] = useState<Tri>({ key: "measured_on", dir: -1 });
  const filtres = { ...api, exceeded: depassements ? 1 : null };
  const cle = `${requete(filtres)}|${tri.key}|${tri.dir}`;
  const [position, setPosition] = useState({ cle, offset: 0 });
  const offset = position.cle === cle ? position.offset : 0;
  const [saisir, setSaisir] = useState(false);

  // Nombres sur le site et la période, dépassements ou non (situation, bascule) ; liste filtrée.
  const { data: compte } = useApi<Page<DustMeasure, DustCounts>>(`/hsseq/dust-measurements?${requete({ ...api, limit: 1 })}`, { keepPreviousData: true });
  const { data, error, mutate } = useApi<Page<DustMeasure, DustCounts>>(
    `/hsseq/dust-measurements?${requete({ ...filtres, sort: `${tri.dir === -1 ? "-" : ""}${tri.key}`, offset, limit: PAR_PAGE })}`,
    { keepPreviousData: true },
  );
  const total = compte?.total_count;
  const depasses = compte?.counts.exceeded;
  const compact = etroit || choisi !== null;

  const colonnes: Column<DustMeasure>[] = [
    {
      key: "measured_on",
      label: "Mesure",
      render: (m) => (
        <span className={cx("block min-w-[12rem] max-w-[42ch]", choisi === m.id && "font-medium")}>
          <span className="block text-ink">{m.point ?? "Point non précisé"}</span>
          {choisi === m.id && <span className="sr-only"> (mesure ouverte)</span>}
          <span className="mt-0.5 block text-[12px] leading-snug text-muted">
            Le {fmtDate(m.measured_on)}, {m.site.name}
          </span>
        </span>
      ),
    },
    {
      key: "value",
      label: "Valeur",
      align: "right",
      render: (m) => (
        <span className="inline-flex flex-col items-end">
          <span className={cx("font-semibold", m.exceeded ? "text-danger" : "text-ink")}>{fmtPoussiere(m.value, m.unit)}</span>
          <span className="text-[12px] text-muted">seuil {fmtPoussiere(m.threshold, m.unit)}</span>
        </span>
      ),
    },
    ...(compact ? [] : [{ key: "part", label: "Au regard du seuil", render: (m: DustMeasure) => <Jauge m={m} /> }]),
    { key: "exceeded", label: "Résultat", render: (m) => <TamponEnv mot={resultat(m)} /> },
  ];

  const liste = (
    <div className="space-y-5">
      <Situation label="Situation des poussières" colonnes={3}>
        <Chiffre valeur={nombre(total)}>{(total ?? 0) > 1 ? "mesures" : "mesure"} {du || au ? "sur la période" : "au registre"}</Chiffre>
        <Chiffre valeur={nombre(depasses)} ton={(depasses ?? 0) > 0 ? "danger" : undefined} actif={depassements} onClick={() => ecrire({ depassements: depassements ? null : "1" })}>
          {(depasses ?? 0) > 1 ? "dépassements du seuil" : "dépassement du seuil"}
        </Chiffre>
        <Chiffre valeur={total ? fmtPct(((depasses ?? 0) * 100) / total, 1) : "–"}>des mesures au-dessus de leur seuil</Chiffre>
      </Situation>

      <div className="flex flex-wrap items-end gap-3">
        <Bascule actif={depassements} onChange={(v) => ecrire({ depassements: v ? "1" : null })} nombre={depasses}>
          Dépassements seulement
        </Bascule>
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
        <ChampsPeriode du={du} au={au} ecrire={ecrire} libelleDu="Mesurées du" />
        {droits.terrain && (
          <Button variant="primary" className="ml-auto" onClick={() => setSaisir(true)}>
            <Plus className="h-4 w-4" /> Saisir une mesure
          </Button>
        )}
        <ExportRegistres filtres={filtres} className={droits.terrain ? undefined : "ml-auto"} />
      </div>

      <p className="text-[12.5px] leading-snug text-muted">Chaque mesure porte son seuil, dans son unité : celui de l&apos;autorisation du site ou du donneur d&apos;ordre. Le dépassement est calculé à l&apos;enregistrement.</p>

      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des mesures de poussières…" />
        ) : (
          <>
            {error && (
              <div className="p-4">
                <ErrorBox error={error} onRetry={() => void mutate()} />
              </div>
            )}
            <DataTable
              rows={data.items}
              rowKey={(m) => m.id}
              sort={tri}
              onSort={(t) => {
                if (TRIS.includes(t.key)) setTri(t);
              }}
              onRowClick={(m) => ecrire({ mesure: m.id })}
              empty={depassements ? "Aucun dépassement du seuil pour ces filtres." : site || du || au ? "Aucune mesure pour ces filtres." : "Aucune mesure de poussières saisie."}
              columns={colonnes}
            />
            <Pages offset={data.offset} limit={data.limit} total={data.total_count} nom="mesures" onPage={(x) => setPosition({ cle, offset: x })} />
          </>
        )}
      </Card>

      {saisir && (
        <FenetreMesure
          droits={droits}
          onClose={() => setSaisir(false)}
          envoyer={async (corps) => {
            const m = await apiSend<DustMeasure>("POST", "/hsseq/dust-measurements", corps);
            await mutate();
            void rafraichir();
            setPosition({ cle, offset: 0 });
            ecrire({ mesure: m.id, depassements: depassements && !m.exceeded ? null : depassements ? "1" : null });
          }}
        />
      )}
    </div>
  );

  return (
    <AvecFiche
      ouverte={choisi !== null}
      liste={liste}
      fiche={choisi !== null && <FicheMesure key={choisi} id={choisi} droits={droits} onFermer={() => ecrire({ mesure: null })} />}
    />
  );
}

/**
 * Fiche d'une mesure (GET /hsseq/dust-measurements/{id}), qu'elle soit ou non dans la page affichée :
 * valeur au regard du seuil, point, méthode, observations, historique (auteurs par leur fonction pour
 * l'auditeur) ; modification (hsseq ou chef de parc du site, `rights.can_edit`), puis la fiche et les
 * listes relues (la modification ne renvoie que la ligne, sans historique).
 */
function FicheMesure({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/dust-measurements/${id}`;
  const { data: m, error, mutate } = useApi<DustMeasureDetail>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [modifier, setModifier] = useState(false);

  if (!m) {
    return (
      <Panneau etiquette="Poussières sur site" titre="Mesure" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de la mesure…" />}
      </Panneau>
    );
  }
  const part = partDuSeuil(m);
  return (
    <Panneau etiquette="Poussières sur site" titre={`Mesure du ${fmtDate(m.measured_on)}`} sousTitre={`${m.site.name}${m.point ? `, ${m.point}` : ""}`} onFermer={onFermer} tampons={<TamponEnv mot={resultat(m)} />}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div>
        <p className="text-[15px] leading-relaxed text-ink">
          <span className={cx("font-semibold", m.exceeded && "text-danger")}>{fmtPoussiere(m.value, m.unit)}</span> pour un seuil de <span className="font-semibold">{fmtPoussiere(m.threshold, m.unit)}</span>, soit {fmtPct(part, 0)} du seuil.
        </p>
        <div className="mt-2">
          <ProgressBar value={part} tone={m.exceeded ? "danger" : "accent"} />
        </div>
      </div>

      <Commandes>
        {m.rights.can_edit && (
          <Button onClick={() => setModifier(true)}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
      </Commandes>

      {m.exceeded && <Notice tone="warn">Seuil dépassé : la mesure compte dans les dépassements du cockpit et du rapport mensuel.</Notice>}

      <Definitions
        lignes={[
          ["Site", m.site.name],
          ["Point de mesure", m.point ?? "Non précisé"],
          ["Mesurée le", fmtDate(m.measured_on)],
          ["Appareil ou méthode", m.method ?? "Non précisé"],
          m.measured_by && ["Saisie par", m.measured_by.name],
          ["Société", m.company.name],
        ]}
      />
      {m.note && (
        <Rubrique titre="Observations">
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{m.note}</p>
        </Rubrique>
      )}

      <Historique lignes={m.history} anonyme={droits.anonyme} />

      {modifier && (
        <FenetreMesure
          mesure={m}
          droits={droits}
          onClose={() => setModifier(false)}
          envoyer={async (corps: DustInput) => {
            await apiSend<DustMeasure>("PATCH", cle, corps);
            // La réponse est la ligne seule : la fiche est relue pour son historique.
            await mutate();
            void rafraichir(cle);
            setMessage({ tone: "ok", text: "Mesure mise à jour." });
          }}
        />
      )}
    </Panneau>
  );
}
