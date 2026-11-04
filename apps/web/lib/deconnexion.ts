"use client";

/** Message montré quand la session n'a pas pu être fermée : l'écran reste ouvert. */
export const ECHEC_DECONNEXION =
  "Déconnexion impossible : vérifiez la connexion, puis réessayez. La session reste ouverte sur ce poste.";

/**
 * Ferme la session au serveur. Rend true si elle est fermée (ou déjà expirée : 401), false sur une
 * coupure ou un refus. Les écrans ne rejoignent la page de connexion qu'après true : sinon les cookies
 * resteraient valides derrière elle, et le suivant entrerait sans mot de passe sur un poste partagé.
 */
export async function fermerSession(): Promise<boolean> {
  const res = await fetch("/api/session/logout", { method: "POST" }).catch(() => null);
  return !!res && (res.ok || res.status === 401);
}
