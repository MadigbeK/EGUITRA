"use client";

/**
 * Outils partagés par les écrans « Plan d'actions » et « Contrôles » de NIMOVA · HSSEQ : filtres
 * portés par l'adresse, référentiels, pièces jointes (dépôt, vignettes, retrait), panneau de fiche
 * à côté de la liste, pages d'une liste et messages d'erreur du noyau. À verser dans
 * components/hsseq/commun.tsx quand les écrans du lot 1 seront stabilisés.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, FileText, Trash2, X } from "@/components/icons";
import { Button, FEUILLE, Field, Modal, Select, cx, demanderConfirmation } from "@/components/ui";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { Attachment, AttachmentModel, HsseqProfile, Referentials } from "@/lib/hsseq-types";
import type { Me } from "@/lib/types";

/* ─── Adresse et référentiels ─────────────────────────────────────────── */

/**
 * Filtres portés par l'adresse de la page : `lire` donne un paramètre, `ecrire` en pose ou en retire
 * plusieurs d'un coup (valeur vide ou nulle : retiré), sans recharger ni faire défiler la page. Un
 * filtre se partage donc par simple lien.
 */
export function useAdresse() {
  const params = useSearchParams();
  const router = useRouter();
  const chemin = usePathname();
  const lire = useCallback((cle: string) => params.get(cle) ?? "", [params]);
  const ecrire = useCallback(
    (maj: Record<string, string | number | null | undefined>) => {
      const suivant = new URLSearchParams(params.toString());
      for (const [cle, valeur] of Object.entries(maj)) {
        if (valeur === null || valeur === undefined || valeur === "") suivant.delete(cle);
        else suivant.set(cle, String(valeur));
      }
      const qs = suivant.toString();
      router.replace(qs ? `${chemin}?${qs}` : chemin, { scroll: false });
    },
    [params, router, chemin],
  );
  return { lire, ecrire };
}

/** Référentiels de HSSEQ : sites, véhicules, conducteurs, responsables, seuil d'une action coûteuse, compte connecté. */
export function useReferentiels() {
  return useApi<Referentials>("/hsseq/referentials");
}

/** Choix du site, quand le compte en couvre plusieurs. */
export function ChampSite({ ref_, valeur, onChange }: { ref_: Referentials | undefined; valeur: string; onChange: (v: string) => void }) {
  const sites = ref_?.sites.filter((s) => s.active && (!ref_.me.site_ids.length || ref_.me.site_ids.includes(s.id))) ?? [];
  if (sites.length < 2) return null;
  return (
    <Field label="Site" className="w-full sm:w-44">
      <Select value={valeur} onChange={(e) => onChange(e.target.value)} placeholder="Tous" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
    </Field>
  );
}

/** Le compte connecté porte-t-il l'un de ces profils HSSEQ ? Faux tant que les référentiels ne sont pas lus. */
export function aProfil(ref: Referentials | undefined, ...profils: HsseqProfile[]): boolean {
  return Boolean(ref?.me.profiles.some((p) => profils.includes(p)));
}

/** Compte connecté (session) : son identifiant sert à savoir qui a déposé une pièce. */
export function useMoi() {
  return useApi<Me>("/auth/me").data;
}

/** Chaîne de requête d'un objet de filtres ; les valeurs vides sont omises. */
export function requete(filtres: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(filtres)) if (valeur !== null && valeur !== undefined && valeur !== "") p.set(cle, String(valeur));
  return p.toString();
}

/** Date du jour, « YYYY-MM-DD » (heure de Conakry : UTC). */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Premier jour du mois courant, « YYYY-MM-01 ». */
export function debutDuMois(): string {
  return `${aujourdhui().slice(0, 7)}-01`;
}

/** Jours entre deux dates « YYYY-MM-DD » (positif si `b` est après `a`). */
export function joursEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** Date décalée de `n` jours. */
export function decaler(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ─── Erreurs du noyau ─────────────────────────────────────────────────── */

/** Code précis d'un refus du noyau (`proof_required`, `photo_missing`…), ou nul. */
export function codeErreur(e: unknown): string | null {
  return e instanceof ApiError ? e.body.error : null;
}

/** Message en français d'un refus : celui du noyau, sinon `defaut`. */
export function messageErreur(e: unknown, defaut = "Enregistrement impossible."): string {
  return e instanceof ApiError ? e.message : defaut;
}

/* ─── Pièces jointes ───────────────────────────────────────────────────── */

/** Formats acceptés par le noyau (eguitra_api/files.py), 8 Mo au plus. */
export const FORMATS_PIECE = "image/jpeg,image/png,application/pdf";
export const FORMATS_PHOTO = "image/jpeg,image/png";
const TAILLE_MAX = 8 * 1024 * 1024;

/** Dépose une pièce rattachée à une fiche HSSEQ (POST /hsseq/attachments) et renvoie la pièce créée. */
export async function deposerPiece(model: AttachmentModel, id: number, fichier: File, legende?: string): Promise<Attachment> {
  if (fichier.size > TAILLE_MAX) throw new ApiError(413, { error: "file_too_large", message: "Fichier trop lourd : 8 Mo au plus." });
  const form = new FormData();
  form.append("file", fichier);
  form.append("model", model);
  form.append("id", String(id));
  if (legende) form.append("caption", legende);
  return apiUpload<Attachment>("/hsseq/attachments", form);
}

/** Retire une pièce (auteur ou Responsable HSSEQ, tant que la fiche n'est pas close). */
export async function retirerPiece(piece: Attachment): Promise<boolean> {
  if (!(await demanderConfirmation(`Retirer la pièce « ${piece.name} » ?`, { action: "Retirer", danger: true }))) return false;
  await apiSend("DELETE", `/hsseq/attachments/${piece.id}`);
  return true;
}

/**
 * Image d'une pièce, lue par la passerelle avec l'en-tête de l'application (une balise img seule
 * n'envoie pas cet en-tête) ; l'adresse locale est libérée quand la vignette disparaît.
 */
function useImage(url: string): { src: string | null; echec: boolean } {
  const [etat, setEtat] = useState<{ url: string; src: string | null; echec: boolean }>({ url, src: null, echec: false });
  useEffect(() => {
    let vivant = true;
    let objet: string | null = null;
    fetch(`/api/odoo${url}`, { headers: { "X-Eguitra-App": "hsseq" } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!vivant) return;
        objet = URL.createObjectURL(b);
        setEtat({ url, src: objet, echec: false });
      })
      .catch(() => {
        if (vivant) setEtat({ url, src: null, echec: true });
      });
    return () => {
      vivant = false;
      if (objet) URL.revokeObjectURL(objet);
    };
  }, [url]);
  return etat.url === url ? { src: etat.src, echec: etat.echec } : { src: null, echec: false };
}

function Image({ piece, className }: { piece: Attachment; className?: string }) {
  const { src, echec } = useImage(piece.url);
  if (echec) return <span className={cx("grid place-items-center bg-panel-3 text-[11px] text-muted", className)}>Illisible</span>;
  if (!src) return <span aria-hidden className={cx("n-squelette block", className)} />;
  // Image privée lue par la passerelle : balise img simple, sans l'optimiseur de Next.
  return <img src={src} alt="" className={cx("object-cover", className)} />;
}

/** Libellé lisible d'une pièce, pour les noms accessibles. */
function nomPiece(piece: Attachment): string {
  return piece.caption ? `${piece.caption} (${piece.name})` : piece.name;
}

/**
 * Pièces d'une fiche : vignettes des photos (agrandies au clic), PDF téléchargés. `retirable` dit
 * quelles pièces le compte peut retirer ; `onRetiree` suit un retrait réussi.
 */
export function Pieces({ pieces, vide, retirable, onRetiree, onErreur }: { pieces: Attachment[]; vide?: ReactNode; retirable?: (p: Attachment) => boolean; onRetiree?: (p: Attachment) => void; onErreur?: (message: string) => void }) {
  const [ouverte, setOuverte] = useState<Attachment | null>(null);
  if (!pieces.length) return vide ? <>{vide}</> : null;
  async function retirer(p: Attachment) {
    try {
      if (await retirerPiece(p)) onRetiree?.(p);
    } catch (e) {
      onErreur?.(messageErreur(e, "Retrait impossible."));
    }
  }
  return (
    <>
      <ul className="flex flex-wrap gap-2.5">
        {pieces.map((p) => (
          <li key={p.id} className="relative">
            {p.is_photo ? (
              <button type="button" onClick={() => setOuverte(p)} className="block overflow-hidden rounded-[10px] outline-offset-2" aria-label={`Agrandir la photo ${nomPiece(p)}`} title={nomPiece(p)}>
                <Image piece={p} className="h-[72px] w-[96px] rounded-[10px]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void apiDownload(p.url, p.name)}
                className="flex h-[72px] w-[128px] flex-col items-start justify-between rounded-[10px] bg-panel-2 px-2.5 py-2 text-left text-[12px] text-ink-2 outline-offset-2 transition-colors hover:bg-panel-3"
                aria-label={`Télécharger ${nomPiece(p)}`}
              >
                <FileText className="h-4 w-4 text-accent" />
                <span className="line-clamp-2 break-all leading-tight">{p.name}</span>
              </button>
            )}
            {retirable?.(p) && (
              <button
                type="button"
                onClick={() => void retirer(p)}
                className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full border border-line bg-panel text-muted shadow-sm transition-colors hover:border-danger hover:text-danger"
                aria-label={`Retirer ${nomPiece(p)}`}
                title="Retirer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Modal open={ouverte !== null} title={ouverte?.caption ?? "Photo"} onClose={() => setOuverte(null)} wide>
        {ouverte && (
          <figure className="m-0 space-y-3">
            <Image piece={ouverte} className="max-h-[70vh] w-full rounded-xl object-contain" />
            <figcaption className="text-[12.5px] text-muted">
              {ouverte.name}, déposée le {fmtDateTime(ouverte.created_at)} par {ouverte.created_by.name}
            </figcaption>
          </figure>
        )}
      </Modal>
    </>
  );
}

/* ─── Fiche en panneau ─────────────────────────────────────────────────── */

/**
 * Liste et fiche côte à côte sur grand écran ; sur téléphone, la fiche prend la place de la liste
 * et un bouton y ramène. La fiche colle sous l'en-tête pendant que la liste défile.
 */
export function AvecFiche({ ouverte, liste, fiche }: { ouverte: boolean; liste: ReactNode; fiche: ReactNode }) {
  return (
    <div className={cx("grid grid-cols-1 items-start gap-5", ouverte && "lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]")}>
      <div className={cx("min-w-0", ouverte && "max-lg:hidden")}>{liste}</div>
      {ouverte && <div className="min-w-0 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto lg:rounded-[20px]">{fiche}</div>}
    </div>
  );
}

/**
 * Panneau d'une fiche : titre qui prend le focus à l'ouverture, Échap et le bouton « Fermer » le
 * referment ; sur téléphone, « Retour à la liste ».
 */
export function Panneau({ titre, sousTitre, etiquette, tampons, onFermer, children }: { titre: string; sousTitre?: ReactNode; etiquette: string; tampons?: ReactNode; onFermer: () => void; children: ReactNode }) {
  const titreRef = useRef<HTMLHeadingElement>(null);
  const titreId = useId();
  // Le panneau est remonté pour chaque fiche (clé de l'objet) : le focus va au titre à l'ouverture.
  // Sur grand écran la fiche colle sous l'en-tête et reste visible ; sur téléphone, elle remplace
  // la liste et la page défile jusqu'à elle.
  useEffect(() => {
    titreRef.current?.focus({ preventScroll: window.matchMedia("(min-width: 1024px)").matches });
  }, []);
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    // Une fenêtre ouverte depuis la fiche garde Échap pour elle.
    if ((e.target as HTMLElement).closest('[role="dialog"]')) return;
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.stopPropagation();
      onFermer();
    }
  };
  return (
    <section aria-labelledby={titreId} onKeyDown={onKey} className={cx(FEUILLE, "n-surgir min-w-0")}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-4 pt-4">
        <div className="min-w-0">
          <button type="button" onClick={onFermer} className="mb-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent lg:hidden">
            <ChevronLeft className="h-3.5 w-3.5" /> Retour à la liste
          </button>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{etiquette}</p>
          <h2 ref={titreRef} id={titreId} tabIndex={-1} className="mt-1 font-display text-[19px] font-[620] leading-snug tracking-[-0.01em] text-ink outline-none">
            {titre}
          </h2>
          {sousTitre && <div className="mt-1 text-[13px] leading-snug text-muted">{sousTitre}</div>}
          {tampons && <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{tampons}</div>}
        </div>
        <button type="button" onClick={onFermer} className="-mr-1 hidden h-9 w-9 flex-none place-items-center rounded-xl text-muted transition-colors hover:bg-panel-3 hover:text-ink lg:grid" aria-label="Fermer la fiche">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  );
}

/** Rubrique d'une fiche : un intertitre et son contenu. */
export function Rubrique({ titre, actions, children }: { titre: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{titre}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Liste de définitions d'une fiche, deux colonnes au-delà du téléphone. */
export function Definitions({ lignes }: { lignes: Array<[string, ReactNode] | false | null | undefined | ""> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2">
      {lignes.filter((l): l is [string, ReactNode] => Boolean(l)).map(([terme, valeur]) => (
        <div key={terme} className="min-w-0">
          <dt className="text-[12px] text-muted">{terme}</dt>
          <dd className="m-0 mt-0.5 text-ink">{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ─── Listes paginées ──────────────────────────────────────────────────── */

/** Pages d'une liste servie par le noyau : « 51 à 100 sur 245 », précédentes et suivantes. */
export function Pages({ offset, limit, total, nom, onPage }: { offset: number; limit: number; total: number; nom: string; onPage: (offset: number) => void }) {
  if (total <= limit) return null;
  const fin = Math.min(offset + limit, total);
  return (
    <nav aria-label={`Pages des ${nom}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
      <span className="tabular">
        {fmtInt(offset + 1)} à {fmtInt(fin)} sur {fmtInt(total)}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>
          <ChevronLeft className="h-4 w-4" /> Précédentes
        </Button>
        <Button size="sm" disabled={fin >= total} onClick={() => onPage(offset + limit)}>
          Suivantes <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

/** Bascule d'un filtre (« En retard », « Bloquantes seulement ») : un bouton pressé ou non, avec son nombre. */
export function Bascule({ actif, onChange, children, nombre }: { actif: boolean; onChange: (actif: boolean) => void; children: ReactNode; nombre?: number }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={() => onChange(!actif)}
      className={cx(
        "inline-flex min-h-9 items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[13px] font-semibold transition-colors",
        actif ? "border-accent bg-accent-doux text-ink" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
      )}
    >
      <span aria-hidden className={cx("grid h-4 w-4 place-items-center rounded-[4px] border", actif ? "border-accent bg-accent text-accent-ink" : "border-line-strong")}>
        {actif && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" focusable="false">
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children}
      {nombre !== undefined && <span className={cx("rounded-full px-1.5 py-px text-[11.5px] tabular", actif ? "bg-panel text-ink" : "bg-panel-3 text-muted")}>{fmtInt(nombre)}</span>}
    </button>
  );
}
