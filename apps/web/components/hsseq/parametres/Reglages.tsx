"use client";

import { useState } from "react";
import { Button, Card, Etat, Field, Input, Notice, Select } from "@/components/ui";
import { INDICATEUR } from "@/components/hsseq/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF } from "@/lib/format";
import type { HsseqSettings, HsseqSettingsPatch, IndicatorCode, Referentials } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";
import { champsEnErreur, messageErreur } from "./outils";

/** Cibles proposées par le contrat (§4) et par le noyau au lot 2, servies tant qu'aucune n'est saisie. */
const CIBLES_PROPOSEES: Record<IndicatorCode, number> = {
  frequency_rate: 5,
  severity_rate: 0.2,
  road_accidents_per_mkm: 1.5,
  reporting_ratio: 10,
  check_completion: 100,
  check_compliance: 95,
  breath_test_completion: 100,
  breath_test_positives: 0,
  waivers: 2,
  actions_on_time: 90,
  actions_effectiveness: 80,
  qualifications_valid: 100,
  fuel_consumption: 44,
  co2_emissions: 1.18,
  tanker_shortage: 1.5,
  tipper_variance: 5,
  audits_completion: 100,
  immobilizations: 0,
  spills: 0,
  dust_exceedances: 0,
  complaints: 0,
  complaints_on_time: 100,
  telematics_violations: 5,
  drills_completion: 100,
};

type Dates = "lock_start_date" | "qualifications_required_from" | "employee_file_required_from" | "documents_required_from";
type Nombres =
  | "check_window_hours"
  | "breath_test_window_hours"
  | "level_moderate_min"
  | "level_significant_min"
  | "level_high_min"
  | "investigation_hours_high"
  | "investigation_days_significant"
  | "investigation_days_moderate"
  | "client_notice_hours"
  | "verification_min_criticality"
  | "verification_days"
  | "escalation_days"
  | "costly_action_threshold";

const DATES: Array<{ cle: Dates; label: string; aide: string }> = [
  { cle: "lock_start_date", label: "Verrou de départ en service à partir du", aide: "Rotations chargées à partir de cette date : départ soumis au verrou, validation après le passage « en route ». Vide : pas encore en service." },
  { cle: "qualifications_required_from", label: "Habilitations exigées à partir du", aide: "Avant cette date, une habilitation obligatoire absente est un avertissement ; ensuite elle bloque le départ (V04)." },
  { cle: "employee_file_required_from", label: "Dossier salarié du conducteur exigé à partir du", aide: "Avant cette date, un chauffeur sans dossier salarié RH est un avertissement ; ensuite il bloque (V04)." },
  { cle: "documents_required_from", label: "Documents du véhicule exigés à partir du", aide: "Avant cette date, une assurance ou une visite technique absente est un avertissement ; ensuite elle bloque (V05)." },
];

const GROUPES: Array<{ titre: string; texte: string; champs: Array<{ cle: Nombres; label: string; unite?: string }> }> = [
  {
    titre: "Saisies de terrain sans rotation",
    texte: "Un contrôle ou un alcootest saisi sans rotation est rattaché, au verrou ou au départ, à la rotation de son véhicule ou de son conducteur s'il date de moins de :",
    champs: [
      { cle: "check_window_hours", label: "Contrôle avant départ", unite: "heures" },
      { cle: "breath_test_window_hours", label: "Alcootest", unite: "heures" },
    ],
  },
  {
    titre: "Criticité et enquêtes",
    texte: "Seuils croissants entre 2 et 25 (gravité potentielle × probabilité), délais d'enquête et information du donneur d'ordre.",
    champs: [
      { cle: "level_moderate_min", label: "Criticité modérée à partir de" },
      { cle: "level_significant_min", label: "Criticité significative à partir de" },
      { cle: "level_high_min", label: "Criticité élevée à partir de" },
      { cle: "investigation_hours_high", label: "Enquête, criticité élevée", unite: "heures" },
      { cle: "investigation_days_significant", label: "Enquête, criticité significative", unite: "jours" },
      { cle: "investigation_days_moderate", label: "Analyse, criticité modérée", unite: "jours" },
      { cle: "client_notice_hours", label: "Information du donneur d'ordre, criticité élevée", unite: "heures" },
    ],
  },
  {
    titre: "Actions",
    texte: "Vérification d'efficacité, escalade au Directeur général et seuil d'une action coûteuse, validée par la direction avant son démarrage.",
    champs: [
      { cle: "verification_min_criticality", label: "Vérification d'efficacité à partir de la criticité" },
      { cle: "verification_days", label: "Vérification après la réalisation", unite: "jours" },
      { cle: "escalation_days", label: "Escalade après un retard de", unite: "jours" },
      { cle: "costly_action_threshold", label: "Action coûteuse à partir de", unite: "GNF" },
    ],
  },
];

/** Brouillon du formulaire : textes saisis, comparés aux valeurs lues pour n'envoyer que les changements. */
interface Brouillon {
  dates: Record<Dates, string>;
  nombres: Record<Nombres, string>;
  director_id: string;
  targets: Partial<Record<IndicatorCode, string>>;
}

function depuis(s: HsseqSettings): Brouillon {
  const dates = {} as Record<Dates, string>;
  for (const d of DATES) dates[d.cle] = s[d.cle] ?? "";
  const nombres = {} as Record<Nombres, string>;
  for (const g of GROUPES) for (const c of g.champs) nombres[c.cle] = s[c.cle] === null || s[c.cle] === undefined ? "" : String(s[c.cle]);
  const targets: Partial<Record<IndicatorCode, string>> = {};
  for (const [code, v] of Object.entries(s.targets ?? {})) if (v !== null && v !== undefined) targets[code as IndicatorCode] = String(v);
  return { dates, nombres, director_id: s.director ? String(s.director.id) : "", targets };
}

/** Nombre saisi (virgule décimale acceptée), nul s'il n'est pas lisible. */
function nombre(texte: string): number | null {
  const n = Number(texte.replace(/\s/g, "").replace(",", "."));
  return texte.trim() !== "" && Number.isFinite(n) ? n : null;
}

/**
 * Réglages d'HSSEQ par société (GET et PATCH /hsseq/settings, admin et hsseq) : dates de mise en
 * service du verrou et des exigences du départ, fenêtres de rattachement, seuils de criticité et
 * délais d'enquête, actions, destinataire des notifications de la direction, cibles du cockpit.
 * Seuls les champs modifiés sont envoyés.
 */
export function Reglages() {
  const { data: me } = useApi<Me>("/auth/me");
  const [societe, setSociete] = useState<number | null>(null);
  const choisie = societe ?? me?.company_id ?? null;
  const { data, error, mutate } = useApi<HsseqSettings>(me ? `/hsseq/settings${choisie ? `?company_id=${choisie}` : ""}` : null);
  const societes = me?.companies ?? [];
  return (
    <div className="space-y-5">
      {societes.length > 1 && (
        <Field label="Société" className="w-full sm:w-80">
          <Select value={choisie ?? ""} onChange={(e) => setSociete(Number(e.target.value))} options={societes.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
      )}
      <Etat data={data} error={error} onRetry={() => mutate()} label="Chargement des réglages…">
        {(s) => <Formulaire key={`${s.company.id}-${JSON.stringify(s)}`} s={s} onEnregistre={(maj) => void mutate(maj, { revalidate: false })} />}
      </Etat>
    </div>
  );
}

function Formulaire({ s, onEnregistre }: { s: HsseqSettings; onEnregistre: (s: HsseqSettings) => void }) {
  const { data: ref } = useApi<Referentials>("/hsseq/referentials");
  const initial = depuis(s);
  const [b, setB] = useState<Brouillon>(initial);
  const [erreur, setErreur] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const champs = champsEnErreur(erreur);

  // Seuils de criticité croissants entre 2 et 25 : vérifiés à l'écran avant l'envoi (le noyau les refuse sinon).
  const [mod, sig, hau] = [nombre(b.nombres.level_moderate_min), nombre(b.nombres.level_significant_min), nombre(b.nombres.level_high_min)];
  const seuilsInvalides = mod === null || sig === null || hau === null || !(1 < mod && mod < sig && sig < hau && hau <= 25);
  const illisibles = (Object.keys(b.nombres) as Nombres[]).filter((k) => nombre(b.nombres[k]) === null || (nombre(b.nombres[k]) ?? 0) < 0);
  const ciblesIllisibles = (Object.keys(b.targets) as IndicatorCode[]).filter((k) => (b.targets[k] ?? "").trim() !== "" && nombre(b.targets[k] ?? "") === null);

  function corps(): HsseqSettingsPatch {
    const c: HsseqSettingsPatch = { company_id: s.company.id };
    for (const d of DATES) if (b.dates[d.cle] !== initial.dates[d.cle]) c[d.cle] = b.dates[d.cle] || null;
    for (const k of Object.keys(b.nombres) as Nombres[]) if (b.nombres[k] !== initial.nombres[k]) c[k] = nombre(b.nombres[k]) ?? 0;
    if (b.director_id !== initial.director_id) c.director_id = b.director_id ? Number(b.director_id) : null;
    if (JSON.stringify(b.targets) !== JSON.stringify(initial.targets)) {
      const t: Partial<Record<IndicatorCode, number>> = {};
      for (const [k, v] of Object.entries(b.targets)) {
        const n = nombre(v ?? "");
        if (n !== null) t[k as IndicatorCode] = n;
      }
      c.targets = t;
    }
    return c;
  }
  const modifie = Object.keys(corps()).length > 1;

  async function enregistrer() {
    setEnvoi(true);
    setErreur(null);
    setMessage(null);
    try {
      const maj = await apiSend<HsseqSettings>("PATCH", "/hsseq/settings", corps());
      setMessage(`Réglages de ${maj.company.name} enregistrés.`);
      onEnregistre(maj);
    } catch (e) {
      setErreur(e);
    } finally {
      setEnvoi(false);
    }
  }

  const proposes = [...new Map([...(s.director ? [s.director] : []), ...(ref?.owners ?? []).filter((o) => !o.driver)].map((u) => [u.id, u])).values()].sort((x, y) => x.name.localeCompare(y.name, "fr"));

  return (
    <div className="space-y-5">
      {message && <Notice tone="ok">{message}</Notice>}

      <Card title="Mise en service">
        <p className="mb-4 max-w-[90ch] text-[13px] leading-relaxed text-muted">
          {s.lock_start_date ? `Verrou de départ en service pour les rotations chargées à partir du ${fmtDate(s.lock_start_date)}.` : "Verrou de départ pas encore en service : Transport fait partir les rotations comme avant, les motifs s'affichent pour information."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {DATES.map((d) => (
            <Field key={d.cle} label={d.label} hint={d.aide} error={champs.includes(d.cle) ? "Date refusée par le serveur." : undefined}>
              <Input type="date" value={b.dates[d.cle]} onChange={(e) => setB({ ...b, dates: { ...b.dates, [d.cle]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </Card>

      {GROUPES.map((g) => (
        <Card key={g.titre} title={g.titre}>
          <p className="mb-4 max-w-[90ch] text-[13px] leading-relaxed text-muted">{g.texte}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.champs.map((c) => {
              const seuil = c.cle.startsWith("level_");
              const faux = illisibles.includes(c.cle) || champs.includes(c.cle) || (seuil && seuilsInvalides);
              return (
                <Field
                  key={c.cle}
                  label={c.unite ? `${c.label} (${c.unite})` : c.label}
                  hint={c.cle === "costly_action_threshold" && nombre(b.nombres[c.cle]) !== null ? fmtGNF(nombre(b.nombres[c.cle]) ?? 0) : undefined}
                  error={faux ? (seuil && seuilsInvalides ? "Seuils croissants, entre 2 et 25." : "Nombre positif attendu.") : undefined}
                >
                  <Input inputMode="decimal" value={b.nombres[c.cle]} aria-invalid={faux || undefined} onChange={(e) => setB({ ...b, nombres: { ...b.nombres, [c.cle]: e.target.value } })} />
                </Field>
              );
            })}
          </div>
        </Card>
      ))}

      <Card title="Notifications de la direction">
        <Field label="Directeur général" hint="Criticité élevée, dérogation activée, escalade d'une action. Sans choix : les comptes Direction générale de la société." className="max-w-md">
          <Select value={b.director_id} onChange={(e) => setB({ ...b, director_id: e.target.value })} placeholder="Comptes Direction générale de la société" options={proposes.map((u) => ({ value: u.id, label: u.name }))} />
        </Field>
      </Card>

      <Card title="Cibles du cockpit">
        <p className="mb-4 max-w-[90ch] text-[13px] leading-relaxed text-muted">Laissez vide pour garder la cible proposée, écrite en grisé. Pourcentages en %, écarts en ‰.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(CIBLES_PROPOSEES) as IndicatorCode[]).map((code) => (
            <Field key={code} label={INDICATEUR[code]} error={ciblesIllisibles.includes(code) ? "Nombre attendu." : undefined}>
              <Input
                inputMode="decimal"
                value={b.targets[code] ?? ""}
                placeholder={String(CIBLES_PROPOSEES[code]).replace(".", ",")}
                onChange={(e) => setB({ ...b, targets: { ...b.targets, [code]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
      </Card>

      {Boolean(erreur) && <Notice tone="danger">{messageErreur(erreur)}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => setB(initial)} disabled={!modifie || envoi}>
          Rétablir
        </Button>
        <Button variant="primary" loading={envoi} disabled={!modifie || seuilsInvalides || illisibles.length > 0 || ciblesIllisibles.length > 0} onClick={() => void enregistrer()}>
          Enregistrer les réglages
        </Button>
      </div>
    </div>
  );
}
