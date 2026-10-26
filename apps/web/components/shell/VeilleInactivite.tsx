"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { AppCode } from "@/lib/config";
import { pluriel } from "@/lib/format";

/**
 * Déconnexion automatique après inactivité (demande du gérant, 26 octobre 2026). Après
 * DELAI_INACTIVITE_MS sans activité, une fenêtre demande « Êtes-vous toujours là ? » ; sans réponse au
 * bout de DELAI_REPONSE_MS, la session est fermée (route de déconnexion : jetons révoqués, cookies
 * effacés) et la page de connexion le dit.
 *
 * Activité : clic, frappe, saisie, défilement, toucher, mouvement de la souris ; elle vaut pour tous
 * les onglets du navigateur (BroadcastChannel, et le stockage local à défaut) : personne n'est
 * déconnecté pendant qu'il travaille dans un autre onglet, et la déconnexion ferme tous les onglets.
 * Posée par la coque des applications, l'accueil et le portail ; jamais dans Rotations (/mobile), dont
 * la session longue et les saisies hors réseau doivent rester.
 */

/** Délai sans activité avant la question (décision du gérant : 1 minute). */
export const DELAI_INACTIVITE_MS = 60_000;
/** Temps laissé pour répondre, compte à rebours affiché, avant la déconnexion. */
export const DELAI_REPONSE_MS = 30_000;

/** Dernière activité de tous les onglets (stockage local). */
const CLE_ACTIVITE = "nimova-derniere-activite";
/** Déconnexion annoncée aux autres onglets quand BroadcastChannel manque (stockage local). */
const CLE_DECONNEXION = "nimova-deconnexion";
const CANAL = "nimova-session";
/** L'activité n'est partagée qu'une fois toutes les deux secondes au plus. */
const PARTAGE_MS = 2_000;
/** Événements qui comptent comme une activité (la frappe en cours comprise). */
const EVENEMENTS = ["pointerdown", "pointermove", "keydown", "input", "wheel", "scroll", "touchstart"] as const;
/** Secondes restantes annoncées aux lecteurs d'écran (le compte à rebours visible avance chaque seconde). */
const ANNONCES = new Set([20, 10, 5]);

type Motif = "inactivite" | "volontaire";
type Message = { type: "activite"; t: number } | { type: "deconnexion"; motif: Motif };

function ouvrirCanal(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CANAL);
  } catch {
    return null;
  }
}

function lireActivite(): number {
  try {
    return Number(window.localStorage.getItem(CLE_ACTIVITE)) || 0;
  } catch {
    return 0;
  }
}

function ecrireActivite(t: number) {
  try {
    window.localStorage.setItem(CLE_ACTIVITE, String(t));
  } catch {
    // Stockage refusé (navigation privée, réglage) : le canal suffit.
  }
}

/**
 * Déconnexion lancée dans cet onglet : le canal la redélivre aussi aux autres écouteurs de l'onglet,
 * qui ne doivent pas quitter la page avant la fin de la requête de déconnexion (elle serait annulée).
 */
let lanceeIci = false;

/** Annonce aux autres onglets que la session est fermée : ils rejoignent la page de connexion. */
export function annoncerDeconnexion(motif: Motif) {
  lanceeIci = true;
  const canal = ouvrirCanal();
  canal?.postMessage({ type: "deconnexion", motif } satisfies Message);
  canal?.close();
  try {
    window.localStorage.setItem(CLE_DECONNEXION, `${motif}:${Date.now()}`);
  } catch {
    // Stockage refusé : le canal suffit.
  }
}

function pageDeConnexion(app: AppCode, motif: Motif | null): string {
  return `/login?app=${app}${motif === "inactivite" ? "&message=inactivite" : ""}`;
}

export function VeilleInactivite({ app }: { app: AppCode }) {
  const [ouvert, setOuvert] = useState(false);
  const [restant, setRestant] = useState(Math.round(DELAI_REPONSE_MS / 1000));
  const [annonce, setAnnonce] = useState("");
  const descriptionId = useId();
  const ouvertRef = useRef(false);
  const fini = useRef(false);
  const derniere = useRef(0);
  const noter = useRef<(t?: number) => void>(() => undefined);

  const quitter = useCallback(
    (motif: Motif | null) => {
      fini.current = true;
      window.location.href = pageDeConnexion(app, motif);
    },
    [app],
  );

  const deconnecter = useCallback(
    async (motif: Motif) => {
      if (fini.current) return;
      fini.current = true;
      annoncerDeconnexion(motif);
      await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
      window.location.href = pageDeConnexion(app, motif);
    },
    [app],
  );

  const fermer = useCallback(() => {
    ouvertRef.current = false;
    setOuvert(false);
    setAnnonce("");
  }, []);

  useEffect(() => {
    const canal = ouvrirCanal();
    let partage = 0;
    // Activité : dans cet onglet (partagée) ou annoncée par un autre (reçue).
    const marquer = (t: number, partager: boolean) => {
      if (t <= derniere.current) return;
      derniere.current = t;
      if (!partager || t - partage < PARTAGE_MS) return;
      partage = t;
      ecrireActivite(t);
      canal?.postMessage({ type: "activite", t } satisfies Message);
    };
    noter.current = (t = Date.now()) => marquer(t, true);
    // L'ouverture de la page est une activité.
    derniere.current = Math.max(lireActivite(), 0);
    marquer(Date.now(), true);

    // Fenêtre ouverte : seule une réponse compte (bouton, Échap), pas un mouvement de souris.
    const surActivite = () => {
      if (!ouvertRef.current) marquer(Date.now(), true);
    };
    for (const type of EVENEMENTS) document.addEventListener(type, surActivite, { capture: true, passive: true });

    const surMessage = (e: MessageEvent<Message>) => {
      const m = e.data;
      if (m?.type === "activite" && typeof m.t === "number") marquer(m.t, false);
      else if (m?.type === "deconnexion" && !fini.current && !lanceeIci) quitter(m.motif);
    };
    canal?.addEventListener("message", surMessage);
    const surStockage = (e: StorageEvent) => {
      if (e.key === CLE_ACTIVITE && e.newValue) marquer(Number(e.newValue) || 0, false);
      if (e.key === CLE_DECONNEXION && e.newValue && !fini.current) quitter(e.newValue.startsWith("inactivite") ? "inactivite" : "volontaire");
    };
    window.addEventListener("storage", surStockage);

    const minute = window.setInterval(() => {
      if (fini.current) return;
      const inactif = Date.now() - Math.max(derniere.current, lireActivite());
      // Activité ailleurs (un autre onglet a répondu ou travaille) : la question se referme.
      if (inactif < DELAI_INACTIVITE_MS) {
        if (ouvertRef.current) fermer();
        return;
      }
      const reste = DELAI_INACTIVITE_MS + DELAI_REPONSE_MS - inactif;
      if (reste <= 0) {
        void deconnecter("inactivite");
        return;
      }
      const secondes = Math.ceil(reste / 1000);
      setRestant(secondes);
      if (!ouvertRef.current) {
        ouvertRef.current = true;
        setOuvert(true);
      } else if (ANNONCES.has(secondes)) {
        setAnnonce(`Déconnexion dans ${pluriel(secondes, "seconde")}.`);
      }
    }, 1000);

    return () => {
      window.clearInterval(minute);
      for (const type of EVENEMENTS) document.removeEventListener(type, surActivite, { capture: true });
      canal?.removeEventListener("message", surMessage);
      canal?.close();
      window.removeEventListener("storage", surStockage);
    };
  }, [deconnecter, fermer, quitter]);

  /** « Je suis là » : la question se referme dans tous les onglets et la session est renouvelée. */
  async function present() {
    fermer();
    noter.current(Date.now());
    // La passerelle renouvelle les jetons s'ils approchent de leur fin ; une session déjà perdue mène
    // à la page de connexion.
    const res = await fetch("/api/odoo/auth/me", { headers: { Accept: "application/json", "X-Eguitra-App": app }, cache: "no-store" }).catch(() => null);
    if (res?.status === 401) quitter(null);
  }

  return (
    <Modal
      open={ouvert}
      alerte
      descriptionId={descriptionId}
      title={"Êtes-vous toujours là ?"}
      onClose={() => void present()}
      footer={
        <>
          <Button onClick={() => void deconnecter("volontaire")}>Me déconnecter</Button>
          <Button variant="primary" data-autofocus="" onClick={() => void present()}>
            Je suis là
          </Button>
        </>
      }
    >
      <p id={descriptionId} className="text-sm leading-relaxed text-ink-2">
        Aucune activité depuis un moment. Sans réponse, vous serez déconnecté dans{" "}
        <strong className="font-semibold tabular text-ink">{pluriel(restant, "seconde")}</strong>, pour protéger vos données.
      </p>
      <p aria-live="assertive" className="sr-only">
        {annonce}
      </p>
    </Modal>
  );
}
