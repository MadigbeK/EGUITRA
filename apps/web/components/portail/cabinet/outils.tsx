"use client";

/**
 * Briques communes des écrans du cabinet pour le portail des porteurs : droit d'écriture, retour des
 * actions, éditeur de texte mis en forme avec aperçu, choix du public d'une publication, cases à
 * cocher, recherche et export CSV.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMoi } from "@/components/axispro/moi";
import { Search, X } from "@/components/icons";
import { TexteRiche } from "@/components/portail/commun";
import { Input, Notice, Segmented, Textarea, cx, type Tone } from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import type { Audience, Cibles, PublicationState } from "@/lib/portail-types";

/* ─── Droits et retours ────────────────────────────────────────────────── */

/**
 * Droit d'écriture sur le portail : profil cabinet. La direction et l'administration lisent ; le
 * noyau refuse leurs écritures (403). Utilisateur inconnu : le noyau tranche.
 */
export function useEcriture(): boolean {
  const moi = useMoi();
  return moi ? moi.cabinet : true;
}

/** Identifiant de l'utilisateur connecté (consultant), null s'il est inconnu. */
export function useMonId(): number | null {
  return useMoi()?.id ?? null;
}

export const RESERVE_CABINET = "Réservé au profil cabinet";

export function LectureSeule({ ecriture, children }: { ecriture: boolean; children?: ReactNode }) {
  if (ecriture) return null;
  return (
    <Notice tone="neutral">
      {children ?? "Lecture seule : votre profil consulte le portail. Seul le profil cabinet publie, répond et modifie."}
    </Notice>
  );
}

/** Message d'une erreur à montrer à l'utilisateur : celui de l'API, sinon une phrase générale. */
export function messageErreur(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Action impossible. Vérifiez la connexion, puis réessayez.";
}

type Retour = { tone: Extract<Tone, "ok" | "danger" | "warn">; text: string } | null;

/**
 * Exécute une action de l'API et garde son retour : l'erreur reste affichée, la confirmation
 * s'efface d'elle-même après quelques secondes. Renvoie undefined en cas d'échec.
 */
export function useRetour() {
  const [retour, setRetour] = useState<Retour>(null);
  useEffect(() => {
    if (retour?.tone !== "ok") return;
    const t = window.setTimeout(() => setRetour(null), 6000);
    return () => window.clearTimeout(t);
  }, [retour]);
  async function agir<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setRetour(null);
    try {
      const r = await fn();
      if (ok) setRetour({ tone: "ok", text: ok });
      return r;
    } catch (e) {
      setRetour({ tone: "danger", text: messageErreur(e) });
      return undefined;
    }
  }
  const bandeau = retour ? (
    <div className="relative">
      <Notice tone={retour.tone}>
        <span className="block pr-7">{retour.text}</span>
      </Notice>
      <button type="button" aria-label="Fermer le message" onClick={() => setRetour(null)} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-panel-3 hover:text-ink">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;
  return { agir, bandeau, setRetour };
}

/* ─── Libellés ─────────────────────────────────────────────────────────── */

/** État d'une publication, accordé au genre de ce qui est publié (« publiée » ou « publié »). */
export function etatPublication(state: PublicationState, feminin = false): { label: string; tone: Tone } {
  const e = feminin ? "e" : "";
  if (state === "published") return { label: `Publié${e}`, tone: "ok" };
  if (state === "archived") return { label: `Archivé${e}`, tone: "neutral" };
  return { label: "Brouillon", tone: "warn" };
}

/** « 1 lecture », « 3 lectures ». */
export function pluriel(n: number, singulier: string, plurielForme?: string): string {
  return `${new Intl.NumberFormat("fr-FR").format(n)} ${n > 1 ? (plurielForme ?? `${singulier}s`) : singulier}`;
}

/** Première lettre en capitale (« mardi 4 novembre » -> « Mardi 4 novembre »). */
export function majuscule(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Comparaison sans casse ni accents, pour les recherches. */
export function normaliser(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function correspond(q: string, ...champs: Array<string | null | undefined>): boolean {
  const mots = normaliser(q).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const texte = normaliser(champs.filter(Boolean).join(" "));
  return mots.every((m) => texte.includes(m));
}

/* ─── Listes de codes (« G0, G1 ») ─────────────────────────────────────── */

/** « G0, G1 ; G2 » -> ["G0", "G1", "G2"] : même découpage que le noyau, sans doublon. */
export function listeCodes(valeur: string | null | undefined): string[] {
  const vus: string[] = [];
  for (const brut of (valeur ?? "").replace(/;/g, ",").split(",")) {
    const item = brut.trim();
    if (item && !vus.includes(item)) vus.push(item);
  }
  return vus;
}

/** Ajoute ou retire un code, dans l'ordre de référence quand il est donné. */
export function basculerCode(valeur: string, code: string, ordre?: string[]): string {
  const liste = listeCodes(valeur);
  const suivante = liste.includes(code) ? liste.filter((c) => c !== code) : [...liste, code];
  if (ordre) {
    const rang = (c: string) => {
      const i = ordre.indexOf(c);
      return i < 0 ? ordre.length : i;
    };
    suivante.sort((a, b) => rang(a) - rang(b));
  }
  return suivante.join(", ");
}

/* ─── Champs ───────────────────────────────────────────────────────────── */

/** Case à cocher et son libellé, avec une précision facultative dessous. */
export function Coche({ checked, onChange, children, hint, disabled, className, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: ReactNode; disabled?: boolean; className?: string; ariaLabel?: string }) {
  return (
    <label className={cx("flex items-start gap-2.5 text-[13.5px] leading-snug text-ink-2", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer", className)}>
      <input type="checkbox" aria-label={ariaLabel} className="mt-[3px] h-4 w-4 flex-none" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="font-medium text-ink">{children}</span>
        {hint && <span className="mt-0.5 block text-[12px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Champ de recherche avec sa loupe. */
export function Recherche({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <div className={cx("relative min-w-0", className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <Input type="search" aria-label={label} className="pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Intitulé d'un groupe de champs (étiquette sans contrôle unique). */
export function Intitule({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className="text-[13px] font-medium text-ink-2">{children}</div>
      {hint && <div className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export const AIDE_MISE_EN_FORME = "Mise en forme : # titre, **gras**, *italique*, - liste, > encadré, [lien](https://…)";

/**
 * Texte mis en forme : la saisie à gauche, l'aperçu tel que le porteur le lira à droite (dessous
 * sur un écran étroit). Aucun HTML n'est interprété.
 */
export function EditeurTexte({ label, value, onChange, placeholder, disabled, max = 60_000, hauteur = 280 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; max?: number; hauteur?: number }) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
          {label}
        </label>
        <span className={cx("text-[11.5px] tabular", value.length > max ? "font-semibold text-danger" : "text-muted")}>
          {new Intl.NumberFormat("fr-FR").format(value.length)} / {new Intl.NumberFormat("fr-FR").format(max)} caractères
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Textarea id={id} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="font-mono text-[13px]" style={{ minHeight: hauteur }} aria-describedby={`${id}-aide`} />
        <div className="min-w-0 overflow-y-auto rounded-[10px] border border-dashed border-line-strong/70 bg-panel-2/60 px-4 py-3" style={{ maxHeight: Math.max(hauteur, 320), minHeight: hauteur }} aria-label="Aperçu du texte">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Aperçu</div>
          {value.trim() ? <TexteRiche source={value} compact /> : <p className="text-[13px] text-muted">L&apos;aperçu du texte s&apos;affiche ici.</p>}
        </div>
      </div>
      <p id={`${id}-aide`} className="mt-1.5 text-[12px] leading-snug text-muted">
        {AIDE_MISE_EN_FORME}
      </p>
    </div>
  );
}

/* ─── Public d'une publication ─────────────────────────────────────────── */

export interface PublicSaisi {
  audience: Audience;
  dossier_ids: number[];
  gate_codes: string;
  sector_keywords: string;
}

export const PUBLIC_VIDE: PublicSaisi = { audience: "all", dossier_ids: [], gate_codes: "", sector_keywords: "" };

const LIBELLE_PUBLIC: Record<Audience, string> = {
  all: "Tous les porteurs",
  dossiers: "Dossiers choisis",
  gates: "Étapes",
  sectors: "Secteurs",
};

/** Dossiers en cours que vise un public (estimation côté écran, le noyau fait foi). */
export function dossiersVises(p: PublicSaisi, cibles: Cibles): Cibles["dossiers"] {
  switch (p.audience) {
    case "all":
      return cibles.dossiers;
    case "dossiers":
      return cibles.dossiers.filter((d) => p.dossier_ids.includes(d.id));
    case "gates": {
      const codes = listeCodes(p.gate_codes);
      return cibles.dossiers.filter((d) => d.current_gate && codes.includes(d.current_gate.code));
    }
    case "sectors": {
      const mots = listeCodes(p.sector_keywords).map(normaliser);
      return cibles.dossiers.filter((d) => mots.some((m) => normaliser(d.sector).includes(m)));
    }
  }
}

/** Ce qui manque au public pour être enregistré, ou null. */
export function publicIncomplet(p: PublicSaisi): string | null {
  if (p.audience === "dossiers" && !p.dossier_ids.length) return "Choisissez au moins un dossier.";
  if (p.audience === "gates" && !listeCodes(p.gate_codes).length) return "Cochez au moins une étape.";
  if (p.audience === "sectors" && !listeCodes(p.sector_keywords).length) return "Indiquez au moins un secteur.";
  return null;
}

/** Public en une phrase : « Tous les porteurs », « 3 dossiers choisis », « Étapes G1, G2 »… */
export function resumePublic(p: PublicSaisi & { audience_label?: string }): string {
  if (p.audience === "all") return "Tous les porteurs";
  if (p.audience === "dossiers") return pluriel(p.dossier_ids.length, "dossier choisi", "dossiers choisis");
  if (p.audience === "gates") return `Étapes ${listeCodes(p.gate_codes).join(", ")}`;
  return `Secteurs : ${listeCodes(p.sector_keywords).join(", ")}`;
}

/** Choix du public : tous, des dossiers cochés, des étapes cochées ou des mots de secteur. */
export function ChoixPublic({ value, onChange, cibles, disabled }: { value: PublicSaisi; onChange: (v: PublicSaisi) => void; cibles: Cibles; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const vises = useMemo(() => dossiersVises(value, cibles), [value, cibles]);
  const comptes = vises.reduce((a, d) => a + d.portal_users, 0);
  const filtres = cibles.dossiers.filter((d) => correspond(q, d.reference, d.name, d.sector));
  const ordreGates = cibles.gates.map((g) => g.code);
  const motsSecteur = listeCodes(value.sector_keywords).map(normaliser);
  const audiences = (cibles.audiences.length ? cibles.audiences.map((a) => a.key) : (Object.keys(LIBELLE_PUBLIC) as Audience[])).map((k) => ({ key: k, label: LIBELLE_PUBLIC[k] }));

  return (
    <fieldset disabled={disabled} className="min-w-0 rounded-xl border border-line bg-panel-2/50 p-4">
      <legend className="px-1 text-[13px] font-medium text-ink-2">Public</legend>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <Segmented label="Public visé" value={value.audience} onChange={(k) => onChange({ ...value, audience: k })} options={audiences} />
      </div>

      {value.audience === "dossiers" && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Recherche className="flex-1" label="Filtrer les dossiers" placeholder="Référence, nom ou secteur" value={q} onChange={setQ} />
            <button type="button" className="text-[12.5px] font-semibold text-accent hover:underline" onClick={() => onChange({ ...value, dossier_ids: Array.from(new Set([...value.dossier_ids, ...filtres.map((d) => d.id)])) })}>
              Tout cocher
            </button>
            <button type="button" className="text-[12.5px] font-semibold text-muted hover:text-ink hover:underline" onClick={() => onChange({ ...value, dossier_ids: [] })}>
              Aucun
            </button>
          </div>
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-panel p-1.5">
            {filtres.length === 0 && <li className="px-2 py-3 text-[13px] text-muted">Aucun dossier ne correspond.</li>}
            {filtres.map((d) => {
              const coche = value.dossier_ids.includes(d.id);
              return (
                <li key={d.id}>
                  <label className={cx("flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-panel-2", coche && "bg-accent-doux/50")}>
                    <input
                      type="checkbox"
                      aria-label={`Viser le dossier ${d.reference} ${d.name}`}
                      className="mt-[3px] h-4 w-4 flex-none"
                      checked={coche}
                      onChange={(e) => onChange({ ...value, dossier_ids: e.target.checked ? [...value.dossier_ids, d.id] : value.dossier_ids.filter((i) => i !== d.id) })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink">{d.reference}</span> <span className="text-ink-2">{d.name}</span>
                      <span className="block text-[11.5px] text-muted">
                        {[d.current_gate ? `${d.current_gate.code} ${d.current_gate.name}` : null, d.sector, d.portal_users ? pluriel(d.portal_users, "compte porteur", "comptes porteurs") : "aucun porteur inscrit"].filter(Boolean).join(", ")}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {value.audience === "gates" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {cibles.gates.length === 0 && <p className="text-[13px] text-muted">Aucune étape : la grille d&apos;évaluation n&apos;est pas importée.</p>}
          {cibles.gates.map((g) => {
            const coche = listeCodes(value.gate_codes).includes(g.code);
            return (
              <label key={g.code} className={cx("inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors", coche ? "border-accent-vif/50 bg-accent-doux text-ink" : "border-line bg-panel text-ink-2 hover:border-line-strong")}>
                <input type="checkbox" aria-label={`Viser l'étape ${g.code} ${g.name}`} className="h-3.5 w-3.5" checked={coche} onChange={() => onChange({ ...value, gate_codes: basculerCode(value.gate_codes, g.code, ordreGates) })} />
                <span className="font-semibold">{g.code}</span> {g.name}
              </label>
            );
          })}
        </div>
      )}

      {value.audience === "sectors" && (
        <div className="mt-3">
          <Input aria-label="Mots des secteurs visés" placeholder="Exemple : agro, énergie, BTP" value={value.sector_keywords} onChange={(e) => onChange({ ...value, sector_keywords: e.target.value })} />
          <p className="mt-1.5 text-[12px] text-muted">Mots séparés par des virgules : un dossier est visé si son secteur contient l&apos;un d&apos;eux.</p>
          {cibles.sectors.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cibles.sectors.map((s) => {
                const pris = motsSecteur.includes(normaliser(s));
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={pris}
                    onClick={() => onChange({ ...value, sector_keywords: pris ? listeCodes(value.sector_keywords).filter((m) => normaliser(m) !== normaliser(s)).join(", ") : [...listeCodes(value.sector_keywords), s].join(", ") })}
                    className={cx("rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors", pris ? "border-accent-vif/50 bg-accent-doux text-accent" : "border-line bg-panel text-ink-2 hover:border-line-strong")}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[12.5px] text-muted">
        Public visé : <span className="font-semibold text-ink">{pluriel(vises.length, "dossier en cours", "dossiers en cours")}</span>, {pluriel(comptes, "compte porteur", "comptes porteurs")}.
        {publicIncomplet(value) && <span className="ml-1 font-semibold text-warn">{publicIncomplet(value)}</span>}
      </p>
    </fieldset>
  );
}

/* ─── Export ───────────────────────────────────────────────────────────── */

/** Fichier CSV (séparateur point-virgule, encodage UTF-8 avec BOM : il s'ouvre tel quel dans Excel). */
export function telechargerCsv(nom: string, lignes: Array<Array<string | number | null | undefined>>) {
  const cellule = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Texte saisi qui commencerait comme une formule : le tableur l'exécuterait (même règle que csv_text du noyau).
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texte = String.fromCharCode(0xfeff) + lignes.map((l) => l.map(cellule).join(";")).join(String.fromCharCode(13, 10));
  const url = URL.createObjectURL(new Blob([texte], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Nom de fichier tiré d'un intitulé. */
export function nomFichier(texte: string): string {
  return normaliser(texte).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";
}
