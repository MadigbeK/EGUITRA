/**
 * Réglages de l'application, fixés à la construction (variables EXPO_PUBLIC_*, voir .env.example).
 *
 * API_URL : entrée de l'API réservée aux applications natives, sans barre finale. Les chemins de
 * l'API (« /auth/login », « /transport/sync ») s'y ajoutent tels quels. Sans adresse, une version de
 * développement travaille sur un serveur simulé (src/api/simulation.ts) ; une version publiée refuse
 * de démarrer : elle ne doit jamais montrer de données inventées.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** Nom de l'environnement affiché sous le titre hors production (« Recette »), vide en production. */
export const ENVIRONNEMENT = process.env.EXPO_PUBLIC_ENVIRONMENT ?? "";

/** Serveur simulé : version de développement sans adresse d'API, pour travailler les écrans. */
export const SIMULATION = !API_URL && __DEV__;

/**
 * Code d'application transmis au noyau (addons/eguitra_api/organisation.py, APPS) : celui de
 * Rotations, ouvert aux profils administrateur et exploitation, qui travaille dans la seule société
 * EGUITRA GROUP. Les longues durées de session hors réseau y sont réservées au profil exploitation.
 * Le module HSSEQ (branche hsseq, session OTHER) ajoute au noyau l'application « terrain » (profils
 * admin, hsseq, exploitation et conducteur) : passer à « terrain » une fois ce module intégré.
 */
export const APP_CODE = "mobile";

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
