"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Download, X } from "@/components/icons";
import { Button, Card, Field, FileButton, Input, Notice } from "@/components/ui";
import { texteErreur } from "@/components/hsseq/commun";
import { ApiError, apiUpload } from "@/lib/api-client";
import { INSECABLE, fmtDec, fmtInt, pluriel } from "@/lib/format";
import { LignesSignalees } from "./elements";
import { ListeViolations, versLigne } from "./ListeViolations";
import type { DryRun, ImportResult, LigneSignalee, RefusImport } from "./types";

/** Taille au plus d'un fichier (MAX_IMPORT du contrôleur). */
const TAILLE_MAX = 5 * 1024 * 1024;
/** Le noyau reconnaît le format au contenu ; le sélecteur propose d'abord les CSV et les classeurs Excel. */
const FORMATS = ".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SOURCES = ["IVMS", "OBC", "GPS"];
const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";
const I = INSECABLE;

/**
 * Résultat du dernier envoi : contrôle à blanc passé, fichier refusé ligne à ligne (`trace` : refus de
 * l'import confirmé, gardé dans l'historique), ou autre refus.
 */
type Controle = { etat: "pret"; resultat: DryRun } | { etat: "refuse"; total: number; lignes: LigneSignalee[]; trace: boolean } | { etat: "erreur"; message: string };

const REFUS: Partial<Record<string, string>> = {
  forbidden: "L'import des violations est réservé au Responsable HSSEQ.",
};

/** « 1,2 Mo », « 840 ko ». */
function taille(octets: number): string {
  return octets >= 1024 * 1024 ? `${fmtDec(Math.round(octets / 104857.6) / 10)}${I}Mo` : `${fmtInt(Math.max(1, Math.round(octets / 1024)))}${I}ko`;
}

/**
 * Nouvel import (profil hsseq) : le fichier exporté du système du fournisseur, la source s'il n'en porte
 * pas la colonne, puis le contrôle à blanc (POST /hsseq/telematics/import avec dry_run=1 : rien n'est
 * enregistré), qui liste les lignes refusées et leur motif ou montre les violations à créer (au format de
 * la liste, servi par le noyau), les doublons et les avertissements ; enfin l'import confirmé, tout ou
 * rien : refusé, il ne crée aucune violation et reste dans l'historique avec ses lignes en cause. L'aide
 * décrit les colonnes reconnues par le noyau (models/telematics.py) et propose un modèle de fichier.
 */
export function NouvelImport({ onVoir }: { onVoir: (id: number) => void }) {
  const { mutate } = useSWRConfig();
  const [fichier, setFichier] = useState<File | null>(null);
  // Le sélecteur est remonté à chaque choix : un fichier corrigé sous le même nom se choisit de nouveau.
  const [selecteur, setSelecteur] = useState(0);
  const [source, setSource] = useState("");
  const [controle, setControle] = useState<Controle | null>(null);
  const [envoi, setEnvoi] = useState<"controle" | "import" | null>(null);
  const [importe, setImporte] = useState<ImportResult | null>(null);
  const [aide, setAide] = useState(false);

  function choisir(f: File) {
    setFichier(f);
    setSelecteur((n) => n + 1);
    setControle(null);
    setImporte(null);
  }

  function abandonner() {
    setFichier(null);
    setSelecteur((n) => n + 1);
    setControle(null);
  }

  async function envoyer(aBlanc: boolean) {
    if (!fichier) return;
    if (fichier.size > TAILLE_MAX) {
      setControle({ etat: "erreur", message: `Fichier trop volumineux (${taille(fichier.size)})${I}: 5${I}Mo au plus. Scindez l'export du fournisseur, par semaine ou par site.` });
      return;
    }
    const form = new FormData();
    form.append("file", fichier);
    if (source.trim()) form.append("source", source.trim());
    if (aBlanc) form.append("dry_run", "1");
    setEnvoi(aBlanc ? "controle" : "import");
    try {
      if (aBlanc) {
        setControle({ etat: "pret", resultat: await apiUpload<DryRun>("/hsseq/telematics/import", form) });
      } else {
        const resultat = await apiUpload<ImportResult>("/hsseq/telematics/import", form);
        setImporte(resultat);
        abandonner();
        setSource("");
        // Historique, violations et situation du mois (cockpit) relus.
        void mutate((k) => typeof k === "string" && (k.startsWith("/hsseq/telematics/") || k.startsWith("/hsseq/cockpit")));
      }
    } catch (e) {
      if (e instanceof ApiError && e.body.error === "import_rejected") {
        const corps = e.body as unknown as RefusImport;
        const lignes = corps.errors ?? [];
        // Le noyau compte toutes les lignes en erreur dans son message et n'en liste que les 200 premières.
        const total = Number(/(\d+)\s*ligne/.exec(corps.message ?? "")?.[1] ?? lignes.length);
        const trace = !aBlanc && Boolean(corps.import_id);
        setControle({ etat: "refuse", total: Math.max(total, lignes.length), lignes, trace });
        // L'import confirmé refusé est gardé dans l'historique : il est relu.
        if (trace) void mutate((k) => typeof k === "string" && k.startsWith("/hsseq/telematics/imports"));
      } else {
        setControle({ etat: "erreur", message: texteErreur(e, REFUS, aBlanc ? "Le fichier n'a pas pu être contrôlé." : "L'import n'a pas abouti.") });
      }
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <Card
      title="Nouvel import"
      actions={
        <Button variant="ghost" size="sm" aria-expanded={aide} onClick={() => setAide(!aide)}>
          {aide ? "Masquer les colonnes attendues" : "Colonnes attendues"}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="m-0 max-w-[80ch] text-[13.5px] leading-relaxed text-ink-2">
          Fichier exporté du système du fournisseur des boîtiers (OBC, GPS, IVMS), en CSV ou en Excel (.xlsx), 5&nbsp;Mo au plus. L&apos;import est tout ou rien&nbsp;: une seule ligne illisible refuse le fichier entier. Contrôlez-le d&apos;abord, rien n&apos;est enregistré avant l&apos;import.
        </p>

        {aide && <Aide />}

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-full">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Fichier</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <FileButton key={selecteur} label={fichier ? "Changer de fichier" : "Choisir le fichier"} accept={FORMATS} onFile={choisir} />
              {fichier ? (
                <span className="min-w-0 break-all text-[13px] text-ink">
                  {fichier.name} <span className="text-muted">({taille(fichier.size)})</span>
                </span>
              ) : (
                <span className="text-[13px] text-muted">Aucun fichier choisi</span>
              )}
            </div>
          </div>
          <Field label="Source" className="w-full sm:w-56">
            <Input
              list="sources-telematique"
              value={source}
              maxLength={64}
              placeholder="IVMS, OBC, GPS…"
              onChange={(e) => {
                setSource(e.target.value);
                // Un contrôle passé avec une autre source ne vaut plus.
                if (controle) setControle(null);
              }}
            />
            <datalist id="sources-telematique">
              {SOURCES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          {/* Contrôle passé : l'import devient l'action principale, plus bas. */}
          <Button variant={controle?.etat === "pret" ? "secondary" : "primary"} disabled={!fichier || envoi !== null} loading={envoi === "controle"} onClick={() => void envoyer(true)}>
            {controle?.etat === "pret" ? "Contrôler de nouveau" : "Contrôler le fichier"}
          </Button>
        </div>
        <p className="-mt-2 text-[12.5px] leading-snug text-muted">La source ne se saisit que si le fichier n&apos;a pas de colonne «&nbsp;Source&nbsp;»&nbsp;; elle vaut alors pour toutes ses lignes.</p>

        {importe && <Importe resultat={importe} onVoir={onVoir} onFermer={() => setImporte(null)} />}
        {controle?.etat === "erreur" && <Notice tone="danger">{controle.message}</Notice>}
        {controle?.etat === "refuse" && <Refus total={controle.total} lignes={controle.lignes} trace={controle.trace} />}
        {controle?.etat === "pret" && fichier && <Apercu resultat={controle.resultat} envoi={envoi} onImporter={() => void envoyer(false)} onAbandonner={abandonner} />}
      </div>
    </Card>
  );
}

/**
 * Fichier refusé : nombre de lignes en cause, puis chaque ligne et son motif (les 200 premières). Un
 * import confirmé refusé (`trace`) ne crée aucune violation mais reste dans l'historique.
 */
function Refus({ total, lignes, trace }: { total: number; lignes: LigneSignalee[]; trace: boolean }) {
  return (
    <div className="space-y-3">
      <Notice tone="danger">
        <p className="m-0 font-semibold">
          Fichier refusé{I}: {pluriel(total, "ligne en erreur", "lignes en erreur")}. {trace ? `Aucune violation n'est enregistrée${I}; le refus est gardé dans l'historique des imports.` : "Rien n'est enregistré."}
        </p>
        <p className="m-0 mt-1 text-ink">Corrigez ces lignes dans le fichier, ou retirez-les, puis choisissez-le de nouveau et contrôlez-le.</p>
      </Notice>
      <div className="rounded-xl border border-line bg-panel-2 px-4 py-3">
        <LignesSignalees lignes={lignes} />
        {total > lignes.length && <p className="m-0 mt-2 text-[12.5px] text-muted">Les {fmtInt(lignes.length)} premières lignes en cause sont listées.</p>}
      </div>
    </div>
  );
}

/**
 * Contrôle à blanc réussi : lignes lues, violations à créer, doublons, avertissements (conducteur non
 * reconnu, nom lu cité) et les 50 premières violations, au format des lignes de la liste (véhicule, site,
 * conducteur et rotation rattachée servis par le noyau) ; puis l'import confirmé, ou l'abandon.
 */
function Apercu({ resultat, envoi, onImporter, onAbandonner }: { resultat: DryRun; envoi: "controle" | "import" | null; onImporter: () => void; onAbandonner: () => void }) {
  const lignes = resultat.preview.map((p, i) => versLigne(p, i, true));
  const rien = resultat.to_create === 0;
  return (
    <section aria-labelledby="telematique-apercu" className="space-y-4 border-t border-line pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="telematique-apercu" className="m-0 text-[15px] font-semibold text-ink">
          Contrôle à blanc
        </h3>
        <p className="m-0 text-[12.5px] text-muted">Rien n&apos;est encore enregistré.</p>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3">
        <Nombre terme="Lignes lues" valeur={resultat.rows} />
        <Nombre terme="Violations à créer" valeur={resultat.to_create} />
        <Nombre terme="Doublons ignorés" valeur={resultat.duplicates} />
      </dl>
      {resultat.duplicates > 0 && (
        <p className="m-0 text-[12.5px] leading-snug text-muted">
          Un doublon est une violation déjà enregistrée (même identifiant et même source, ou même véhicule, même type et même heure) ou répétée dans le fichier&nbsp;: il est ignoré.
        </p>
      )}
      {resultat.warnings.length > 0 && (
        <Notice tone="warn">
          <p className="m-0 font-semibold">{pluriel(resultat.warnings.length, "avertissement")}, sans empêcher l&apos;import</p>
          <div className="mt-2">
            <LignesSignalees lignes={resultat.warnings} />
          </div>
        </Notice>
      )}
      {rien ? (
        <Notice tone="neutral">{resultat.rows === 0 ? `Le fichier ne contient aucune ligne remplie sous l'en-tête${I}: rien à importer.` : `Toutes les violations du fichier sont déjà enregistrées${I}: rien à importer.`}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <ListeViolations lignes={lignes} nomsCaches={false} vide={{ titre: "Aucune violation à créer." }} />
          {resultat.to_create > lignes.length && (
            <p className="m-0 border-t border-line px-5 py-2.5 text-[12.5px] text-muted">
              Les {fmtInt(lignes.length)} premières violations sur {fmtInt(resultat.to_create)}.
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={onAbandonner} disabled={envoi === "import"}>
          Abandonner
        </Button>
        {!rien && (
          <Button variant="primary" loading={envoi === "import"} disabled={envoi !== null} onClick={onImporter}>
            Importer {pluriel(resultat.to_create, "violation")}
          </Button>
        )}
      </div>
    </section>
  );
}

function Nombre({ terme, valeur }: { terme: string; valeur: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-panel-2 px-3.5 py-2.5">
      <dt className="text-[12px] leading-snug text-muted">{terme}</dt>
      <dd className="m-0 mt-1 font-display text-[22px] font-[650] leading-none tabular text-ink">{fmtInt(valeur)}</dd>
    </div>
  );
}

/** Import enregistré : ce qui a été créé, ignoré, signalé, et le lien vers ses violations. */
function Importe({ resultat, onVoir, onFermer }: { resultat: ImportResult; onVoir: (id: number) => void; onFermer: () => void }) {
  return (
    <Notice tone="ok">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-semibold">
            Import enregistré{I}: {pluriel(resultat.created, "violation créée", "violations créées")}
            {resultat.duplicates > 0 ? `, ${pluriel(resultat.duplicates, "doublon ignoré", "doublons ignorés")}` : ""}.
          </p>
          <p className="m-0 mt-0.5 break-all text-ink-2">{resultat.name}</p>
          {resultat.warnings.length > 0 && <p className="m-0 mt-0.5 text-ink-2">{pluriel(resultat.warnings.length, "avertissement")} (conducteur non reconnu), à revoir dans l&apos;historique.</p>}
          {resultat.created > 0 && (
            <button type="button" className={`${LIEN} mt-1.5`} onClick={() => onVoir(resultat.id)}>
              Voir les violations de cet import
            </button>
          )}
        </div>
        <button type="button" onClick={onFermer} className="-mr-1 grid h-8 w-8 flex-none place-items-center rounded-lg text-muted transition-colors hover:bg-panel hover:text-ink" aria-label="Fermer le message">
          <X className="h-4 w-4" />
        </button>
      </div>
    </Notice>
  );
}

/** Colonnes reconnues par le noyau (HEADERS de models/telematics.py), une fois accents et majuscules retirés. */
const COLONNES: Array<{ nom: string; requise?: boolean; entetes: string; contenu: string }> = [
  { nom: "Date et heure", requise: true, entetes: "Date, Date et heure, Horodatage, Timestamp", contenu: `jj/mm/aaaa hh:mm, aaaa-mm-jj hh:mm ou cellule de date d'Excel, à l'heure de Conakry${I}; jamais dans le futur. La date seule si l'heure a sa colonne.` },
  { nom: "Heure", entetes: "Heure, Heure locale, Heure de l'événement, Time", contenu: `Colonne à part, qui complète la date${I}: 14:05, 14:05:30, 8h30 ou cellule d'heure d'Excel.` },
  { nom: "Véhicule", requise: true, entetes: "Véhicule, Ensemble, Immatriculation, Code véhicule, Plaque", contenu: "Code de l'ensemble (ER-05) ou immatriculation du tracteur ou de la remorque, espaces et tirets ignorés." },
  { nom: "Type", requise: true, entetes: "Type, Type de violation, Violation, Infraction, Événement, Alerte", contenu: "Excès de vitesse (ou survitesse, vitesse), freinage brusque (freinage), conduite de nuit (nuit), temps de conduite (conduite continue, fatigue), en français ou en anglais." },
  { nom: "Chauffeur", entetes: "Chauffeur, Conducteur, Driver", contenu: `Nom écrit comme dans Transport. Non reconnu ou absent${I}: le chauffeur de la rotation en cours, avec un avertissement s'il n'est pas reconnu.` },
  { nom: "Source", entetes: "Source, Système, Fournisseur, Boîtier", contenu: `OBC, GPS, IVMS… Sans cette colonne, le champ «${I}Source${I}» du formulaire.` },
  { nom: "Valeur et seuil", entetes: `Valeur, Vitesse, Vitesse relevée${I}; Seuil, Limite, Vitesse autorisée`, contenu: `Nombres, virgule ou point décimal${I}; la vitesse en km/h.` },
  { nom: "Durée", entetes: "Durée, Durée (min), Durée minutes", contenu: "En minutes." },
  { nom: "Lieu", entetes: "Lieu, Position, Localisation, Adresse", contenu: "Texte libre." },
  { nom: "Identifiant", entetes: "Identifiant, Id, Référence, Numéro", contenu: `Référence de la violation chez le fournisseur${I}: déjà importée avec la même source, elle est ignorée.` },
];

/** Modèle de fichier : l'en-tête et deux lignes d'exemple, refusées telles quelles (ensembles fictifs). */
function telechargerModele() {
  const lignes = [
    "Date;Véhicule;Chauffeur;Type;Source;Valeur;Seuil;Durée (min);Lieu;Identifiant",
    "14/10/2026 09:12;EXEMPLE-1;Prénom Nom;Excès de vitesse;IVMS;92;70;3;RN1, Linsan;IV-000001",
    "14/10/2026 21:40;EXEMPLE-2;;Conduite de nuit;IVMS;;;45;RN6, Kouroussa;IV-000002",
  ];
  // Marque d'ordre des octets : Excel ouvre le fichier en UTF-8 (le noyau la retire).
  const blob = new Blob([`﻿${lignes.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modele-violations.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Aide : colonnes attendues, en-têtes reconnus, règles de lecture et modèle de fichier. */
function Aide() {
  return (
    <section aria-label="Colonnes attendues" className="space-y-3 rounded-xl border border-line bg-panel-2 px-4 py-4 sm:px-5">
      <p className="m-0 text-[13px] leading-relaxed text-ink-2">
        En-têtes en première ligne, dans n&apos;importe quel ordre, majuscules et accents indifférents. CSV en UTF-8 ou en Latin-1, séparé par des points-virgules, des virgules ou des tabulations&nbsp;; Excel&nbsp;: la première feuille du classeur, sans macro. 20&nbsp;000 lignes au plus. Chaque violation est rattachée à la rotation du véhicule en cours à cette heure-là.
      </p>
      <dl className="m-0 divide-y divide-line">
        {COLONNES.map((c) => (
          <div key={c.nom} className="grid gap-x-4 gap-y-0.5 py-2.5 text-[13px] leading-snug sm:grid-cols-[11rem_minmax(0,1fr)]">
            <dt className="font-semibold text-ink">
              {c.nom}
              {c.requise && <span className="block text-[12px] font-medium text-muted">obligatoire</span>}
            </dt>
            <dd className="m-0 min-w-0">
              <span className="text-ink-2">{c.contenu}</span>
              <span className="mt-0.5 block text-[12px] text-muted">En-têtes reconnus{I}: {c.entetes}</span>
            </dd>
          </div>
        ))}
      </dl>
      <Button size="sm" onClick={telechargerModele}>
        <Download className="h-3.5 w-3.5" /> Modèle de fichier (CSV)
      </Button>
    </section>
  );
}
