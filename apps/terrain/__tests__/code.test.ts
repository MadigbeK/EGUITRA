import { codePersonnel, codeValide, ESSAIS_MAX } from "../src/auth/codePersonnel";

function coffre() {
  const m = new Map<string, string>();
  return {
    m,
    lire: async (k: string) => m.get(k) ?? null,
    ecrire: async (k: string, v: string) => {
      m.set(k, v);
    },
    effacer: async (k: string) => {
      m.delete(k);
    },
  };
}

// Empreinte de test, déterministe (l'appareil emploie SHA-256) : deux hachages djb2 croisés.
const hacher = async (t: string) => {
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < t.length; i += 1) {
    a = (a * 33) ^ t.charCodeAt(i);
    b = (b * 31) ^ t.charCodeAt(t.length - 1 - i);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
};

describe("code personnel", () => {
  it("refuse les codes trop simples", () => {
    expect(codeValide("2580")).toBe(true);
    expect(codeValide("193746")).toBe(true);
    expect(codeValide("0000")).toBe(false);
    expect(codeValide("1234")).toBe(false);
    expect(codeValide("6543")).toBe(false);
    expect(codeValide("123")).toBe(false);
    expect(codeValide("12a4")).toBe(false);
  });

  it("ne garde que l'empreinte salée, jamais le code", async () => {
    const c = coffre();
    const code = codePersonnel(c, hacher, () => "sel-1");
    await code.definir(7, "2580");
    const garde = [...c.m.values()][0]!;
    expect(garde).not.toContain("2580");
    expect(await code.verifier(7, "2580")).toEqual({ ok: true, restants: ESSAIS_MAX });
  });

  it("oublie le code après cinq erreurs, et remet le compte à zéro après un bon code", async () => {
    const c = coffre();
    const code = codePersonnel(c, hacher, () => "sel-2");
    await code.definir(7, "2580");
    expect(await code.verifier(7, "1111")).toEqual({ ok: false, restants: 4 });
    expect((await code.verifier(7, "2580")).ok).toBe(true);
    for (let i = 4; i >= 1; i -= 1) expect(await code.verifier(7, "9999")).toEqual({ ok: false, restants: i });
    expect(await code.verifier(7, "9999")).toEqual({ ok: false, restants: 0 });
    expect(await code.existe(7)).toBe(false);
  });

  it("garde un code par utilisateur de l'appareil", async () => {
    const code = codePersonnel(coffre(), hacher, () => "sel-3");
    await code.definir(7, "2580");
    await code.definir(9, "7391");
    expect((await code.verifier(9, "2580")).ok).toBe(false);
    expect((await code.verifier(9, "7391")).ok).toBe(true);
  });
});
