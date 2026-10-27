/**
 * Code personnel de l'appareil (système « terrain », § 3.11) : après la connexion avec double
 * authentification, l'utilisateur choisit un code de 4 à 6 chiffres, redemandé au réveil de
 * l'application et, sur la tablette du dépôt, après 2 minutes sans geste. Le code n'est jamais gardé
 * en clair : seule son empreinte salée, au coffre de l'appareil. Cinq erreurs : la session est
 * oubliée sur l'appareil, il faut se reconnecter.
 */

export const LONGUEUR_MIN = 4;
export const LONGUEUR_MAX = 6;
export const ESSAIS_MAX = 5;
/** Tours d'empreinte : ralentit l'essai de tous les codes si le coffre était lu. */
export const TOURS = 200;

export interface StockageCode {
  lire(cle: string): Promise<string | null>;
  ecrire(cle: string, valeur: string): Promise<void>;
  effacer(cle: string): Promise<void>;
}

interface Garde {
  sel: string;
  empreinte: string;
  erreurs: number;
}

/** Code acceptable : 4 à 6 chiffres, ni répétés (0000), ni suivis (1234, 4321). */
export function codeValide(code: string): boolean {
  if (!new RegExp(`^\\d{${LONGUEUR_MIN},${LONGUEUR_MAX}}$`).test(code)) return false;
  const chiffres = [...code].map(Number);
  const pas = chiffres.slice(1).map((c, i) => c - chiffres[i]!);
  if (pas.every((p) => p === 0)) return false;
  if (pas.every((p) => p === 1) || pas.every((p) => p === -1)) return false;
  return true;
}

const cle = (userId: number) => `nimova.terrain.code.${userId}`;

export function codePersonnel(stockage: StockageCode, hacher: (texte: string) => Promise<string>, sel: () => string) {
  async function empreinte(s: string, code: string): Promise<string> {
    let h = `${s}:${code}`;
    for (let i = 0; i < TOURS; i += 1) h = await hacher(`${s}:${h}`);
    return h;
  }

  async function lire(userId: number): Promise<Garde | null> {
    const brut = await stockage.lire(cle(userId)).catch(() => null);
    if (!brut) return null;
    try {
      return JSON.parse(brut) as Garde;
    } catch {
      return null;
    }
  }

  return {
    existe: async (userId: number) => (await lire(userId)) !== null,

    definir: async (userId: number, code: string): Promise<void> => {
      if (!codeValide(code)) throw new Error("Code personnel invalide.");
      const s = sel();
      await stockage.ecrire(cle(userId), JSON.stringify({ sel: s, empreinte: await empreinte(s, code), erreurs: 0 } satisfies Garde));
    },

    /** Vérifie le code ; `restants` : essais encore permis, 0 quand la session doit être oubliée. */
    verifier: async (userId: number, code: string): Promise<{ ok: boolean; restants: number }> => {
      const garde = await lire(userId);
      if (!garde) return { ok: false, restants: 0 };
      if ((await empreinte(garde.sel, code)) === garde.empreinte) {
        if (garde.erreurs) await stockage.ecrire(cle(userId), JSON.stringify({ ...garde, erreurs: 0 }));
        return { ok: true, restants: ESSAIS_MAX };
      }
      const erreurs = garde.erreurs + 1;
      if (erreurs >= ESSAIS_MAX) {
        await stockage.effacer(cle(userId));
        return { ok: false, restants: 0 };
      }
      await stockage.ecrire(cle(userId), JSON.stringify({ ...garde, erreurs }));
      return { ok: false, restants: ESSAIS_MAX - erreurs };
    },

    effacer: (userId: number) => stockage.effacer(cle(userId)).catch(() => undefined),
  };
}

export type CodePersonnel = ReturnType<typeof codePersonnel>;
