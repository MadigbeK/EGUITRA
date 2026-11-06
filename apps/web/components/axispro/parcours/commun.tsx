"use client";

import Link from "next/link";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Badge, Card, FEUILLE, cx } from "@/components/ui";
import { nomPromoteur, type Ton } from "@/lib/axispro-parcours";
import type { LignePilotage } from "@/lib/axispro-types";
import { AIDE_NOMBRE, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";

/** Ligne de repère au-dessus d'un titre : date du jour, N° MBAP, nom de la vue. */
export function Surtitre({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("font-mono text-[12.5px] uppercase tracking-[0.04em] text-accent", className)} suppressHydrationWarning>{children}</p>;
}

/** Titre d'un écran du parcours : même échelle que PageHeader, sans ses marges. */
export const TITRE_ECRAN = "font-display text-[28px] font-[650] leading-[1.1] tracking-[-0.025em] text-ink sm:text-[34px]";

const COULEUR_CHIFFRE: Record<Ton, string> = {
  ok: "text-ok-texte",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent",
  neutral: "text-ink",
};

/** Grille de tuiles : une colonne, puis deux, puis une ligne entière (EC-12). */
export const GRILLE_TUILES = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4";

/** Tuile d'un chiffre : libellé puis valeur, à la couleur de ce qu'elle signale. */
export function TuileChiffre({ label, valeur, ton = "neutral", grande = true }: { label: string; valeur: ReactNode; ton?: Ton; grande?: boolean }) {
  return (
    <div className={cx(FEUILLE, "min-w-0 px-5 py-4")}>
      <div className="text-[13px] leading-snug text-muted">{label}</div>
      <div className={cx("mt-1.5 font-display font-bold leading-tight tabular", grande ? "text-[28px]" : "text-[22px]", COULEUR_CHIFFRE[ton])}>{valeur}</div>
    </div>
  );
}

/** Titre de carte suivi du nombre de lignes de la liste. */
export function TitreCompte({ titre, n }: { titre: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {titre}
      <span className="rounded-full bg-panel-3 px-2 py-0.5 font-mono text-[12px] font-semibold text-ink-2">{fmtInt(n)}</span>
    </span>
  );
}

/** Intitulé d'un projet, « (sans intitulé) » tant que la fiche n'en porte pas. */
export function intituleDe(d: { name?: string | null }): string {
  return d.name?.trim() || "(sans intitulé)";
}

/** Ligne d'une liste de l'accueil : ouvre le projet à l'étape 1, zone cliquable de 42 pixels au moins. */
export function LigneProjet({ d, droite }: { d: LignePilotage; droite: ReactNode }) {
  const promoteur = nomPromoteur(d);
  return (
    <Link href={`/axispro/dossiers/${d.id}/fiche`} className="flex min-h-[42px] items-center justify-between gap-3 border-b border-line py-2.5 last:border-0 hover:text-accent">
      <span className="min-w-0 text-[13.5px] leading-snug text-muted">
        <b className="font-semibold text-ink">{intituleDe(d)}</b>
        {" · "}
        <span className="tabular">{d.reference}</span>
        {promoteur ? ` · ${promoteur}` : ""}
      </span>
      <span className="flex-none">{droite}</span>
    </Link>
  );
}

/** Lignes affichées au plus par liste de l'accueil (RG-01-01). */
const MAX_LIGNES = 6;

/** Liste de projets de l'accueil : six lignes au plus, puis un lien vers le portefeuille (RG-01-01). */
export function ListeProjets<T extends LignePilotage>({ titre, projets, droite, vide, lien = "/axispro/portefeuille" }: { titre: string; projets: T[]; droite: (d: T) => ReactNode; vide: string; lien?: string }) {
  return (
    <Card title={<TitreCompte titre={titre} n={projets.length} />}>
      {projets.length === 0 ? (
        <p className="py-1 text-[13.5px] text-muted">{vide}</p>
      ) : (
        <>
          {projets.slice(0, MAX_LIGNES).map((d) => (
            <LigneProjet key={d.id} d={d} droite={droite(d)} />
          ))}
          {projets.length > MAX_LIGNES && (
            <Link href={lien} className="mt-2 inline-flex min-h-[42px] items-center text-[13.5px] font-semibold text-accent hover:underline">
              Voir les {fmtInt(projets.length)} projets
            </Link>
          )}
        </>
      )}
    </Card>
  );
}

/** Pastilles de filtre : un seul actif, retour à la ligne sur téléphone (EC-02). */
export function FiltresPastilles<K extends string>({ options, value, onChange, label }: { options: Array<{ key: K; label: string }>; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={cx("min-h-[42px] rounded-full border px-4 text-[13.5px] font-semibold transition-colors", o.key === value ? "border-accent bg-accent text-white" : "border-line bg-panel text-ink-2 hover:border-accent hover:text-accent")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pastille d'un nombre de knock-out : verte à zéro, rouge dès le premier. */
export function PastilleKo({ n }: { n: number }) {
  return <Badge tone={n > 0 ? "danger" : "ok"}>{fmtInt(n)}</Badge>;
}

/** Case à cocher étiquetée, zone cliquable de 42 pixels au moins. */
export function CaseCochee({ checked, onChange, disabled, children, gras }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode; gras?: boolean }) {
  return (
    <label className={cx("flex min-h-[42px] items-center gap-3 text-[14px] text-ink-2", gras && "font-semibold text-ink", disabled ? "cursor-default" : "cursor-pointer")}>
      <input type="checkbox" className="h-5 w-5 flex-none accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** Valeur d'un champ pour un compte en lecture seule : du texte, jamais un champ grisé. */
export function ValeurLue({ label, valeur, className }: { label: string; valeur: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 text-[13px] font-medium text-ink-2">{label}</div>
      <div className="min-h-[24px] whitespace-pre-wrap text-[14px] text-ink">{valeur || <span className="text-muted">–</span>}</div>
    </div>
  );
}

/** Liste déroulante groupée (critères par domaine) : même présentation que Select, qui n'a pas de groupes. */
export function SelectGroupe({ groupes, vide, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { groupes: Array<{ nom: string; options: Array<{ value: string | number; label: string }> }>; vide: string }) {
  return (
    <select {...props} className={cx("champ-liste min-h-9 w-full rounded-[10px] border border-line-champ bg-panel px-3 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-200 hover:border-ink-2 focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-muted pointer-coarse:min-h-11", className)}>
      <option value="">{vide}</option>
      {groupes.map((g) => (
        <optgroup key={g.nom} label={g.nom}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Montant facultatif d'un champ : vide vaut 0 (non renseigné), illisible vaut null (envoi bloqué). */
export function montantLu(v: string): number | null {
  return v.trim() ? lireNombre(v) : 0;
}

/** Message sous un champ de montant : saisie illisible ou négative ; rien s'il convient. */
export function erreurMontant(v: string): string | undefined {
  if (nombreIllisible(v)) return AIDE_NOMBRE;
  const n = montantLu(v);
  return n !== null && n < 0 ? "Montant positif attendu." : undefined;
}

/** Montant écrit comme une saisie (virgule décimale) ; vide s'il manque ou vaut zéro. */
export function montantEcrit(v: number | null | undefined): string {
  return v ? String(v).replace(".", ",") : "";
}

/** Fichiers que la lecture du business plan accepte. */
export const FORMATS_BP = ".pdf,.docx,.txt";
export const MESSAGE_FORMAT_BP = "Format non pris en charge : utilisez un PDF, un fichier Word (.docx) ou un texte.";
export const TAILLE_MAX = 20 * 1024 * 1024;

/** Motif de refus d'un fichier à lire, avant tout envoi : format (RG-03-01) et taille (20 Mo). */
export function refusFichierBp(f: File): string | null {
  if (!/\.(pdf|docx|txt)$/i.test(f.name)) return MESSAGE_FORMAT_BP;
  return f.size > TAILLE_MAX ? `${f.name} : plus de 20 Mo, compressez le fichier` : null;
}
