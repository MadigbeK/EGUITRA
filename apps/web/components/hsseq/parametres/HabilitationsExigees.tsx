"use client";

/**
 * Paramètres HSSEQ, « Habilitations exigées » : pour chaque type d'habilitation tenu par RH, les profils
 * de véhicule dont les conducteurs doivent le détenir, citerne, benne ou les deux (GET et PATCH
 * /hsseq/qualifications/rules ; écriture : administration et Responsable HSSEQ). Sans règle d'HSSEQ,
 * « obligatoire pour les conducteurs » de RH vaut pour les deux profils ; « Rétablir » retire la règle
 * (reset). Une habilitation exigée échue, ou absente après la date des réglages, ouvre le motif V04 :
 * le verrou retient le profil de l'ensemble de la rotation, la matrice, le cockpit, les échéances et les
 * alertes celui de l'ensemble habituel du conducteur.
 */

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, RotateCcw } from "@/components/icons";
import { Button, Card, DataTable, Etat, Notice, Tag, demanderConfirmation } from "@/components/ui";
import { texteErreur } from "@/components/hsseq/commun";
import type { QualificationRule, QualificationRulesPatch } from "@/components/hsseq/habilitations/types";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { pluriel } from "@/lib/format";

type Profil = "tanker" | "tipper";

/** Profils de véhicule, dans l'ordre des colonnes, et le mot de chacun dans une phrase. */
const PROFILS: ReadonlyArray<{ cle: Profil; label: string; de: string }> = [
  { cle: "tanker", label: "Citernes", de: "citerne" },
  { cle: "tipper", label: "Bennes", de: "benne" },
];

/** Profils qui règlent les habilitations exigées (CONFIG du noyau). */
const PARAMETRAGE = ["admin", "hsseq"] as const;

type Coches = Record<Profil, boolean>;

/** Refus du noyau en clair : la phrase du noyau pour une règle refusée, sinon le message commun. */
function refus(e: unknown): string {
  if (e instanceof ApiError && e.body.error === "invalid_parameter") return e.body.message || "Une règle n'est pas acceptée par le serveur.";
  return texteErreur(e, { forbidden: "Les habilitations exigées se règlent par l'administration et le Responsable HSSEQ." }, "L'enregistrement n'a pas abouti.");
}

/** Profils exigés en une phrase : « les citernes et les bennes », « les citernes », « aucun profil ». */
function phraseProfils(c: Coches): string {
  if (c.tanker && c.tipper) return "les citernes et les bennes";
  if (c.tanker) return "les citernes";
  if (c.tipper) return "les bennes";
  return "aucun profil";
}

export function HabilitationsExigees() {
  const { data, error, mutate } = useApi<QualificationRule[]>("/hsseq/qualifications/rules");
  const ecriture = useAutorise(PARAMETRAGE);
  // Cases modifiées, par code d'habilitation : elles partent ensemble par « Enregistrer ».
  const [brouillon, setBrouillon] = useState<Record<string, Coches>>({});
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; texte: string } | null>(null);

  const coches = (r: QualificationRule): Coches => brouillon[r.code] ?? { tanker: r.tanker, tipper: r.tipper };
  const modifiees = (data ?? []).filter((r) => {
    const c = brouillon[r.code];
    return Boolean(c) && (c!.tanker !== r.tanker || c!.tipper !== r.tipper);
  });

  function cocher(r: QualificationRule, profil: Profil, coche: boolean) {
    setMessage(null);
    setBrouillon({ ...brouillon, [r.code]: { ...coches(r), [profil]: coche } });
  }

  /** Envoi au noyau ; la réponse est la liste à jour. `codes` : les saisies que la réponse remplace. */
  async function envoyer(corps: QualificationRulesPatch, codes: string[], texte: string, cle: string) {
    setEnvoi(cle);
    setMessage(null);
    try {
      const maj = await apiSend<QualificationRule[]>("PATCH", "/hsseq/qualifications/rules", corps);
      await mutate(maj, { revalidate: false });
      setBrouillon((b) => Object.fromEntries(Object.entries(b).filter(([code]) => !codes.includes(code))));
      setMessage({ tone: "ok", texte });
    } catch (e) {
      setMessage({ tone: "danger", texte: refus(e) });
    } finally {
      setEnvoi(null);
    }
  }

  function enregistrer() {
    const regles = modifiees.map((r) => ({ code: r.code, ...coches(r) }));
    const texte = regles.length === 1 ? `${modifiees[0]!.name} : exigée pour ${phraseProfils(regles[0]!)}.` : `${pluriel(regles.length, "règle enregistrée", "règles enregistrées")}.`;
    void envoyer({ rules: regles }, regles.map((r) => r.code), texte, "enregistrer");
  }

  async function retablir(r: QualificationRule) {
    const rh: Coches = { tanker: r.rh_mandatory, tipper: r.rh_mandatory };
    const ok = await demanderConfirmation(
      `La règle d'HSSEQ est retirée : ${r.rh_mandatory ? "obligatoire pour les conducteurs dans RH, elle sera exigée des citernes et des bennes" : "facultative dans RH, elle ne sera plus exigée d'aucun profil"}. Le motif V04 suit aussitôt.`,
      { titre: `Rétablir l'obligation de RH pour « ${r.name} » ?`, action: "Rétablir" },
    );
    if (!ok) return;
    void envoyer({ rules: [{ code: r.code, reset: true }] }, [r.code], `${r.name} : obligation de RH rétablie, exigée pour ${phraseProfils(rh)}.`, `retablir-${r.code}`);
  }

  return (
    <Card padded={false} title="Habilitations exigées par profil de véhicule">
      <div className="space-y-3 px-6 pb-4">
        <p className="max-w-[90ch] text-[13px] leading-relaxed text-muted">
          Les habilitations et leur échéance se saisissent dans NIMOVA · RH. Ici, chaque type d&apos;habilitation est exigé des conducteurs de citerne, de benne ou des deux, par exemple le transport de matières dangereuses pour les seules citernes, l&apos;accès au site minier pour les seules bennes. Sans règle, la case «&nbsp;obligatoire pour les conducteurs&nbsp;» de RH vaut pour les deux profils.
        </p>
        <p className="max-w-[90ch] text-[13px] leading-relaxed text-muted">
          Exigée et échue, ou absente après la date fixée dans les réglages, une habilitation refuse le départ (motif V04) des rotations de ce profil. La{" "}
          <Link href="/hsseq/habilitations" className="inline-flex items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline">
            matrice des compétences <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>{" "}
          suit le profil de l&apos;ensemble habituel de chaque conducteur.
        </p>
        {message && <Notice tone={message.tone}>{message.texte}</Notice>}
      </div>
      <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des habilitations exigées…" vide={{ title: "Aucun type d'habilitation.", hint: "Les types d'habilitation se créent dans NIMOVA · RH." }}>
        {(liste) => (
          <>
            <DataTable
              rows={liste}
              rowKey={(r) => r.code}
              columns={[
                {
                  key: "name",
                  label: "Habilitation",
                  render: (r) => (
                    <span className="block min-w-[14rem] max-w-[32rem]">
                      <span className="block font-medium text-ink">{r.name}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">
                        <span className="font-mono">{r.code}</span> · {r.rh_mandatory ? "obligatoire pour les conducteurs dans RH" : "facultative dans RH"}
                      </span>
                    </span>
                  ),
                },
                ...PROFILS.map((p) => ({
                  key: p.cle,
                  label: p.label,
                  render: (r: QualificationRule) => (
                    <label className={ecriture ? "inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-2" : "inline-flex items-center gap-2 text-[13px] text-ink-2"}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--accent)]"
                        checked={coches(r)[p.cle]}
                        disabled={!ecriture || envoi !== null}
                        onChange={(e) => cocher(r, p.cle, e.target.checked)}
                        aria-label={`${r.name} exigée des conducteurs de ${p.de}`}
                      />
                      <span aria-hidden>{coches(r)[p.cle] ? "Exigée" : "Non"}</span>
                    </label>
                  ),
                })),
                {
                  key: "rule",
                  label: "Règle",
                  render: (r) => (
                    <span className="flex flex-col items-start gap-1">
                      <Tag>{r.rule ? "Règle d'HSSEQ" : "Obligation de RH"}</Tag>
                      {ecriture && r.rule && (
                        <Button variant="ghost" size="sm" className="-ml-2.5" loading={envoi === `retablir-${r.code}`} disabled={envoi !== null} onClick={() => void retablir(r)} aria-label={`Rétablir l'obligation de RH pour ${r.name}`}>
                          <RotateCcw className="h-3.5 w-3.5" /> Rétablir RH
                        </Button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
            {ecriture && modifiees.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-3">
                <span className="mr-auto text-[12.5px] text-muted">{pluriel(modifiees.length, "habilitation modifiée", "habilitations modifiées")}, pas encore enregistrée{modifiees.length > 1 ? "s" : ""}.</span>
                <Button onClick={() => setBrouillon({})} disabled={envoi !== null}>
                  Annuler
                </Button>
                <Button variant="primary" loading={envoi === "enregistrer"} disabled={envoi !== null && envoi !== "enregistrer"} onClick={enregistrer}>
                  Enregistrer
                </Button>
              </div>
            )}
          </>
        )}
      </Etat>
    </Card>
  );
}
