// Tests de l'entrée native de la passerelle : `npm test` (node --test, Node 22.18 ou plus récent).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appNative, cheminNatif, dispositionPiece, jetonPorte, societeDeclaree, typePiece, venueDUnePage } from "./natif.ts";

describe("chemins ouverts à l'application native", () => {
  it("ouvre les routes de session avec leur seule méthode", () => {
    assert.equal(cheminNatif(["auth", "login"], "POST"), "/auth/login");
    assert.equal(cheminNatif(["auth", "mfa", "setup"], "POST"), "/auth/mfa/setup");
    assert.equal(cheminNatif(["auth", "refresh"], "POST"), "/auth/refresh");
    assert.equal(cheminNatif(["auth", "me"], "GET"), "/auth/me");
    assert.equal(cheminNatif(["auth", "login"], "GET"), null);
    assert.equal(cheminNatif(["auth", "me"], "POST"), null);
  });

  it("ouvre Rotations et HSSEQ, rien d'autre de l'API", () => {
    assert.equal(cheminNatif(["transport", "sync"], "POST"), "/transport/sync");
    assert.equal(cheminNatif(["hsseq", "checks", "90", "complement"], "POST"), "/hsseq/checks/90/complement");
    assert.equal(cheminNatif(["hsseq", "attachments", "901", "download"], "GET"), "/hsseq/attachments/901/download");
    for (const segments of [["admin", "users"], ["finance", "dashboard"], ["axispro", "dossiers"], ["auth", "sessions"], ["hsseq"], ["transport"], ["health"]]) {
      assert.equal(cheminNatif(segments, "GET"), null, segments.join("/"));
    }
  });

  it("refuse un chemin qui ne serait pas celui relayé", () => {
    assert.equal(cheminNatif([".", "auth", "login"], "POST"), null);
    assert.equal(cheminNatif(["hsseq", "..", "admin", "users"], "GET"), null);
    assert.equal(cheminNatif(["hsseq", "", "admin"], "GET"), null);
    assert.equal(cheminNatif(["hsseq", "checks%2F..%2Fadmin"], "GET"), null);
    assert.equal(cheminNatif(["hsseq", "checks?x=1"], "GET"), null);
  });
});

describe("en-têtes de l'application native", () => {
  it("n'accepte que les codes d'application natifs", () => {
    assert.equal(appNative("terrain"), "terrain");
    assert.equal(appNative("mobile"), "mobile");
    for (const code of ["finance", "axispro", "", null, "terrain "]) assert.equal(appNative(code), null, String(code));
  });

  it("lit le jeton porteur et rien d'autre", () => {
    const jeton = "Abc-123_xyz.456~789+0/=";
    assert.equal(jetonPorte(`Bearer ${jeton}`), jeton);
    for (const entete of [null, "", "Basic dXNlcjpwYXNz", `bearer ${jeton}`, "Bearer court", `Bearer ${jeton} x`, `Bearer ${jeton}\r\nX: y`]) {
      assert.equal(jetonPorte(entete), null, String(entete));
    }
  });

  it("ne relaie qu'une société en identifiant entier", () => {
    assert.equal(societeDeclaree("12"), "12");
    for (const v of [null, "", "1;2", "abc", "1234567890"]) assert.equal(societeDeclaree(v), null, String(v));
  });

  it("refuse les appels d'une page d'un autre site, pas ceux de l'application", () => {
    assert.equal(venueDUnePage("cross-site"), true);
    assert.equal(venueDUnePage("same-site"), true);
    assert.equal(venueDUnePage(null), false);
  });
});

describe("pièces relayées", () => {
  it("force le téléchargement en gardant le nom du fichier", () => {
    assert.equal(dispositionPiece('inline; filename="PRO-HSE-012 v3.pdf"'), "attachment; filename*=UTF-8''PRO-HSE-012%20v3.pdf");
    assert.equal(dispositionPiece("attachment; filename*=UTF-8''proc%C3%A9dure.pdf"), "attachment; filename*=UTF-8''proc%C3%A9dure.pdf");
    assert.equal(dispositionPiece(null), "attachment");
  });

  it("ne relaie jamais un document interprétable", () => {
    assert.equal(typePiece("application/pdf"), "application/pdf");
    for (const t of ["text/html", "image/svg+xml", "application/javascript", "text/xml"]) assert.equal(typePiece(t), "application/octet-stream", t);
  });
});
