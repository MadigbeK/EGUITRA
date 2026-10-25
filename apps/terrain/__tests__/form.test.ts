import type { Referentials } from "../src/api/types";
import { fmtDate, fmtInt, fmtM3, quand } from "../src/format";
import { blank, controler, depasseCapacite, fromPayload, grouper, keepReferentials, num, toPayload } from "../src/rotations/form";
import { claimCache, forgetDevice } from "../src/store/device";
import { memoryStore } from "../src/store/memory";

const REFS: Referentials = {
  vehicles: [{ id: 4, name: "ER-09", tractor_plate: "RC 1234 A", capacity_liters: 36_000, driver_id: 8 }],
  drivers: [{ id: 8, name: "Alpha Diallo" }],
  routes: [{ id: 5, name: "Conakry - Kindia", distance_km: 135 }],
  clients: [{ id: 6, name: "Station Kaloum" }],
  products: [{ code: "gasoil", label: "Gasoil" }],
  costs: [{ code: "fuel_cost", label: "Carburant" }, { code: "tolls", label: "Péages" }],
  measures: [{ code: "temperature", label: "Température" }],
};

describe("saisie d'une rotation", () => {
  it("signale chaque champ obligatoire manquant", () => {
    expect(controler(blank())).toEqual({
      vehicle_id: "Choisissez le camion",
      partner_id: "Choisissez le client",
      route_id: "Choisissez la route",
      volume_loaded: "Indiquez le volume chargé",
    });
    expect(controler({ ...blank(), vehicle_id: "4", partner_id: "6", route_id: "5", volume_delivered: "36" })).toEqual({});
  });

  it("lit les nombres tapés au téléphone", () => {
    expect(num("36,5")).toBe(36.5);
    expect(num("1 500 000")).toBe(1_500_000);
    expect(num("")).toBe(0);
    expect(num("abc")).toBe(0);
  });

  it("groupe les frais par milliers pendant la frappe", () => {
    expect(grouper("1500000")).toBe("1 500 000");
    expect(grouper("12,5")).toBe("12,5");
  });

  it("prévient d'un chargement au-delà de la capacité du camion", () => {
    const f = { ...blank(), vehicle_id: "4", volume_loaded: "36,5" };
    expect(depasseCapacite(f, REFS)?.name).toBe("ER-09");
    expect(depasseCapacite({ ...f, volume_loaded: "36" }, REFS)).toBeNull();
  });

  it("envoie au bureau ce que Rotations web envoie, et le relit à l'identique", () => {
    const f = {
      ...blank("2026-10-25"), vehicle_id: "4", driver_id: "8", partner_id: "6", route_id: "5", delivery_note: " BL-77 ",
      volume_loaded: "36,5", note: "", costs: { fuel_cost: "1 500 000", tolls: "" }, measures: { temperature: "28" },
    };
    const payload = toPayload(f);
    expect(payload).toEqual({
      date_loading: "2026-10-25", vehicle_id: 4, partner_id: 6, route_id: 5, product: "gasoil", driver_id: 8,
      delivery_note: "BL-77", volume_loaded: 36.5, fuel_cost: 1_500_000, temperature: 28,
    });
    const relu = fromPayload({ client_uuid: "u1", kind: "rotation", user_id: 7, created_at: "", status: "pending", payload }, REFS);
    expect(relu).toMatchObject({ uuid: "u1", vehicle_id: "4", volume_loaded: "36.5", delivery_note: "BL-77", costs: { fuel_cost: "1500000" }, measures: { temperature: "28" } });
  });

  it("ne garde sur l'appareil que de quoi saisir", () => {
    const avecTarifs = { ...REFS, routes: [{ id: 5, name: "Conakry - Kindia", distance_km: 135, tariff: 250 }] } as unknown as Referentials;
    expect(keepReferentials(avecTarifs).routes).toEqual([{ id: 5, name: "Conakry - Kindia", distance_km: 135 }]);
  });
});

describe("appareil partagé", () => {
  it("efface les listes d'un autre compte, garde les saisies en attente de chacun", async () => {
    const store = memoryStore();
    await claimCache(store, 7);
    await store.cache.set("referentials", REFS);
    await store.queue.put({ client_uuid: "u1", kind: "rotation", user_id: 7, created_at: "", status: "pending", payload: {} });
    await claimCache(store, 7);
    expect(await store.cache.get("referentials")).toEqual(REFS);
    await claimCache(store, 9);
    expect(await store.cache.get("referentials")).toBeUndefined();
    expect(await store.cache.get("owner")).toBe(9);
    expect(await store.queue.all()).toHaveLength(1);
    await forgetDevice(store);
    expect(await store.cache.get("owner")).toBeUndefined();
    expect(await store.queue.all()).toHaveLength(1);
  });
});

describe("écriture française", () => {
  it("écrit les nombres, les volumes et les dates", () => {
    expect(fmtInt(1_500_000)).toBe("1 500 000");
    expect(fmtInt(-0.2)).toBe("0");
    expect(fmtInt(null)).toBe("–");
    expect(fmtM3(36.5)).toBe("36,50 m³");
    expect(fmtDate("2026-10-25")).toBe("25/10/2026");
  });

  it("dit quand a eu lieu le dernier envoi", () => {
    const maintenant = new Date(2026, 9, 25, 15, 0);
    expect(quand(new Date(2026, 9, 25, 14, 32), maintenant)).toBe("aujourd'hui 14:32");
    expect(quand(new Date(2026, 9, 24, 18, 5), maintenant)).toBe("hier 18:05");
    expect(quand(new Date(2026, 9, 20, 9, 15), maintenant)).toBe("le 20/10 à 09:15");
  });
});
