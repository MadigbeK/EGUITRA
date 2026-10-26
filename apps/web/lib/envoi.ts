"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, apiDownload } from "./api-client";

/** Message rendu à l'utilisateur après une écriture : réussite ou refus du noyau. */
export type MessageEnvoi = { tone: "ok" | "danger"; text: string } | null;

/** Message d'erreur destiné à l'utilisateur : celui du noyau, sinon `defaut` (coupure du réseau). */
export function messageErreur(e: unknown, defaut = "Action impossible."): string {
  return e instanceof ApiError ? e.message : defaut;
}

/**
 * État d'envoi d'un écran ou d'une fenêtre : une seule écriture à la fois. Le bouton cliqué tourne
 * (busy vaut sa clé), les autres se bloquent sur `busy`, un second clic pendant l'appel est ignoré
 * (verrou posé avant même le rendu), et `busy` revient à null dans finally, réussite ou échec.
 *
 *   const envoi = useEnvoi();
 *   <Button loading={envoi.busy === "soumettre"} disabled={!!envoi.busy}
 *     onClick={() => envoi.run("soumettre", () => apiSend("POST", …), "Engagement soumis.")}>
 *   {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
 *
 * run rend true si l'appel a réussi (pour fermer une fenêtre ou vider un formulaire seulement alors).
 */
export function useEnvoi() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<MessageEnvoi>(null);
  const verrou = useRef(false);

  const run = useCallback(async (cle: string, fn: () => Promise<unknown>, ok?: string, defaut?: string): Promise<boolean> => {
    if (verrou.current) return false;
    verrou.current = true;
    setBusy(cle);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ tone: "ok", text: ok });
      return true;
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, defaut) });
      return false;
    } finally {
      verrou.current = false;
      setBusy(null);
    }
  }, []);

  /** Export (PDF, XLSX, CSV) : même état d'envoi, et un échec affiché au lieu d'un clic sans effet. */
  const telecharger = useCallback(
    (cle: string, path: string, nom: string) => run(cle, () => apiDownload(path, nom), undefined, "Téléchargement impossible : vérifiez le réseau, puis réessayez."),
    [run],
  );

  return { busy, message, setMessage, run, telecharger };
}
