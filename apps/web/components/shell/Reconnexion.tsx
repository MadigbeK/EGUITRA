"use client";

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LoginForm } from "@/app/login/LoginForm";
import { Modal } from "@/components/ui";
import { appFromPath, isAppCode, type AppCode } from "@/lib/config";

/**
 * Reconnexion sur place. Une page restée ouverte au-delà de la session (12 heures sans activité,
 * 7 jours en tout) reçoit un 401 de la passerelle : au lieu de quitter la page, ce qui perdait la
 * facture, le compte rendu ou l'évaluation en cours, une fenêtre propose de se reconnecter ; l'appel
 * repart ensuite de lui-même (lib/api-client).
 *
 * La coque (AppShell) déclare le compte de la page : data-utilisateur-id, data-compte (identifiant
 * proposé) et data-societe-id. Si un autre compte se connecte, ou si la page ne déclare pas le sien,
 * la page est rechargée : l'écran et la saisie affichés ne sont pas ceux du compte connecté.
 */

/** Fenêtre ouverte : les appels qui attendent la reconnexion partagent la même. */
let enCours: Promise<boolean> | null = null;

/** Rend true une fois reconnecté sous le même compte (l'appel peut repartir), false sinon. */
export function demanderReconnexion(): Promise<boolean> {
  enCours ??= ouvrir().finally(() => {
    enCours = null;
  });
  return enCours;
}

function ouvrir(): Promise<boolean> {
  return new Promise((resolve) => {
    const coque = document.querySelector<HTMLElement>("[data-societe-id]");
    const theme = coque ?? document.querySelector<HTMLElement>("[data-app]");
    const declaree = theme?.dataset.app;
    const app: AppCode = appFromPath(window.location.pathname) ?? (isAppCode(declaree) ? declaree : "finance");
    const hote = document.createElement("div");
    if (declaree) hote.dataset.app = declaree;
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    let repondu = false;
    const finir = (ok: boolean) => {
      if (repondu) return;
      repondu = true;
      resolve(ok);
      // Démontée après l'événement en cours : React ne retire pas une racine pendant qu'il la traite.
      setTimeout(() => {
        racine.unmount();
        hote.remove();
      });
    };
    racine.render(
      <FenetreReconnexion
        app={app}
        identifiant={coque?.dataset.compte ?? ""}
        utilisateur={Number(coque?.dataset.utilisateurId) || null}
        societe={{ id: Number(coque?.dataset.societeId) || null, app: isAppCode(declaree) ? declaree : app }}
        onFin={finir}
      />,
    );
  });
}

function FenetreReconnexion({ app, identifiant, utilisateur, societe, onFin }: { app: AppCode; identifiant: string; utilisateur: number | null; societe: { id: number | null; app: AppCode }; onFin: (ok: boolean) => void }) {
  const [ici] = useState(() => window.location.pathname + window.location.search);

  async function connecte() {
    // Le compte reconnecté est-il celui de la page ?
    const moi = (await fetch("/api/odoo/auth/me", { headers: { Accept: "application/json", "X-Eguitra-App": app } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as { id?: number } | null;
    if (!utilisateur || moi?.id !== utilisateur) {
      window.location.reload();
      onFin(false);
      return;
    }
    // La connexion oublie les sociétés mémorisées : celle de la page est remise, pour que les écrans
    // suivants s'ouvrent dans les mêmes livres.
    if (societe.id) {
      await fetch("/api/session/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: societe.id, app: societe.app }),
      }).catch(() => undefined);
    }
    onFin(true);
  }

  return (
    <Modal open title="Session expirée" onClose={() => onFin(false)}>
      <LoginForm
        app={app}
        next={ici}
        enFenetre
        identifiant={identifiant}
        message="Votre session a expiré. Reconnectez-vous pour continuer : l'écran et votre saisie restent tels quels, l'opération en cours repartira d'elle-même."
        onConnecte={connecte}
      />
      <p className="mt-5 text-center text-[13px] leading-snug text-muted">
        <a href={`/login?app=${app}&next=${encodeURIComponent(ici)}`} className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
          Ouvrir la page de connexion
        </a>{" "}
        (l&apos;écran en cours sera quitté)
      </p>
    </Modal>
  );
}
