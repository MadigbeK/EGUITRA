import type { useRouter } from "expo-router";

/**
 * Retour à l'écran d'avant. Un module ouvert par une adresse directe (lien, notification, reprise à
 * froid) n'a rien derrière lui : le retour mène alors à « Ma journée ».
 */
export function revenir(router: ReturnType<typeof useRouter>): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
