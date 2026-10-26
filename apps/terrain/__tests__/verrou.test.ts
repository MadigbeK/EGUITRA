import type { LockReason, MyRotation } from "../src/hsseq/types";
import { derogeables, etatDepart, FRAICHEUR_VERROU, motifsOuverts, titreMotif } from "../src/hsseq/verrou";

const motif = (code: string, o: Partial<LockReason> = {}): LockReason => ({
  code, label: `Motif ${code}`, source: "HSSEQ", since: null, waivable: true, detail: null, resolution: null,
  severity: "block", pending: false, waiver_id: null, ...o,
});

const rotation = (reasons: LockReason[], o: Partial<MyRotation> = {}, lock: Partial<NonNullable<MyRotation["lock"]>> = {}): MyRotation => ({
  id: 1, name: null, date_loading: "2026-10-26", state: "draft", vehicle: { id: 2, name: "ER-02", vehicle_kind: "tanker" }, site: null,
  driver: null, route_name: null,
  lock: {
    allowed: !motifsOuverts(reasons).length, pending_checks_only: motifsOuverts(reasons).length > 0 && motifsOuverts(reasons).every((r) => r.pending),
    reasons, warnings: [], lock_active: true, ...lock,
  },
  ...o,
});

const MAINTENANT = 1_000_000_000;

describe("verrou de départ", () => {
  it("n'affiche jamais « Autorisé » hors réseau ni sur une réponse trop ancienne", () => {
    const r = rotation([]);
    expect(etatDepart(r, true, MAINTENANT, MAINTENANT)).toBe("autorise");
    expect(etatDepart(r, false, MAINTENANT, MAINTENANT)).toBe("non_verifie");
    expect(etatDepart(r, true, MAINTENANT - FRAICHEUR_VERROU - 1, MAINTENANT)).toBe("non_verifie");
    expect(etatDepart(r, true, null, MAINTENANT)).toBe("non_verifie");
  });

  it("dit « À contrôler » quand seules des saisies de terrain manquent, « Bloqué » sinon", () => {
    expect(etatDepart(rotation([motif("V01", { pending: true }), motif("V03", { pending: true })]), true, MAINTENANT, MAINTENANT)).toBe("a_controler");
    expect(etatDepart(rotation([motif("V01", { pending: true }), motif("V02")]), true, MAINTENANT, MAINTENANT)).toBe("bloque");
    // Hors réseau, un départ bloqué reste bloqué : la dernière réponse connue le dit.
    expect(etatDepart(rotation([motif("V02")]), false, MAINTENANT, MAINTENANT)).toBe("bloque");
  });

  it("ne compte ni les avertissements ni les motifs couverts par une dérogation", () => {
    const r = rotation([motif("V05", { waiver_id: 9 }), motif("X", { severity: "warn" })]);
    expect(motifsOuverts(r.lock!.reasons)).toEqual([]);
    expect(etatDepart(r, true, MAINTENANT, MAINTENANT)).toBe("autorise");
  });

  it("laisse partir quand le verrou n'est pas encore en service", () => {
    expect(etatDepart(rotation([motif("V02")], {}, { lock_active: false }), true, MAINTENANT, MAINTENANT)).toBe("autorise");
  });

  it("dit « En route » pour une rotation partie", () => {
    expect(etatDepart(rotation([], { state: "en_route", lock: null }), true, MAINTENANT, MAINTENANT)).toBe("en_route");
  });

  it("ne propose jamais de déroger à V01 ni à V03, ni à un motif déjà couvert", () => {
    const reasons = [motif("V01", { pending: true }), motif("V02"), motif("V03", { waivable: true }), motif("V05", { waiver_id: 3 }), motif("V04", { waivable: false })];
    expect(derogeables(reasons).map((r) => r.code)).toEqual(["V02"]);
  });

  it("donne au conducteur des titres en mots simples, sans dire si l'alcootest manque ou s'il est positif", () => {
    expect(titreMotif(motif("V03"))).toBe("Alcootest : voir le Responsable HSSEQ");
    expect(titreMotif(motif("T01"))).toBe("Motif T01");
  });
});
