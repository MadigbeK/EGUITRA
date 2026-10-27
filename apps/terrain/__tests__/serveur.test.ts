import { adresseValide, baseLocale, cleDeLEspace, enSimulation, serveurActif } from "../src/serveur";

describe("serveur de travail", () => {
  it("n'accepte qu'une adresse https sans identifiant, paramètre ni ancre", () => {
    expect(adresseValide(" https://recette.nimovagroup.com/api/natif/ ")).toBe("https://recette.nimovagroup.com/api/natif");
    for (const a of ["http://recette.nimovagroup.com/api/natif", "https://moi:secret@recette.nimovagroup.com/api/natif", "https://recette.nimovagroup.com/api/natif?x=1", "https://localhost/api/natif", "recette.nimovagroup.com", ""]) {
      expect(adresseValide(a)).toBeNull();
    }
  });

  it("travaille sur le bureau simulé sans adresse de construction, dans son propre espace", () => {
    expect(serveurActif()).toEqual({ mode: "simulation" });
    expect(enSimulation()).toBe(true);
    // Démonstration : ni la base ni le coffre du vrai bureau.
    expect(baseLocale()).toBe("terrain-demo.db");
    expect(cleDeLEspace("nimova.terrain.refresh")).toBe("nimova.terrain.demo.refresh");
    expect(cleDeLEspace("nimova.terrain.alcootest.abc")).toBe("nimova.terrain.demo.alcootest.abc");
  });
});
