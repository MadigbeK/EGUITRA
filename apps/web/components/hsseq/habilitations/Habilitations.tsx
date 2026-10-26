"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search, X } from "@/components/icons";
import { Button, Card, ErrorBox, Etat, Field, Input, Kpi, Notice, Segmented, Select, Squelette, Tabs } from "@/components/ui";
import { Bascule, ChampSite, aProfil, requete, useAdresse, useReferentiels } from "@/components/hsseq/actions/outils";
import { useApi, useAutorise } from "@/lib/api-client";
import { INSECABLE, fmtDate, fmtInt, fmtPct, pluriel } from "@/lib/format";
import { Alertes, type NatureAlertes } from "./Alertes";
import { Legende, Matrice } from "./Matrice";
import { etatLigne, parUrgence, profilsExiges } from "./outils";
import type { QualificationMatrix, QualificationStatus } from "./types";

type Vue = "matrice" | "alertes";
type FiltreEtat = "tous" | QualificationStatus;
type Ordre = "urgence" | "nom";

const ETATS: readonly QualificationStatus[] = ["valid", "to_renew", "expired", "missing"];
const NATURES: readonly NatureAlertes[] = ["toutes", "personnes", "aptitude", "vehicules"];
/** Mots du filtre d'état, au pluriel (habilitations ou conducteurs). */
const MOT_FILTRE: Record<QualificationStatus, string> = { valid: "Valides", to_renew: "À renouveler", expired: "Échues", missing: "Absentes" };

/** Profils qui lisent les alertes envoyées (ALERTS_READ du noyau) : jamais le chef de parc. */
const LECTEURS_ALERTES = ["admin", "direction", "hsseq", "rh"] as const;
/** Profils qui ouvrent la gestion de NIMOVA · RH, où se saisissent les habilitations. */
const GESTION_RH = ["admin", "direction", "rh"] as const;
/** Profils qui règlent les habilitations exigées par profil de véhicule (CONFIG du noyau). */
const PARAMETRAGE = ["admin", "hsseq"] as const;
/** Au-delà, la matrice est servie par pages : 500 conducteurs couvrent largement les deux sociétés. */
const LIMITE = 500;

/**
 * Personnel et habilitations (§3, §9.3) : matrice des compétences des conducteurs tenue par RH, en
 * lecture seule. Site, habilitation et jour de la situation sont demandés au noyau ; l'état, le départ
 * refusé, la recherche et l'ordre se filtrent à l'écran, sur les nombres que le noyau sert pour la
 * sélection. Filtres et vue portés par l'adresse (vue, site, type, date, etat, bloques=1, q, ordre,
 * nature). Les alertes d'échéance envoyées ne sont pas montrées au chef de parc.
 */
export function Habilitations() {
  const { lire, ecrire } = useAdresse();
  const { data: ref } = useReferentiels();
  const alertesOuvertes = useAutorise(LECTEURS_ALERTES);
  const gestionRh = useAutorise(GESTION_RH);
  const parametrage = useAutorise(PARAMETRAGE);
  const vue: Vue = lire("vue") === "alertes" && alertesOuvertes ? "alertes" : "matrice";
  const nature: NatureAlertes = (NATURES as readonly string[]).includes(lire("nature")) ? (lire("nature") as NatureAlertes) : "toutes";

  const site = lire("site");
  const type = lire("type");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(lire("date")) ? lire("date") : "";
  const etat: FiltreEtat = (ETATS as readonly string[]).includes(lire("etat")) ? (lire("etat") as QualificationStatus) : "tous";
  const bloques = lire("bloques") === "1";
  const recherche = lire("q");
  const ordre: Ordre = lire("ordre") === "nom" ? "nom" : "urgence";

  const { data, error, isLoading, mutate } = useApi<QualificationMatrix>(`/hsseq/qualifications?${requete({ site_id: site || null, type: type || null, date: date || null, limit: LIMITE })}`, { keepPreviousData: true });
  // Liste complète des habilitations pour le filtre, quand la matrice n'en montre qu'une.
  const { data: catalogue } = useApi<QualificationMatrix>(type ? `/hsseq/qualifications?${requete({ limit: 1 })}` : null);
  const tousTypes = (type ? catalogue?.types : data?.types) ?? data?.types ?? [];
  const { data: alertes } = useApi<unknown[]>(alertesOuvertes ? "/hsseq/qualifications/alerts" : null);

  const lignes = useMemo(() => {
    if (!data) return [];
    const q = recherche.trim().toLocaleLowerCase("fr");
    const garde = data.items.filter((r) => (etat === "tous" || etatLigne(r, type) === etat) && (!bloques || r.blocking) && (!q || r.employee.name.toLocaleLowerCase("fr").includes(q)));
    return [...garde].sort(ordre === "nom" ? (a, b) => a.employee.name.localeCompare(b.employee.name, "fr") : parUrgence(type));
  }, [data, etat, type, bloques, recherche, ordre]);

  // Nombres du filtre d'état : état de l'habilitation choisie, sinon état d'ensemble, sur toute la sélection.
  const parEtat = useMemo(() => {
    const n: Record<QualificationStatus, number> = { valid: 0, to_renew: 0, expired: 0, missing: 0 };
    for (const r of data?.items ?? []) n[etatLigne(r, type)] += 1;
    return n;
  }, [data, type]);

  const lectureComplete = aProfil(ref, "admin", "direction", "hsseq", "rh");
  const nomType = tousTypes.find((t) => t.code === type)?.name;
  const filtresActifs = Boolean(site || type || date || etat !== "tous" || bloques || recherche);
  const effacer = () => ecrire({ site: null, type: null, date: null, etat: null, bloques: null, q: null });

  return (
    <div className="space-y-5">
      <Notice tone="neutral">
        Les habilitations et l&apos;aptitude médicale se saisissent dans NIMOVA · RH, sur la fiche du salarié : HSSEQ les lit, sans pièce justificative et sans aucun détail médical. L&apos;aptitude n&apos;apparaît qu&apos;en statut.
        {gestionRh && (
          <>
            {" "}
            <Link href="/rh/salaries" className="inline-flex items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline">
              Salariés dans NIMOVA · RH <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </>
        )}{" "}
        Une habilitation est exigée des conducteurs de citerne, de benne ou des deux, selon les règles d&apos;HSSEQ&nbsp;; sans règle, l&apos;obligation de RH vaut pour les deux profils.
        {parametrage && (
          <>
            {" "}
            <Link href="/hsseq/parametres?onglet=habilitations" className="inline-flex items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline">
              Habilitations exigées <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </>
        )}
      </Notice>

      <Chiffres data={data} enAttente={!data && isLoading} />

      {(alertesOuvertes || vue === "alertes") && (
        <Tabs
          value={vue}
          onChange={(v) => ecrire({ vue: v === "matrice" ? null : v })}
          tabs={[
            { key: "matrice", label: "Matrice des compétences", count: data?.counts.drivers },
            { key: "alertes", label: "Alertes d'échéance", count: alertes?.length },
          ]}
        />
      )}

      {vue === "alertes" ? (
        <Alertes nature={nature} onNature={(n) => ecrire({ nature: n === "toutes" ? null : n })} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Recherche valeur={recherche} onChange={(q) => ecrire({ q })} />
            <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v })} />
            <Field label="Habilitation" className="w-full sm:w-60">
              <Select
                value={type}
                onChange={(e) => ecrire({ type: e.target.value, etat: null })}
                placeholder="Toutes"
                options={tousTypes.map((t) => {
                  const profils = profilsExiges(t);
                  return { value: t.code, label: profils ? `${t.name} (exigée : ${profils})` : t.name };
                })}
              />
            </Field>
            <Field label="Situation au" className="w-full sm:w-44">
              <Input type="date" value={date || data?.date || ""} onChange={(e) => ecrire({ date: e.target.value })} />
            </Field>
            <Bascule actif={bloques} onChange={(v) => ecrire({ bloques: v ? "1" : null })} nombre={data?.counts.blocking}>
              Départ refusé
            </Bascule>
            {filtresActifs && (
              <Button variant="ghost" size="sm" className="mb-0.5" onClick={effacer}>
                <X className="h-3.5 w-3.5" /> Effacer les filtres
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="-mx-1 max-w-full overflow-x-auto px-1">
              <Segmented
                label={nomType ? `État de l'habilitation « ${nomType} »` : "État d'ensemble des habilitations exigées"}
                value={etat}
                onChange={(e) => ecrire({ etat: e === "tous" ? null : e })}
                options={[
                  { key: "tous", label: `Tous (${fmtInt(data?.items.length ?? 0)})` },
                  ...ETATS.map((s) => ({ key: s, label: `${MOT_FILTRE[s]} (${fmtInt(parEtat[s])})` })),
                ]}
              />
            </div>
            <Segmented
              label="Ordre des conducteurs"
              value={ordre}
              onChange={(o) => ecrire({ ordre: o === "urgence" ? null : o })}
              options={[
                { key: "urgence", label: "Urgence" },
                { key: "nom", label: "Nom" },
              ]}
            />
          </div>
          {data && (
            <p className="text-[12.5px] leading-snug text-muted">
              {nomType ? `État de l'habilitation « ${nomType} » au ${fmtDate(data.date)}.` : `État d'ensemble au ${fmtDate(data.date)} : le plus grave des habilitations exigées pour le profil de l'ensemble du conducteur.`}
              {!lectureComplete && ref ? " Conducteurs des ensembles de vos sites." : ""}
              {date ? " Les échéances et le départ sont recalculés à cette date." : ""}
            </p>
          )}

          <Card padded={false}>
            {!data ? (
              <Etat error={error} onRetry={() => void mutate()} label="Chargement de la matrice des compétences…" />
            ) : (
              <>
                {error && (
                  <div className="p-4">
                    <ErrorBox error={error} onRetry={() => void mutate()} />
                  </div>
                )}
                {lignes.length === 0 ? (
                  <Vide total={data.items.length} filtres={filtresActifs} lectureComplete={lectureComplete} />
                ) : (
                  <Matrice lignes={lignes} types={data.types} />
                )}
                {data.total_count > data.items.length && (
                  <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">
                    Les {fmtInt(data.items.length)} premiers conducteurs sur {fmtInt(data.total_count)} : choisissez un site pour voir les autres.
                  </p>
                )}
              </>
            )}
          </Card>
          <Legende />
        </div>
      )}
    </div>
  );
}

/** Chiffres clés de la sélection (site et jour) : effectif, part sans motif V04, échéances proches, départs refusés. */
function Chiffres({ data, enAttente }: { data: QualificationMatrix | undefined; enAttente: boolean }) {
  if (!data) {
    return enAttente ? (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Squelette key={i} className="h-[132px]" />
        ))}
      </div>
    ) : null;
  }
  const c = data.counts;
  const taux = c.drivers ? (c.up_to_date / c.drivers) * 100 : null;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 max-sm:[&_.kpi]:px-3.5 max-sm:[&_.kpi_.font-display]:text-[22px]">
      <Kpi label="Conducteurs en poste" value={fmtInt(c.drivers)} hint="Salariés RH liés à un chauffeur" />
      <Kpi
        label="Habilitations à jour"
        value={taux === null ? "–" : fmtPct(taux, 1)}
        tone={taux === null ? "neutral" : taux >= 100 ? "ok" : "danger"}
        hint={`${fmtInt(c.up_to_date)} sur ${pluriel(c.drivers, "conducteur")} sans motif V04 ; cible 100${INSECABLE}%`}
      />
      <Kpi label="À renouveler" value={fmtInt(c.by_status.to_renew)} tone={c.by_status.to_renew > 0 ? "warn" : "neutral"} hint="Habilitation exigée à échéance dans les 30 jours" />
      <Kpi label="Départ refusé (V04)" value={fmtInt(c.blocking)} tone={c.blocking > 0 ? "danger" : "ok"} hint="Exigée échue, aptitude inapte ou échue" />
    </div>
  );
}

/** État vide de la matrice : filtres trop serrés, ou aucun conducteur sur le périmètre du compte. */
function Vide({ total, filtres, lectureComplete }: { total: number; filtres: boolean; lectureComplete: boolean }) {
  if (total > 0 || filtres) return <Etat data={[]} vide={{ title: "Aucun conducteur pour ces filtres.", hint: "Changez l'état, la recherche ou le site." }} />;
  return (
    <Etat
      data={[]}
      vide={
        lectureComplete
          ? { title: "Aucun conducteur en poste.", hint: "Un conducteur apparaît ici dès que son dossier salarié RH est lié à un chauffeur de Transport." }
          : { title: "Aucun conducteur sur vos sites.", hint: "Le site d'un conducteur est celui de l'ensemble dont il est le chauffeur habituel ; les sites se rattachent dans les paramètres d'HSSEQ." }
      }
    />
  );
}

/** Recherche dans les noms, posée dans l'adresse après une courte pause de frappe. */
function Recherche({ valeur, onChange }: { valeur: string; onChange: (q: string) => void }) {
  const [texte, setTexte] = useState(valeur);
  const [vue, setVue] = useState(valeur);
  // L'adresse a changé ailleurs (lien, filtres effacés) : le champ la suit.
  if (vue !== valeur) {
    setVue(valeur);
    setTexte(valeur);
  }
  useEffect(() => {
    if (texte.trim() === valeur) return;
    const minute = setTimeout(() => onChange(texte.trim()), 300);
    return () => clearTimeout(minute);
  }, [texte, valeur, onChange]);
  return (
    <Field label="Rechercher" className="w-full sm:w-60">
      <span className="relative block">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input type="search" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Nom du conducteur" className="pl-9" />
      </span>
    </Field>
  );
}
