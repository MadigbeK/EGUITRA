/**
 * Réglages de l'application, fixés à la construction (variables EXPO_PUBLIC_*, voir .env.example).
 *
 * API_URL : entrée de l'API réservée aux applications natives, sans barre finale. Les chemins de
 * l'API (« /auth/login », « /transport/sync ») s'y ajoutent tels quels. Sans adresse, une version de
 * développement ou de démonstration travaille sur un serveur simulé (src/api/simulation.ts) ; une
 * version publiée refuse de démarrer : elle ne doit jamais montrer de données inventées. Serveur
 * de travail effectif : src/serveur.ts.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/**
 * Version de démonstration (profil de construction « preview ») : bureau simulé embarqué, et choix
 * du serveur à l'écran de connexion pour passer sur la recette. Jamais dans une version publiée.
 */
export const DEMONSTRATION = process.env.EXPO_PUBLIC_DEMONSTRATION === "1";

/** Nom de l'environnement affiché sous le titre hors production (« Recette »), vide en production. */
export const ENVIRONNEMENT = process.env.EXPO_PUBLIC_ENVIRONMENT ?? "";

/**
 * Code d'application transmis au noyau (addons/eguitra_api/organisation.py, APPS) : « terrain »,
 * ajouté par le module HSSEQ (profils admin, hsseq, exploitation et conducteur, société EGUITRA
 * GROUP, sessions longues pour l'exploitation et le conducteur). Sur un noyau sans module HSSEQ,
 * EXPO_PUBLIC_APP_CODE=mobile ouvre l'application sous le code de Rotations (Rotations seules).
 */
export const APP_CODE = process.env.EXPO_PUBLIC_APP_CODE === "mobile" ? "mobile" : "terrain";

/**
 * Délais de réponse du bureau, repris de Rotations web : 8 s pour une liste (la dernière connue
 * reste affichée), 20 s pour un envoi de saisies (un envoi abandonné repart tel quel : le bureau
 * reconnaît une saisie déjà reçue).
 */
export const DELAI_LISTE = 8_000;
export const DELAI_ENVOI = 20_000;

/** Au-delà, un échange réussi dit aussi un réseau faible. */
export const ECHANGE_LENT = 5_000;

/** Envoi automatique des saisies en attente, application au premier plan. */
export const INTERVALLE_ENVOI = 120_000;

/** Saisies envoyées par requête : le noyau en accepte 100 au plus (MAX_SYNC). */
export const LOT_ENVOI = 50;
