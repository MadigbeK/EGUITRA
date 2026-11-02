"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, Trash2 } from "@/components/icons";
import { Button, Modal, Notice, cx, demanderConfirmation, useVisible } from "@/components/ui";
import { apiSend, apiUpload, appHeader } from "@/lib/api-client";
import { initiales } from "@/lib/discussions";
import { messageErreur } from "./commun";

/**
 * Photo d'un salarié (ou la sienne, dans Mon espace), à défaut ses initiales sur une couleur tirée de son
 * nom. La photo est lue par la passerelle avec les en-têtes de la page (application, société) puis montrée
 * depuis la mémoire du navigateur ; le noyau la sert avec une empreinte et un cache privé revalidé à
 * chaque affichage : les droits sont vérifiés à chaque fois, sans retransférer une photo inchangée.
 */

/** Taille des photos lues : 128 pour les listes et les vignettes, 512 pour la fiche. */
export type TaillePhoto = 128 | 512;

/** Adresse de la photo (null : pas de photo). La version change à chaque envoi ou retrait. */
export function cheminPhoto(id: number | "moi", version: string | null | undefined, taille: TaillePhoto = 128): string | null {
  if (!version) return null;
  const base = id === "moi" ? "/rh/me/photo" : `/rh/employees/${id}/photo`;
  return `${base}?size=${taille}&v=${encodeURIComponent(version)}`;
}

const memoire = new Map<string, Promise<string | null>>();

function charger(chemin: string): Promise<string | null> {
  let promesse = memoire.get(chemin);
  if (!promesse) {
    promesse = fetch(`/api/odoo${chemin}`, { headers: appHeader(), credentials: "same-origin" })
      .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
      .catch(() => null);
    memoire.set(chemin, promesse);
    // Échec (session expirée, réseau) : l'affichage suivant réessaie.
    void promesse.then((url) => {
      if (!url) memoire.delete(chemin);
    });
  }
  return promesse;
}

const TAILLES = {
  sm: "h-9 w-9 text-[12px]",
  md: "h-14 w-14 text-[16px]",
  lg: "h-24 w-24 text-[26px]",
  xl: "h-36 w-36 text-[38px] sm:h-40 sm:w-40",
} as const;

/** Teinte stable tirée du nom : deux homonymes ont la même, deux collègues voisins rarement. */
function teinte(nom: string): number {
  let h = 0;
  for (const c of nom) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function PhotoSalarie({ chemin, nom, taille = "md", className }: { chemin: string | null; nom: string; taille?: keyof typeof TAILLES; className?: string }) {
  const [ref, visible] = useVisible<HTMLSpanElement>("200px");
  const [charge, setCharge] = useState<{ chemin: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!chemin || !visible) return;
    let actif = true;
    void charger(chemin).then((url) => {
      if (actif) setCharge({ chemin, url });
    });
    return () => {
      actif = false;
    };
  }, [chemin, visible]);
  // Photo remplacée : l'ancienne reste visible le temps de charger la nouvelle ; retirée : les initiales.
  const url = chemin ? charge?.url ?? null : null;
  return (
    <span
      ref={ref}
      className={cx("relative grid flex-none place-items-center overflow-hidden rounded-full font-display font-bold tracking-[0.04em] text-white", TAILLES[taille], className)}
      style={url ? undefined : { backgroundColor: `hsl(${teinte(nom)} 38% 40%)` }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- photo lue en mémoire (blob), hors de l'optimiseur d'images
        <img src={url} alt={`Photo de ${nom}`} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initiales(nom)}</span>
      )}
    </span>
  );
}

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX = 5 * 1024 * 1024;

/** Contrôle avant envoi (le noyau refait le sien, au contenu) : message clair, sans aller-retour. */
export function erreurPhoto(fichier: File): string | null {
  if (fichier.size > MAX) return `Photo trop volumineuse (${(fichier.size / 1024 / 1024).toFixed(1).replace(".", ",")} Mo) : 5 Mo au plus.`;
  if (fichier.type && !TYPES.includes(fichier.type)) return "Format non reconnu : photo au format JPEG, PNG ou WebP seulement.";
  return null;
}

/**
 * Commandes de la photo : « Ajouter une photo » ou « Remplacer » et « Retirer », avec un aperçu avant
 * l'envoi. cible : un dossier (gestion RH) ou « moi » (Mon espace).
 */
export function CommandesPhoto({ cible, nom, aPhoto, peutRetirer = true, libelleAjout = "Ajouter une photo", libelleRemplacer = "Remplacer", onChange }: { cible: number | "moi"; nom: string; aPhoto: boolean; peutRetirer?: boolean; libelleAjout?: string; libelleRemplacer?: string; onChange: (version: string | null) => void }) {
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [retrait, setRetrait] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const chemin = cible === "moi" ? "/rh/me/photo" : `/rh/employees/${cible}/photo`;

  function choisir(f: File | undefined) {
    setErreur(null);
    if (!f) return;
    const refus = erreurPhoto(f);
    if (refus) setErreur(refus);
    else setFichier(f);
  }

  async function retirer() {
    if (!(await demanderConfirmation(cible === "moi" ? "Retirer votre photo ?" : `Retirer la photo de ${nom} ?`, { action: "Retirer", danger: true }))) return;
    setErreur(null);
    setRetrait(true);
    try {
      await apiSend("DELETE", chemin);
      onChange(null);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setRetrait(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => champ.current?.click()}>
          <ImageUp className="h-3.5 w-3.5" /> {aPhoto ? libelleRemplacer : libelleAjout}
        </Button>
        {aPhoto && peutRetirer && (
          <Button size="sm" variant="ghost" loading={retrait} onClick={() => void retirer()}>
            <Trash2 className="h-3.5 w-3.5" /> Retirer
          </Button>
        )}
      </div>
      <input
        ref={champ}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Choisir une photo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          choisir(f);
        }}
      />
      {erreur && <p className="max-w-xs text-center text-[12.5px] font-medium text-danger">{erreur}</p>}
      {fichier && (
        <ApercuPhoto
          fichier={fichier}
          chemin={chemin}
          nom={nom}
          onClose={() => setFichier(null)}
          onDone={(version) => {
            setFichier(null);
            onChange(version);
          }}
        />
      )}
    </div>
  );
}

/** Aperçu de la photo choisie, recadrée en carré comme le fera le noyau, puis envoi. */
function ApercuPhoto({ fichier, chemin, nom, onClose, onDone }: { fichier: File; chemin: string; nom: string; onClose: () => void; onDone: (version: string | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(fichier);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [fichier]);

  async function envoyer() {
    setBusy(true);
    setErreur(null);
    const form = new FormData();
    form.append("file", fichier);
    try {
      const reponse = await apiUpload<{ photo: string | null }>(chemin, form);
      onDone(reponse.photo);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Aperçu de la photo"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void envoyer()}>
            Enregistrer la photo
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <span className="grid h-48 w-48 place-items-center overflow-hidden rounded-full bg-panel-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local du fichier choisi */}
          {url && <img src={url} alt={`Aperçu de la photo de ${nom}`} className="h-full w-full object-cover" />}
        </span>
        <p className="max-w-sm text-center text-[12.5px] text-muted">
          La photo est recadrée en carré et réduite ; ses informations cachées (appareil, lieu de prise de vue) ne sont pas conservées. JPEG, PNG ou WebP, 5 Mo au plus.
        </p>
      </div>
    </Modal>
  );
}
