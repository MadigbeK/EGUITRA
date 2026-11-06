"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, FileUp, Sparkles } from "@/components/icons";
import { Badge, Button, Card, FEUILLE, Input, Notice, Select, Textarea, classesBouton, cx } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { messageErreur, useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { useApi } from "@/lib/api-client";
import { confierDossier, creerProjet, deposerPieces, lireBusinessPlan, useLectureDisponible, useReference } from "@/lib/axispro-api";
import { SECTEURS } from "@/lib/axispro-parcours";
import type { Currency, FicheBusinessPlan, UserRef } from "@/lib/axispro-types";
import { CaseCochee, FORMATS_BP, Surtitre, TITRE_ECRAN, erreurMontant, montantEcrit, montantLu, refusFichierBp } from "./commun";

/** Saisie de la fiche ; rien n'est enregistré avant « Créer le projet » (RG-04-01). */
interface Saisie {
  name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  location: string;
  investment: string;
  financing_need: string;
  sector: string;
  description: string;
  currency_id: string;
  consultant_id: string;
}

const VIDE: Saisie = { name: "", contact_name: "", contact_email: "", contact_phone: "", location: "", investment: "", financing_need: "", sector: "", description: "", currency_id: "", consultant_id: "" };

/** Lecture terminée : le fichier, ce qui a été trouvé, les points clés relevés. */
interface Lecture {
  fichier: File;
  trouves: Set<string>;
  points: string[];
  promoteurLu: string | null;
}

/** Secteur proposé par la lecture : il n'est retenu que s'il figure dans la liste de référence (RG-04-03). */
function secteurRetenu(lu: string, secteurs: string[]): string {
  const cherche = lu.trim().toLowerCase();
  return secteurs.find((s) => s.toLowerCase() === cherche) ?? "";
}

/**
 * Nouveau projet (EC-03 puis EC-04, deux états du même écran). La lecture du business plan propose une
 * fiche que l'évaluateur vérifie ; le projet n'existe qu'au clic sur « Créer le projet ». « Arrêter » rend
 * la main aussitôt : le résultat de la lecture en cours est alors ignoré. Réservé au profil cabinet
 * (POST /axispro/dossiers, POST /axispro/business-plan).
 */
export function NouveauProjet() {
  const { cabinet } = useCabinet();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [saisie, setSaisie] = useState<{ f: Saisie; promoteur: { id: number; name: string } | null } | null>(null);
  if (!cabinet) {
    return (
      <div>
        <RetourAccueil />
        <Notice tone="neutral">La création d&apos;un projet est réservée à l&apos;évaluateur et à l&apos;administrateur.</Notice>
      </div>
    );
  }
  return (
    <div>
      <RetourAccueil />
      <Surtitre>Nouveau projet · Gate 0 · Project Intake</Surtitre>
      <h1 className={cx(TITRE_ECRAN, "mb-5 mt-1.5")}>Enregistrer un nouveau projet</h1>
      {saisie ? (
        <Fiche
          initiale={saisie}
          lecture={lecture}
          retour={() => {
            setSaisie(null);
            setLecture(null);
          }}
        />
      ) : (
        <Choix
          onLu={(l, s) => {
            setLecture(l);
            setSaisie(s);
          }}
          onManuel={() => {
            setLecture(null);
            setSaisie({ f: VIDE, promoteur: null });
          }}
        />
      )}
    </div>
  );
}

function RetourAccueil() {
  return (
    <Link href="/axispro" className="mb-1 inline-flex min-h-[42px] items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
      <ChevronLeft aria-hidden className="h-4 w-4" /> Accueil
    </Link>
  );
}

/* ─── EC-03 : choix du mode ─────────────────────────────────────────────── */

function Choix({ onLu, onManuel }: { onLu: (l: Lecture, s: { f: Saisie; promoteur: { id: number; name: string } | null }) => void; onManuel: () => void }) {
  const { data: dispo } = useLectureDisponible(true);
  const { data: currencies } = useApi<Currency[]>("/axispro/currencies");
  const { data: reference } = useReference();
  const [etat, setEtat] = useState<{ texte: string; ton: "accent" | "danger" | "neutral"; enCours: boolean } | null>(null);
  // Numéro de la lecture en cours : « Arrêter » l'invalide, son résultat tardif est ignoré.
  const ticket = useRef(0);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      ticket.current += 1;
      if (minuterie.current) clearTimeout(minuterie.current);
    },
    [],
  );

  function arreter() {
    ticket.current += 1;
    if (minuterie.current) clearTimeout(minuterie.current);
    setEtat({ texte: "Lecture arrêtée.", ton: "neutral", enCours: false });
  }

  async function lire(fichier: File) {
    const refus = refusFichierBp(fichier);
    if (refus) {
      setEtat({ texte: refus, ton: "danger", enCours: false });
      return;
    }
    const n = ++ticket.current;
    setEtat({ texte: `Extraction du texte de ${fichier.name}…`, ton: "accent", enCours: true });
    minuterie.current = setTimeout(() => {
      if (ticket.current === n) setEtat({ texte: "Lecture du business plan… 15 à 60 secondes.", ton: "accent", enCours: true });
    }, 1500);
    try {
      const r: FicheBusinessPlan = await lireBusinessPlan(fichier);
      if (ticket.current !== n) return;
      if (minuterie.current) clearTimeout(minuterie.current);
      const x = r.fields;
      const secteur = secteurRetenu(x.sector, reference?.sectors ?? SECTEURS);
      const f: Saisie = {
        ...VIDE,
        name: x.name,
        contact_name: x.contact_name,
        contact_email: x.contact_email,
        contact_phone: x.contact_phone,
        location: x.location,
        investment: montantEcrit(x.investment),
        financing_need: montantEcrit(x.financing_need),
        sector: secteur,
        description: x.description,
        // Devise de la société : option vide du choix ; autre devise proposée : son identifiant.
        currency_id: r.currency && currencies && currencies[0]?.id !== r.currency.id ? String(r.currency.id) : "",
      };
      const trouves = new Set<string>((Object.keys(f) as Array<keyof Saisie>).filter((k) => f[k]));
      if (x.promoter) trouves.add("promoter");
      onLu({ fichier, trouves, points: x.key_points.slice(0, 6), promoteurLu: r.promoter ? null : x.promoter || null }, { f, promoteur: r.promoter });
    } catch (e) {
      if (ticket.current !== n) return;
      if (minuterie.current) clearTimeout(minuterie.current);
      setEtat({ texte: messageErreur(e, "Lecture impossible : saisissez la fiche manuellement."), ton: "danger", enCours: false });
    }
  }

  const indisponible = dispo?.available === false;
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <section className={cx(FEUILLE, "min-w-0 p-6")}>
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles aria-hidden className="h-5 w-5 text-accent" />
          <h2 className="font-display text-[17px] font-[620] text-ink">À partir du business plan</h2>
          <Badge tone="ok">Recommandé</Badge>
        </div>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Téléversez le business plan du promoteur. L&apos;outil en extrait l&apos;intitulé, le promoteur, les coordonnées, la localisation, le CAPEX, le financement recherché et une description, que vous vérifiez avant de créer le projet.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className={cx(classesBouton("primary"), etat?.enCours || indisponible ? "pointer-events-none opacity-60" : "cursor-pointer")}>
            <FileUp aria-hidden className="h-4 w-4" /> Téléverser le business plan
            <input
              type="file"
              accept={FORMATS_BP}
              className="sr-only"
              disabled={etat?.enCours || indisponible}
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                e.target.value = "";
                if (fichier) void lire(fichier);
              }}
            />
          </label>
          {etat?.enCours && <Button onClick={arreter}>Arrêter</Button>}
        </div>
        <p className="mt-2 text-[12.5px] text-muted">PDF, Word (.docx) ou texte. La lecture prend en général 15 à 60 secondes.</p>
        {indisponible && <div className="mt-3"><Notice tone="neutral">La lecture des business plans n&apos;est pas ouverte sur ce serveur : saisissez la fiche manuellement.</Notice></div>}
        {etat && <div className="mt-3" aria-live="polite"><Notice tone={etat.ton}>{etat.texte}</Notice></div>}
      </section>
      <section className={cx(FEUILLE, "min-w-0 p-6")}>
        <h2 className="font-display text-[17px] font-[620] text-ink">Saisie manuelle</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">Remplissez vous-même la fiche, puis créez le projet.</p>
        <Button className="mt-4" disabled={etat?.enCours} onClick={onManuel}>Saisir la fiche manuellement</Button>
      </section>
    </div>
  );
}

/* ─── EC-04 : fiche proposée ────────────────────────────────────────────── */

/** Champ de la fiche, avec « trouvé » ou « non trouvé » à côté du libellé après une lecture. */
function Champ({ label, cle, lecture, erreur, aide, className, children }: { label: string; cle?: string; lecture: Lecture | null; erreur?: string; aide?: string; className?: string; children: React.ReactNode }) {
  const trouve = cle ? lecture?.trouves.has(cle) : undefined;
  return (
    <label className={cx("block min-w-0", className)}>
      <span className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink-2">
        {label}
        {lecture && cle && <span className={cx("rounded-full px-2 py-px text-[11.5px] font-semibold", trouve ? "bg-ok-doux text-ok-texte" : "bg-panel-3 text-muted")}>{trouve ? "trouvé" : "non trouvé"}</span>}
      </span>
      {children}
      {aide && !erreur && <span className="mt-1.5 block text-[12px] leading-snug text-muted">{aide}</span>}
      {erreur && <span className="mt-1.5 block text-[12px] font-medium leading-snug text-danger">{erreur}</span>}
    </label>
  );
}

function Fiche({ initiale, lecture, retour }: { initiale: { f: Saisie; promoteur: { id: number; name: string } | null }; lecture: Lecture | null; retour: () => void }) {
  const router = useRouter();
  const { moi } = useCabinet();
  const [f, setF] = useState<Saisie>(initiale.f);
  const [promoteur, setPromoteur] = useState(initiale.promoteur);
  const [joindre, setJoindre] = useState(true);
  const { data: currencies } = useApi<Currency[]>("/axispro/currencies");
  const { data: consultants } = useApi<UserRef[]>("/axispro/consultants");
  const { data: reference } = useReference();
  const { envoyer, enCours, bandeau, setRetour } = useRetour();
  const champ = (k: keyof Saisie) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const devise = currencies?.find((c) => String(c.id) === f.currency_id)?.name ?? currencies?.[0]?.name ?? null;
  const suffixe = devise ? ` (${devise})` : "";
  const responsable = f.consultant_id || String(moi?.id ?? "");
  const erreurs = { investment: erreurMontant(f.investment), financing_need: erreurMontant(f.financing_need) };
  // Lu dans le business plan, absent des tiers : le noyau retrouve le promoteur par son nom, ou le crée.
  const promoteurLu = lecture?.promoteurLu ?? null;

  /** Business plan en catégorie B, rattaché au premier critère avec son observation (RG-04-02). */
  async function deposerBusinessPlan(id: number, fichier: File) {
    const r = await deposerPieces(id, [fichier], { lettre: "B", businessPlan: true });
    if (r.pieces.length === 0) throw new Error(r.errors[0]?.message ?? "Dépôt refusé");
  }

  async function creer() {
    if (!f.name.trim() || (!promoteur && !promoteurLu)) {
      setRetour({ tone: "danger", text: "Renseignez au moins l'intitulé et le promoteur." });
      return;
    }
    const capex = montantLu(f.investment);
    const besoin = montantLu(f.financing_need);
    if (capex === null || besoin === null || capex < 0 || besoin < 0) return;
    const description = [f.description.trim(), lecture?.points.length ? `Points clés relevés dans le business plan :\n${lecture.points.map((p) => `- ${p}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
    const d = await envoyer(
      () =>
        creerProjet({
          name: f.name.trim(),
          ...(promoteur ? { promoter_id: promoteur.id } : { promoter_name: promoteurLu ?? "" }),
          sector: f.sector,
          location: f.location,
          investment: capex,
          financing_need: besoin,
          description,
          contact_name: f.contact_name,
          contact_email: f.contact_email,
          contact_phone: f.contact_phone,
          currency_id: f.currency_id || undefined,
        }),
      undefined,
      "creer",
    );
    if (!d) return;
    // Le projet est créé : un échec de ce qui suit ne l'empêche pas, il se rattrape à la fiche ou aux pièces.
    const echecs: string[] = [];
    if (lecture && joindre) {
      await deposerBusinessPlan(d.id, lecture.fichier).catch(() => echecs.push("le business plan n'a pas pu être déposé : déposez-le à l'étape 2"));
    }
    // En dernier : un évaluateur qui confie le projet à un collègue ne le voit plus ensuite.
    let confie = false;
    if (responsable && Number(responsable) !== d.consultant_id) {
      const r = await confierDossier(d.id, Number(responsable)).catch(() => {
        echecs.push("le consultant responsable n'a pas pu être enregistré : choisissez-le à l'étape 1");
        return null;
      });
      confie = Boolean(r?.handed_over);
    }
    if (echecs.length) window.alert(`Le projet est créé, mais ${echecs.join(" ; ")}.`);
    router.push(confie ? "/axispro/portefeuille" : `/axispro/dossiers/${d.id}/fiche`);
  }

  const secteurs = (reference?.sectors ?? SECTEURS).map((s) => ({ value: s, label: s }));
  return (
    <div className="space-y-4">
      {lecture && (
        <Notice tone="accent">
          Lecture de <b>{lecture.fichier.name}</b> terminée. Vérifiez et corrigez les champs, puis créez le projet.
        </Notice>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card title="Fiche proposée">
          <fieldset disabled={!!enCours} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <Champ label="Intitulé du projet" cle="name" lecture={lecture}><Input {...champ("name")} /></Champ>
            <Champ label="Promoteur" cle="promoter" lecture={lecture} aide={promoteurLu && !promoteur ? `Lu : « ${promoteurLu} » : ce tiers sera repris ou créé avec le projet, sauf si vous en choisissez un.` : undefined}>
              <PartnerPicker value={promoteur} onChange={setPromoteur} kind="customer" />
            </Champ>
            <Champ label="Nom du contact" cle="contact_name" lecture={lecture}><Input {...champ("contact_name")} /></Champ>
            <Champ label="Courriel" cle="contact_email" lecture={lecture}><Input type="email" {...champ("contact_email")} /></Champ>
            <Champ label="Téléphone" cle="contact_phone" lecture={lecture}><Input type="tel" {...champ("contact_phone")} /></Champ>
            <Champ label="Localisation" cle="location" lecture={lecture}><Input {...champ("location")} /></Champ>
            <Champ label={`CAPEX estimatif${suffixe}`} cle="investment" lecture={lecture} erreur={erreurs.investment}><Input inputMode="decimal" className="font-mono" {...champ("investment")} /></Champ>
            <Champ label={`Financement recherché${suffixe}`} cle="financing_need" lecture={lecture} erreur={erreurs.financing_need}><Input inputMode="decimal" className="font-mono" {...champ("financing_need")} /></Champ>
            <Champ label="Secteur" cle="sector" lecture={lecture}><Select {...champ("sector")} placeholder="Choisir" options={secteurs} /></Champ>
            <Champ label="Consultant responsable" lecture={lecture}>
              {consultants?.length ? (
                <Select value={responsable} onChange={(e) => setF({ ...f, consultant_id: e.target.value })} options={consultants.map((c) => ({ value: c.id, label: c.name }))} />
              ) : (
                <Input value={moi?.name ?? ""} readOnly />
              )}
            </Champ>
            {(currencies?.length ?? 0) > 1 && (
              <Champ label="Devise des montants" lecture={lecture}>
                <Select {...champ("currency_id")} options={(currencies ?? []).map((c, i) => ({ value: i === 0 ? "" : String(c.id), label: c.name }))} />
              </Champ>
            )}
            <Champ label="Description synthétique" lecture={lecture} className="sm:col-span-2"><Textarea rows={4} {...champ("description")} /></Champ>
          </fieldset>
        </Card>
        <div className="space-y-4">
          {lecture && lecture.points.length > 0 && (
            <Card title="Points clés relevés">
              <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2">
                {lecture.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <p className="mt-3 text-[12.5px] leading-snug text-muted">Ces éléments sont ajoutés à la description du projet. Ils aident au scoring mais ne notent aucun critère : les statuts restent à fixer à l&apos;étape 3.</p>
            </Card>
          )}
          {lecture && (
            <Card title="Pièce">
              <CaseCochee checked={joindre} onChange={setJoindre} disabled={!!enCours}>Ajouter le business plan à la data room (catégorie B, note de présentation du projet)</CaseCochee>
            </Card>
          )}
          {bandeau}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={enCours === "creer"} disabled={!!erreurs.investment || !!erreurs.financing_need} onClick={() => void creer()}>Créer le projet</Button>
            <Button disabled={!!enCours} onClick={retour}>{lecture ? "Téléverser un autre fichier" : "Revenir au choix"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
