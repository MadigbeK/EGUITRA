import type { ApiErrorBody } from "./types";

/**
 * Erreurs des appels à la passerelle, et le message à montrer pour chacune. Rien de technique ni
 * d'anglais n'arrive à l'écran : ni « Failed to fetch », ni « Unexpected token », ni un code brut.
 */

/** Message d'une réponse d'erreur du service qui n'en porte pas (code seul, page d'erreur du serveur). */
export function messageStatut(status: number): string {
  if (status === 400) return "Demande refusée par le service : vérifiez la saisie.";
  if (status === 401) return "Session expirée : reconnectez-vous.";
  if (status === 403) return "Accès non autorisé pour votre profil.";
  if (status === 404) return "Élément introuvable : l'adresse est incomplète ou l'élément n'existe plus.";
  if (status === 409) return "L'élément a été modifié entre-temps : rechargez l'écran puis réessayez.";
  if (status === 413) return "Fichier trop volumineux.";
  if (status === 422) return "Opération refusée par une règle de gestion.";
  if (status === 429) return "Trop de demandes en peu de temps : réessayez dans un instant.";
  if (status >= 500) return "Service momentanément indisponible. Réessayez dans un instant.";
  return `Le service a refusé la demande (code ${status}).`;
}

/** Erreur d'appel à l'API, avec le message destiné à l'utilisateur. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message || messageStatut(status));
    this.name = "ApiError";
  }
}

/**
 * Pas de réponse dans le délai demandé (réseau faible) : la requête est abandonnée. Ce n'est pas une
 * ApiError (aucune réponse du noyau) : l'appelant la traite comme une coupure du réseau.
 */
export class DelaiDepasse extends Error {
  constructor(public delai: number) {
    super("Le réseau ne répond pas à temps.");
    this.name = "DelaiDepasse";
  }
}

/** Message d'une coupure du réseau (aucune réponse du serveur). */
export const MESSAGE_RESEAU = "Réseau indisponible : vérifiez la connexion puis réessayez.";

/**
 * Aucune réponse : réseau coupé, ou passerelle injoignable. Hérite de TypeError, l'erreur que lève
 * fetch dans ce cas : le code qui reconnaît une coupure (tout ce qui n'est pas une ApiError) ne
 * change pas.
 */
export class ReseauIndisponible extends TypeError {
  constructor(public origine?: unknown) {
    super(MESSAGE_RESEAU);
    this.name = "ReseauIndisponible";
  }
}

/** Erreur de fetch lui-même (« Failed to fetch », « Load failed », « NetworkError… »). */
function coupure(e: unknown): boolean {
  return e instanceof ReseauIndisponible || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message));
}

/**
 * Message à montrer pour l'échec d'un appel : celui du service (ApiError), du délai dépassé ou de la
 * coupure du réseau ; pour toute autre erreur, `defaut`. Les écrans s'en servent à la place de
 * `e.message`, qui peut être celui du navigateur, en anglais.
 */
export function messageErreur(e: unknown, defaut = "Une erreur est survenue. Réessayez."): string {
  if (e instanceof ApiError || e instanceof DelaiDepasse) return e.message;
  if (coupure(e)) return MESSAGE_RESEAU;
  return defaut;
}
