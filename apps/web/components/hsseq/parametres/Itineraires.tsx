"use client";

/**
 * Paramètres HSSEQ, « Itinéraires » : règles des plans de trajet (motif V08 du verrou de départ). Plage
 * de nuit et conduite prévue au plus par jour, paramètres de la société (GET et PATCH /hsseq/settings) ;
 * routes de Transport où la circulation de nuit est interdite (GET /hsseq/routes, PATCH
 * /hsseq/routes/{id}). Écriture : administration et Responsable HSSEQ. Un plan de trajet qui prévoit de
 * rouler de nuit sur une route interdite, ou au-delà du maximum un jour donné, ouvre V08, même validé.
 */

import { useState } from "react";
import { Button, Card, DataTable, Etat, Field, Input, Notice, Select, cx, demanderConfirmation } from "@/components/ui";
import { Tampon, texteErreur } from "@/components/hsseq/commun";
import { duree, heureDuJour, lireNombre, versSaisie } from "@/components/hsseq/trajets/outils";
import type { HsseqRoute, HsseqRoutePatch, JourneyRules, JourneySettings } from "@/components/hsseq/trajets/types";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { fmtInt } from "@/lib/format";
import type { Me } from "@/lib/types";

type CleRegle = keyof JourneyRules;

/** Règles par défaut du noyau, proposées en grisé quand le serveur ne les sert pas. */
const DEFAUTS: JourneyRules = { night_start_hour: 19, night_end_hour: 6, max_driving_hours: 9 };

const CHAMPS: Array<{ cle: CleRegle; label: string; aide: string }> = [
  { cle: "night_start_hour", label: "Nuit à partir de (heure)", aide: "Heure de Conakry ; 19,5 pour 19 h 30." },
  { cle: "night_end_hour", label: "Nuit jusqu'à (heure)", aide: "Le lendemain matin quand elle est plus petite." },
  { cle: "max_driving_hours", label: "Conduite prévue au plus (heures par jour)", aide: "Au-delà, un jour donné, le plan n'est pas conforme." },
];

/** Champs nommés par un refus du noyau, en clair. */
const CHAMP: Record<string, string> = { night_start_hour: "début de la nuit", night_end_hour: "fin de la nuit", max_driving_hours: "conduite prévue au plus", night_driving_forbidden: "circulation de nuit" };

function refus(e: unknown): string {
  if (e instanceof ApiError && (e.body.error === "missing_fields" || e.body.error === "invalid_parameter") && e.body.fields?.length) {
    return `${(e.body.message || "Saisie refusée").replace(/[.\s]+$/, "")}, champs en cause : ${[...new Set(e.body.fields.map((f) => CHAMP[f] ?? f))].join(", ")}.`;
  }
  return texteErreur(e, { forbidden: "Les itinéraires et leurs règles se paramètrent par l'administration et le Responsable HSSEQ." }, "Une erreur est survenue.");
}

/**
 * Règles lues dans les paramètres : le noyau sert nul pour une valeur à 0 (minuit, pas de maximum) ;
 * une clé absente veut dire que le serveur ne porte pas encore ces règles.
 */
function reglesLues(s: JourneySettings): Partial<JourneyRules> {
  const r: Partial<JourneyRules> = {};
  for (const { cle } of CHAMPS) if (s[cle] !== undefined) r[cle] = s[cle] ?? 0;
  return r;
}

export function Itineraires() {
  const { data: me } = useApi<Me>("/auth/me");
  const [societe, setSociete] = useState<number | null>(null);
  const choisie = societe ?? me?.company_id ?? null;
  const filtre = choisie ? `?company_id=${choisie}` : "";
  const reglages = useApi<JourneySettings>(me ? `/hsseq/settings${filtre}` : null);
  const routes = useApi<HsseqRoute[]>(me ? `/hsseq/routes${filtre}` : null);
  const ecriture = useAutorise(["admin", "hsseq"]);
  const societes = me?.companies ?? [];
  const lues = reglages.data ? reglesLues(reglages.data) : {};
  const regles: JourneyRules = { ...DEFAUTS, ...lues };

  return (
    <div className="space-y-5">
      {societes.length > 1 && (
        <Field label="Société" className="w-full sm:w-80">
          <Select value={choisie ?? ""} onChange={(e) => setSociete(Number(e.target.value))} options={societes.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
      )}

      {/* Une saisie par société : le message d'enregistrement survit à la relecture des paramètres. */}
      <Card title="Règles des plans de trajet">
        <Etat data={reglages.data} error={reglages.error} onRetry={() => void reglages.mutate()} label="Chargement des règles…">
          {(s) => <Regles key={s.company.id} s={s} ecriture={ecriture} onEnregistre={(maj) => void reglages.mutate(maj, { revalidate: false })} />}
        </Etat>
      </Card>

      <Routes liste={routes.data} erreur={routes.error} onRetry={() => void routes.mutate()} regles={regles} ecriture={ecriture} onMaj={(maj) => void routes.mutate((l) => l?.map((x) => (x.id === maj.id ? { ...x, night_driving_forbidden: maj.night_driving_forbidden } : x)), { revalidate: false })} />
    </div>
  );
}

/** Plage de nuit et conduite prévue au plus par jour : lecture, puis saisie pour l'administration et le Responsable HSSEQ. */
function Regles({ s, ecriture, onEnregistre }: { s: JourneySettings; ecriture: boolean; onEnregistre: (s: JourneySettings) => void }) {
  const lues = reglesLues(s);
  const servies = CHAMPS.every(({ cle }) => lues[cle] !== undefined);
  const initial = Object.fromEntries(CHAMPS.map(({ cle }) => [cle, versSaisie(lues[cle])])) as Record<CleRegle, string>;
  const [b, setB] = useState(initial);
  const [erreur, setErreur] = useState<unknown>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const valeurs = Object.fromEntries(CHAMPS.map(({ cle }) => [cle, lireNombre(b[cle])])) as Record<CleRegle, number | null>;
  const fautes: Partial<Record<CleRegle, string>> = {};
  for (const cle of ["night_start_hour", "night_end_hour"] as const) {
    const v = valeurs[cle];
    if (b[cle].trim() !== "" && (v === null || v < 0 || v >= 24)) fautes[cle] = "Heure de 0 à 23,5.";
  }
  if (!fautes.night_start_hour && !fautes.night_end_hour && valeurs.night_start_hour !== null && valeurs.night_start_hour === valeurs.night_end_hour) fautes.night_end_hour = "La nuit finit à une autre heure qu'elle ne commence.";
  const max = valeurs.max_driving_hours;
  if (b.max_driving_hours.trim() !== "" && (max === null || max < 0 || max > 24)) fautes.max_driving_hours = "Heures de 0 à 24.";
  const modifies = CHAMPS.filter(({ cle }) => b[cle].trim() !== "" && valeurs[cle] !== null && valeurs[cle] !== (lues[cle] ?? null)).map(({ cle }) => cle);
  const pret = modifies.length > 0 && Object.keys(fautes).length === 0;

  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      const corps: Partial<JourneyRules> & { company_id: number } = { company_id: s.company.id };
      for (const cle of modifies) corps[cle] = valeurs[cle] ?? 0;
      const maj = await apiSend<JourneySettings>("PATCH", "/hsseq/settings", corps);
      const recues = reglesLues(maj);
      setMessage(
        modifies.every((cle) => recues[cle] !== undefined)
          ? { tone: "ok", texte: `Règles des plans de trajet enregistrées pour ${maj.company.name}.` }
          : { tone: "warn", texte: "Le serveur n'a pas pris en compte ces règles : elles restent celles qu'il applique par défaut." },
      );
      onEnregistre(maj);
    } catch (e) {
      setErreur(e);
    } finally {
      setEnvoi(false);
    }
  }

  const r: JourneyRules = { ...DEFAUTS, ...lues };
  return (
    <div className="space-y-4">
      <p className="max-w-[90ch] text-[13px] leading-relaxed text-muted">
        {servies
          ? `Nuit de ${heureDuJour(r.night_start_hour)} à ${heureDuJour(r.night_end_hour)}, heure de Conakry. ${r.max_driving_hours ? `Conduite prévue au plus ${duree(r.max_driving_hours)} par jour.` : "Pas de maximum de conduite par jour."}`
          : "Le serveur ne sert pas encore ces règles : il applique ses valeurs par défaut, écrites en grisé."}{" "}
        Le noyau compte la conduite prévue d&apos;un plan, arrêts, pauses et repos déduits, jour par jour.
      </p>
      {message && <Notice tone={message.tone}>{message.texte}</Notice>}
      <div className="grid gap-4 sm:grid-cols-3">
        {CHAMPS.map((c) => (
          <Field key={c.cle} label={c.label} hint={c.aide} error={fautes[c.cle]}>
            <Input inputMode="decimal" value={b[c.cle]} disabled={!ecriture} placeholder={versSaisie(DEFAUTS[c.cle])} aria-invalid={fautes[c.cle] ? true : undefined} onChange={(e) => setB({ ...b, [c.cle]: e.target.value })} />
          </Field>
        ))}
      </div>
      {erreur !== null && <Notice tone="danger">{refus(erreur)}</Notice>}
      {ecriture && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setB(initial)} disabled={!modifies.length || envoi}>
            Rétablir
          </Button>
          <Button variant="primary" loading={envoi} disabled={!pret} onClick={() => void enregistrer()}>
            Enregistrer les règles
          </Button>
        </div>
      )}
    </div>
  );
}

/** Routes de Transport et leur règle de nuit, basculée route par route avec confirmation. */
function Routes({ liste, erreur, onRetry, regles, ecriture, onMaj }: { liste: HsseqRoute[] | undefined; erreur: unknown; onRetry: () => void; regles: JourneyRules; ecriture: boolean; onMaj: (maj: HsseqRoutePatch) => void }) {
  const [enCours, setEnCours] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; texte: string } | null>(null);
  const nuit = `${heureDuJour(regles.night_start_hour)} à ${heureDuJour(regles.night_end_hour)}`;
  const interdites = liste?.filter((r) => r.night_driving_forbidden).length ?? 0;

  async function basculer(r: HsseqRoute) {
    const interdire = !r.night_driving_forbidden;
    const ok = await demanderConfirmation(
      interdire
        ? `Un plan de trajet qui prévoit d'y rouler de nuit (de ${nuit}) n'est plus conforme : le motif V08 s'ouvre pour les rotations de cette route pas encore parties, même quand leur plan est validé.`
        : `Un plan de trajet pourra de nouveau prévoir d'y rouler de nuit (de ${nuit}) sans ouvrir le motif V08.`,
      { titre: interdire ? `Interdire la circulation de nuit sur ${r.name} ?` : `Permettre la circulation de nuit sur ${r.name} ?`, action: interdire ? "Interdire de nuit" : "Permettre de nuit", danger: !interdire },
    );
    if (!ok) return;
    setEnCours(r.id);
    setMessage(null);
    try {
      const maj = await apiSend<HsseqRoutePatch>("PATCH", `/hsseq/routes/${r.id}`, { night_driving_forbidden: interdire });
      onMaj(maj);
      setMessage({ tone: "ok", texte: maj.night_driving_forbidden ? `Circulation de nuit interdite sur ${maj.name}.` : `Circulation de nuit permise sur ${maj.name}.` });
    } catch (e) {
      setMessage({ tone: "danger", texte: refus(e) });
    } finally {
      setEnCours(null);
    }
  }

  return (
    <Card padded={false} title="Itinéraires" actions={liste && liste.length > 0 ? <span className="text-[12.5px] text-muted">{`${fmtInt(interdites)} interdit${interdites > 1 ? "s" : ""} de nuit sur ${fmtInt(liste.length)}`}</span> : undefined}>
      <div className="space-y-3 px-6 pb-4">
        <p className="max-w-[90ch] text-[13px] leading-relaxed text-muted">
          Routes tarifées de Transport, créées dans Transport. Sur une route interdite de nuit, un plan de trajet qui prévoit de rouler de {nuit} ouvre le motif V08 et bloque le départ jusqu&apos;à sa correction.
        </p>
        {message && <Notice tone={message.tone}>{message.texte}</Notice>}
      </div>
      <Etat data={liste} error={erreur} onRetry={onRetry} label="Chargement des itinéraires…" vide={{ title: "Aucun itinéraire pour cette société", hint: "Les routes se créent dans Transport, Paramètres." }}>
        {(lignes) => (
          <DataTable
            rows={lignes}
            rowKey={(r) => r.id}
            columns={[
              {
                key: "name",
                label: "Itinéraire",
                sortValue: (r) => r.name,
                render: (r) => (
                  <span className="block min-w-[12rem]">
                    <span className="block font-medium text-ink">{r.name}</span>
                    {r.origin && r.destination && <span className="mt-0.5 block text-[12px] text-muted">{`De ${r.origin} à ${r.destination}`}</span>}
                  </span>
                ),
              },
              { key: "distance_km", label: "Distance (km)", align: "right", sortValue: (r) => r.distance_km, render: (r) => (r.distance_km ? fmtInt(r.distance_km) : "–") },
              {
                key: "night_driving_forbidden",
                label: "Circulation de nuit",
                sortValue: (r) => (r.night_driving_forbidden ? 0 : 1),
                render: (r) =>
                  ecriture ? (
                    <Interrupteur actif={r.night_driving_forbidden} occupe={enCours === r.id} nom={`Circulation de nuit interdite sur ${r.name}`} onBasculer={() => void basculer(r)} />
                  ) : (
                    <Tampon mot={r.night_driving_forbidden ? "Interdite" : "Permise"} />
                  ),
              },
            ]}
          />
        )}
      </Etat>
    </Card>
  );
}

/** Interrupteur accessible (rôle switch), comme celui des motifs du verrou : « Interdite » ou « Permise » écrit à côté. */
function Interrupteur({ actif, occupe, nom, onBasculer }: { actif: boolean; occupe: boolean; nom: string; onBasculer: () => void }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={actif}
        aria-label={nom}
        aria-busy={occupe || undefined}
        disabled={occupe}
        onClick={onBasculer}
        className={cx(
          "relative inline-flex h-6 w-11 flex-none items-center rounded-full border transition-colors duration-200 motion-reduce:transition-none disabled:cursor-wait disabled:opacity-60",
          actif ? "border-accent bg-accent" : "border-line-strong bg-panel-3",
        )}
      >
        <span aria-hidden className={cx("absolute h-[18px] w-[18px] rounded-full bg-panel shadow-[0_1px_2px_rgb(16_36_31/0.25)] transition-transform duration-200 motion-reduce:transition-none", actif ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </button>
      <span aria-hidden className={cx("text-[13px] font-medium", actif ? "text-ink" : "text-muted")}>
        {actif ? "Interdite" : "Permise"}
      </span>
    </span>
  );
}
