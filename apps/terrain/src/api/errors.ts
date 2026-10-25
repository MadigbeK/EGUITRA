/** Réponse d'erreur du bureau (l'API) : statut HTTP, code stable et message déjà rédigé en français. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Le bureau n'a pas répondu dans le délai : la demande peut repartir telle quelle. */
export class DelaiDepasse extends Error {
  constructor() {
    super("Réseau faible : le bureau n'a pas répondu à temps.");
    this.name = "DelaiDepasse";
  }
}

/** Aucune liaison : appareil hors réseau ou serveur injoignable. */
export class HorsReseau extends Error {
  constructor() {
    super("Réseau indisponible.");
    this.name = "HorsReseau";
  }
}

export const SESSION_EXPIREE = "Session expirée. Reconnectez-vous.";

/** Message d'une réponse sans corps lisible, selon son statut. */
export function messageParDefaut(status: number): string {
  if (status === 401) return SESSION_EXPIREE;
  if (status === 403) return "Accès non autorisé pour votre profil.";
  if (status === 404) return "Service introuvable : l'application est peut-être à mettre à jour.";
  if (status === 429) return "Trop de demandes : patientez une minute.";
  if (status >= 500) return "Le bureau rencontre un incident. Vos saisies restent sur l'appareil.";
  return "Demande refusée par le bureau.";
}
