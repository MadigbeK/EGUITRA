import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_URL, DEMONSTRATION } from "./config";

/**
 * Serveur de travail de l'application.
 * - Version publiée : l'adresse fixée à la construction (EXPO_PUBLIC_API_URL), rien d'autre.
 * - Version de démonstration (profil de construction « preview », EXPO_PUBLIC_DEMONSTRATION=1) : le
 *   bureau simulé embarqué (src/api/simulation.ts), ou l'adresse d'un bureau saisie à l'écran de
 *   connexion, pour passer sur la recette dès qu'elle est prête.
 * - Développement sans adresse : le bureau simulé.
 *
 * Chaque serveur a son espace sur l'appareil : base locale, coffre (jetons, profil, résultats
 * d'alcootest) et code personnel. Une saisie de démonstration ne part donc jamais vers un vrai
 * bureau, et un compte de la recette ne retrouve rien de la démonstration.
 */
export type Serveur = { mode: "simulation" } | { mode: "bureau"; url: string };

const CLE = "nimova.terrain.serveur";
const web = Platform.OS === "web";
let memoire: string | null = null;

/** Choix du serveur offert à l'écran de connexion : version de démonstration seulement. */
export const CHOIX_SERVEUR = DEMONSTRATION;

function parDefaut(): Serveur {
  return API_URL ? { mode: "bureau", url: API_URL } : { mode: "simulation" };
}

let actif: Serveur = parDefaut();

export function serveurActif(): Serveur {
  return actif;
}

export function enSimulation(): boolean {
  return actif.mode === "simulation";
}

/** Entrée de l'API du serveur actif, sans barre finale ; vide sur le bureau simulé. */
export function baseApi(): string {
  return actif.mode === "bureau" ? actif.url : "";
}

/** Le bureau simulé n'est permis qu'en développement et en version de démonstration. */
export function serveurUtilisable(): boolean {
  return actif.mode === "bureau" || DEMONSTRATION || __DEV__;
}

/**
 * Adresse d'un bureau saisie à l'écran : https seulement, sans identifiant, paramètre ni ancre, sans
 * barre finale. Null si elle ne convient pas.
 */
export function adresseValide(texte: string): string | null {
  const t = texte.trim().replace(/\/+$/, "");
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.hostname.includes(".")) return null;
    return t;
  } catch {
    return null;
  }
}

/** Lit le serveur choisi sur l'appareil (version de démonstration) ; sinon celui de la construction. */
export async function chargerServeur(): Promise<Serveur> {
  if (!CHOIX_SERVEUR) return actif;
  let brut: string | null = null;
  try {
    brut = web ? memoire : await SecureStore.getItemAsync(CLE);
  } catch {
    brut = null;
  }
  try {
    const lu = brut ? (JSON.parse(brut) as Serveur) : null;
    if (lu?.mode === "simulation") actif = lu;
    else if (lu?.mode === "bureau" && adresseValide(lu.url)) actif = { mode: "bureau", url: adresseValide(lu.url)! };
  } catch {
    // Choix illisible : celui de la construction.
  }
  return actif;
}

/** Nouveau serveur, choisi à l'écran de connexion (aucune session ouverte). */
export async function choisirServeur(s: Serveur): Promise<void> {
  if (!CHOIX_SERVEUR) return;
  const sur: Serveur = s.mode === "bureau" ? { mode: "bureau", url: adresseValide(s.url) ?? "" } : s;
  if (sur.mode === "bureau" && !sur.url) throw new Error("Adresse invalide.");
  const brut = JSON.stringify(sur);
  if (web) memoire = brut;
  else await SecureStore.setItemAsync(CLE, brut);
  actif = sur;
}

/**
 * Nom de l'espace du serveur actif : vide pour l'adresse de la construction (les clés d'origine),
 * « demo » pour le bureau simulé, l'hôte pour une autre adresse saisie.
 */
function espace(): string {
  if (actif.mode === "simulation") return "demo";
  if (actif.url === API_URL) return "";
  try {
    return new URL(actif.url).host.replace(/[^a-zA-Z0-9.-]/g, "_");
  } catch {
    return "autre";
  }
}

/** Clé du coffre dans l'espace du serveur actif (« nimova.terrain.jeton » devient « nimova.terrain.demo.jeton »). */
export function cleDeLEspace(cle: string): string {
  const e = espace();
  return e ? cle.replace(/^nimova\.terrain\./, `nimova.terrain.${e}.`) : cle;
}

/** Base locale du serveur actif. */
export function baseLocale(): string {
  const e = espace();
  return e ? `terrain-${e}.db` : "terrain.db";
}

/** Libellé du serveur pour l'écran : « Démonstration » ou l'hôte. */
export function libelleServeur(s: Serveur = actif): string {
  if (s.mode === "simulation") return "Démonstration (bureau simulé)";
  try {
    return new URL(s.url).host;
  } catch {
    return s.url;
  }
}
