"use client";

import { useState } from "react";
import { Button, Notice, demanderConfirmation } from "@/components/ui";
import { apiSend, messageErreur } from "@/lib/api-client";
import { pluriel } from "@/lib/format";
import { IconeDiscussion } from "./IconeDiscussion";

/**
 * Administration > Utilisateurs, compte désactivé : le retirer de toutes ses conversations de la
 * discussion interne. L'administration n'en lit aucune : seul leur nombre revient.
 */
export function RetraitDiscussions({ userId, nom }: { userId: number; nom: string }) {
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ ton: "ok" | "danger"; texte: string } | null>(null);

  async function retirer() {
    const ok = await demanderConfirmation(`Retirer ${nom} de toutes ses conversations ? Les autres membres gardent l'historique ; vous n'en lirez aucune.`, { titre: "Retirer des discussions", action: "Retirer", danger: true });
    if (!ok) return;
    setEnvoi(true);
    setMessage(null);
    try {
      const r = await apiSend<{ removed: number }>("POST", `/chat/admin/users/${userId}/remove`);
      setMessage({ ton: "ok", texte: r.removed ? `Compte retiré de ${pluriel(r.removed, "conversation")}.` : "Ce compte ne participait à aucune conversation." });
    } catch (e) {
      setMessage({ ton: "danger", texte: messageErreur(e) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <Button loading={envoi} onClick={() => void retirer()}>
        <IconeDiscussion className="h-4 w-4" /> Retirer des discussions
      </Button>
      {message && (
        <div role={message.ton === "danger" ? "alert" : "status"} className="basis-full">
          <Notice tone={message.ton}>{message.texte}</Notice>
        </div>
      )}
    </>
  );
}
