"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, FileUp } from "@/components/icons";
import { Button, Card, Field, Input, Notice, Select, Textarea, classesBouton, cx } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { montant, useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { useApi } from "@/lib/api-client";
import { confierDossier, enregistrerFiche, lireBusinessPlan, supprimerProjet, useLectureDisponible, useReference } from "@/lib/axispro-api";
import { SECTEURS, gateDe, nomGate } from "@/lib/axispro-parcours";
import type { CleRecevabilite, Currency, DossierDetail, UserRef } from "@/lib/axispro-types";
import { CaseCochee, FORMATS_BP, ValeurLue, erreurMontant, montantEcrit, montantLu, refusFichierBp } from "./commun";
import { useDossier } from "./DossierParcours";

interface Saisie {
  name: string;
  promoteur: { id: number; name: string } | null;
  sector: string;
  location: string;
  investment: string;
  financing_need: string;
  consultant: string;
  description: string;
  currency_id: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  conditions: Partial<Record<CleRecevabilite, boolean>>;
  recevable: boolean;
}

function depuis(d: DossierDetail): Saisie {
  return {
    name: d.name ?? "",
    promoteur: d.promoter?.id ? { id: d.promoter.id, name: d.promoter.name } : null,
    sector: d.sector ?? "",
    location: d.location ?? "",
    investment: montantEcrit(d.investment),
    financing_need: montantEcrit(d.financing_need),
    consultant: d.consultant_id ? String(d.consultant_id) : "",
    description: d.description ?? "",
    currency_id: d.currency?.id ? String(d.currency.id) : "",
    contact_name: d.contact?.name ?? "",
    contact_email: d.contact?.email ?? "",
    contact_phone: d.contact?.phone ?? "",
    conditions: Object.fromEntries((d.admissibility?.conditions ?? []).map((c) => [c.key, c.checked])),
    recevable: d.admissibility?.admissible ?? false,
  };
}

/**
 * Étape 1, fiche projet (EC-05). Modification : profil cabinet, tant que la décision n'est pas scellée et
 * que le projet n'est pas clos ; les autres comptes lisent la fiche en texte. Déclarer le projet recevable
 * au Gate 0 le fait passer au Gate 1 (RG-05-03). Suppression : associé du cabinet, projet clos compris.
 */
export function EtapeFiche() {
  const { d, peutEcrire } = useDossier();
  return peutEcrire ? <FicheModifiable key={d.id} d={d} /> : <FicheLue d={d} />;
}

function FicheLue({ d }: { d: DossierDetail }) {
  const g = gateDe(d);
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <Card title="Identité du projet">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ValeurLue label="Intitulé du projet" valeur={d.name} />
          <ValeurLue label="Promoteur" valeur={d.promoter?.name} />
          <ValeurLue label="Secteur" valeur={d.sector} />
          <ValeurLue label="Localisation" valeur={d.location} />
          <ValeurLue label="CAPEX estimatif" valeur={d.investment ? montant(d, d.investment) : null} />
          <ValeurLue label="Financement recherché" valeur={d.financing_need ? montant(d, d.financing_need) : null} />
          <ValeurLue label="Consultant responsable" valeur={d.consultant} />
          <ValeurLue label="N° MBAP" valeur={d.reference} />
          <ValeurLue label="Description synthétique" valeur={d.description} className="sm:col-span-2" />
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Contact du promoteur">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ValeurLue label="Nom du contact" valeur={d.contact?.name} />
            <ValeurLue label="Courriel" valeur={d.contact?.email} />
            <ValeurLue label="Téléphone" valeur={d.contact?.phone} />
          </div>
        </Card>
        {d.admissibility && (
          <Card title="Recevabilité · Gate 0">
            <ul className="space-y-1.5 text-[14px] text-ink-2">
              {d.admissibility.conditions.map((c) => (
                <li key={c.key} className="flex items-center gap-2">
                  <Check aria-hidden className={cx("h-4 w-4 flex-none", c.checked ? "text-ok" : "text-line-strong")} />
                  <span>{c.label}{c.checked ? "" : " (non cochée)"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] font-semibold text-ink">{d.admissibility.admissible ? "Projet recevable" : "Recevabilité à statuer"}</p>
            <p className="mt-2 text-[13px] text-muted">Gate courant : {g} · {nomGate(g, d.gates)}. Il évolue ensuite par décision du comité (étape 6).</p>
          </Card>
        )}
        <CarteSuppression d={d} />
      </div>
    </div>
  );
}

/** Suppression définitive : associé du cabinet (route d'administration), confirmée par un second clic. */
function CarteSuppression({ d }: { d: DossierDetail }) {
  const router = useRouter();
  const { signalerModifie } = useDossier();
  const { moi } = useCabinet();
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const [confirmer, setConfirmer] = useState(false);
  if (!moi?.associe) return null;
  async function supprimer() {
    if (!confirmer) {
      setConfirmer(true);
      return;
    }
    const r = await envoyer(() => supprimerProjet(d), undefined, "supprimer");
    if (r) {
      signalerModifie(false);
      router.push("/axispro/portefeuille");
    }
  }
  return (
    <Card title="Supprimer le projet">
      <p className="text-[13.5px] text-muted">Supprime la fiche, le scoring, l&apos;historique et les pièces déposées. Action définitive.</p>
      <Button className="mt-3" variant="danger" loading={enCours === "supprimer"} disabled={occupe} onClick={() => void supprimer()}>{confirmer ? `Confirmer la suppression de ${d.reference}` : "Supprimer ce projet"}</Button>
      {confirmer && <div className="mt-3"><Notice tone="warn">Second clic : le projet sera supprimé définitivement.</Notice></div>}
      {bandeau && <div className="mt-3">{bandeau}</div>}
    </Card>
  );
}

function FicheModifiable({ d }: { d: DossierDetail }) {
  const router = useRouter();
  const { relire, signalerModifie } = useDossier();
  const { moi } = useCabinet();
  const origine = useMemo(() => depuis(d), [d]);
  const empreinte = JSON.stringify(origine);
  const [f, setF] = useState<Saisie>(origine);
  const [base, setBase] = useState(empreinte);
  const { data: consultants } = useApi<UserRef[]>("/axispro/consultants");
  const { data: currencies } = useApi<Currency[]>("/axispro/currencies");
  const { data: dispo } = useLectureDisponible(true);
  const { data: reference } = useReference();
  const { envoyer, enCours, occupe, bandeau, setRetour } = useRetour();
  // Promoteur lu dans un business plan, absent des tiers : le noyau le retrouve par son nom, ou le crée.
  const [promoteurLu, setPromoteurLu] = useState<string | null>(null);
  const modifie = JSON.stringify(f) !== base;

  // Fiche relue (enregistrement, autre onglet) : la saisie suit tant qu'elle n'a pas été retouchée.
  useEffect(() => {
    if (empreinte === base) return;
    if (!modifie) setF(origine);
    setBase(empreinte);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinte]);

  useEffect(() => {
    signalerModifie(modifie);
    if (!modifie) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [modifie, signalerModifie]);
  useEffect(() => () => signalerModifie(false), [signalerModifie]);

  const champ = (k: "name" | "sector" | "location" | "investment" | "financing_need" | "description" | "currency_id" | "contact_name" | "contact_email" | "contact_phone") => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const erreurs = { investment: erreurMontant(f.investment), financing_need: erreurMontant(f.financing_need) };
  const g = gateDe(d);
  const listeSecteurs = reference?.sectors ?? SECTEURS;
  const secteurs = [...listeSecteurs, ...(f.sector && !listeSecteurs.includes(f.sector) ? [f.sector] : [])].map((s) => ({ value: s, label: s }));
  const devise = currencies?.find((c) => String(c.id) === f.currency_id)?.name ?? d.currency?.name ?? null;
  const suffixe = devise ? ` (${devise})` : "";

  async function enregistrer() {
    if (!f.name.trim() || (!f.promoteur && !promoteurLu)) {
      setRetour({ tone: "danger", text: "Renseignez au moins l'intitulé et le promoteur." });
      return;
    }
    if (d.admissibility && f.recevable && d.admissibility.conditions.some((c) => !f.conditions[c.key])) {
      setRetour({ tone: "danger", text: "Cochez les 4 conditions de recevabilité avant de déclarer le projet recevable." });
      return;
    }
    const capex = montantLu(f.investment);
    const besoin = montantLu(f.financing_need);
    if (capex === null || besoin === null || capex < 0 || besoin < 0) return;
    const promoteur = f.promoteur ? { promoter_id: f.promoteur.id } : { promoter_name: promoteurLu ?? "" };
    let confie = false;
    const ok = await envoyer(async () => {
      await enregistrerFiche(d.id, {
        name: f.name.trim(),
        ...promoteur,
        sector: f.sector,
        location: f.location,
        investment: capex,
        financing_need: besoin,
        description: f.description,
        currency_id: f.currency_id || undefined,
        contact_name: f.contact_name,
        contact_email: f.contact_email,
        contact_phone: f.contact_phone,
        ...(d.admissibility ? { ...f.conditions, admissible: f.recevable } : {}),
      });
      if (f.consultant && Number(f.consultant) !== d.consultant_id) confie = Boolean((await confierDossier(d.id, Number(f.consultant))).handed_over);
      return true;
    }, "Fiche enregistrée", "enregistrer");
    // Un évaluateur qui confie son dossier ne le voit plus : retour au portefeuille.
    if (ok && confie) {
      router.push("/axispro/portefeuille");
      return;
    }
    if (ok) {
      setBase(JSON.stringify(f));
      setPromoteurLu(null);
      relire();
    }
  }

  /** « Compléter depuis un business plan » : la lecture ne remplit que les champs vides. */
  async function completer(fichier: File) {
    const refus = refusFichierBp(fichier);
    if (refus) {
      setRetour({ tone: "danger", text: refus });
      return;
    }
    const r = await envoyer(() => lireBusinessPlan(fichier), undefined, "lecture");
    if (!r) return;
    const x = r.fields;
    const secteur = listeSecteurs.find((s) => s.toLowerCase() === x.sector.trim().toLowerCase()) ?? "";
    if (!f.promoteur && !r.promoter && x.promoter) setPromoteurLu(x.promoter);
    setF((a) => ({
      ...a,
      name: a.name || x.name,
      promoteur: a.promoteur ?? r.promoter,
      sector: a.sector || secteur,
      location: a.location || x.location,
      investment: a.investment || montantEcrit(x.investment),
      financing_need: a.financing_need || montantEcrit(x.financing_need),
      description: a.description || x.description,
      contact_name: a.contact_name || x.contact_name,
      contact_email: a.contact_email || x.contact_email,
      contact_phone: a.contact_phone || x.contact_phone,
    }));
    setRetour({ tone: "ok", text: `Lecture de ${fichier.name} terminée : champs vides complétés. Vérifiez-les, puis enregistrez la fiche.` });
  }

  return (
    <div className="space-y-4">
      {bandeau}
      <fieldset disabled={occupe} className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card
          title="Identité du projet"
          actions={
            dispo?.available ? (
              <label className={cx(classesBouton(), occupe ? "pointer-events-none opacity-60" : "cursor-pointer")}>
                <FileUp aria-hidden className="h-4 w-4" /> {enCours === "lecture" ? "Lecture du business plan… 15 à 60 secondes." : "Compléter depuis un business plan"}
                <input
                  type="file"
                  accept={FORMATS_BP}
                  className="sr-only"
                  onChange={(e) => {
                    const fichier = e.target.files?.[0];
                    e.target.value = "";
                    if (fichier) void completer(fichier);
                  }}
                />
              </label>
            ) : undefined
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Intitulé du projet *"><Input {...champ("name")} /></Field>
            <Field label="Promoteur *" hint={promoteurLu && !f.promoteur ? `Lu : « ${promoteurLu} » : ce tiers sera repris ou créé à l'enregistrement, sauf si vous en choisissez un.` : undefined}><PartnerPicker value={f.promoteur} onChange={(p) => setF({ ...f, promoteur: p })} kind="customer" /></Field>
            <Field label="Secteur"><Select {...champ("sector")} placeholder="Choisir" options={secteurs} /></Field>
            <Field label="Localisation"><Input {...champ("location")} /></Field>
            <Field label={`CAPEX estimatif${suffixe}`} error={erreurs.investment}><Input inputMode="decimal" className="font-mono" {...champ("investment")} /></Field>
            <Field label={`Financement recherché${suffixe}`} error={erreurs.financing_need}><Input inputMode="decimal" className="font-mono" {...champ("financing_need")} /></Field>
            <Field label="Consultant responsable">
              {consultants?.length && (d.can_assign || !d.consultant_id) ? (
                <Select value={f.consultant} onChange={(e) => setF({ ...f, consultant: e.target.value })} placeholder={d.consultant_id ? undefined : "Choisir"} options={consultants.map((c) => ({ value: c.id, label: c.name }))} />
              ) : (
                <Input value={d.consultant ?? moi?.name ?? ""} readOnly />
              )}
            </Field>
            <Field label="N° MBAP"><Input value={d.reference} readOnly /></Field>
            {(currencies?.length ?? 0) > 1 && (
              <Field label="Devise des montants"><Select {...champ("currency_id")} options={(currencies ?? []).map((c) => ({ value: String(c.id), label: c.name }))} /></Field>
            )}
            <Field label="Description synthétique" className="sm:col-span-2"><Textarea rows={4} {...champ("description")} /></Field>
          </div>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card title="Contact du promoteur">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nom du contact"><Input {...champ("contact_name")} /></Field>
              <Field label="Courriel"><Input type="email" {...champ("contact_email")} /></Field>
              <Field label="Téléphone"><Input type="tel" {...champ("contact_phone")} /></Field>
            </div>
            <p className="mt-3 text-[12.5px] text-muted">Ces coordonnées alimentent les messages de relance (étape 5).</p>
          </Card>
          {d.admissibility && (
            <Card title="Recevabilité · Gate 0">
              <div>
                {d.admissibility.conditions.map((c) => (
                  <CaseCochee key={c.key} checked={f.conditions[c.key] ?? false} onChange={(v) => setF({ ...f, conditions: { ...f.conditions, [c.key]: v } })}>{c.label}</CaseCochee>
                ))}
                <CaseCochee gras checked={f.recevable} onChange={(v) => setF({ ...f, recevable: v })}>Projet recevable : passer en préqualification (Gate 1)</CaseCochee>
              </div>
              <p className="mt-2 text-[12.5px] text-muted">Gate courant : {g} · {nomGate(g, d.gates)}. Il évolue ensuite par décision du comité (étape 6).</p>
            </Card>
          )}
          <Button variant="primary" loading={enCours === "enregistrer"} disabled={!!erreurs.investment || !!erreurs.financing_need} onClick={() => void enregistrer()}>Enregistrer la fiche</Button>
        </div>
      </fieldset>
      <CarteSuppression d={d} />
    </div>
  );
}
