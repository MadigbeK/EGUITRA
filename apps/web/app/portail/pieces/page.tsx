"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock, Download, FileText, FileUp, Info, Paperclip, Printer, X, type Icon } from "@/components/icons";
import { Badge, Button, Card, Empty, ErrorBox, Field, FileButton, Input, Loading, Notice, ProgressBar, Segmented, Select, Tag, cx, demanderConfirmation, type Tone } from "@/components/ui";
import { EnTete, FORMATS, dateHeure, quand, taille } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { ZoneDepot } from "@/components/portail/projet/ZoneDepot";
import { PasDeDossier, messageErreur, telechargerPiece, useRetour, verifierFichier, erreurLisible } from "@/components/portail/projet/outils";
import { apiDownload, apiUpload, useApi } from "@/lib/api-client";
import type { Fichier, PieceAttendue, PieceState, Pieces } from "@/lib/portail-types";

type Filtre = "toutes" | "deposer" | "reprendre" | "validees";

const ETAT: Record<PieceState, { tone: Tone; label: string; icon: Icon; pastille: string }> = {
  missing: { tone: "neutral", label: "À déposer", icon: Circle, pastille: "bg-panel-2 text-muted" },
  received: { tone: "accent", label: "En vérification", icon: Clock, pastille: "bg-accent-doux text-accent" },
  validated: { tone: "ok", label: "Validée", icon: CheckCircle2, pastille: "bg-ok-doux text-ok-texte" },
  rejected: { tone: "danger", label: "À reprendre", icon: AlertTriangle, pastille: "bg-danger-doux text-danger" },
};

const ETAT_FICHIER: Record<Fichier["state"], { tone: Tone; label: string }> = {
  received: { tone: "accent", label: "En vérification" },
  validated: { tone: "ok", label: "Validé" },
  rejected: { tone: "danger", label: "À reprendre" },
};

const FILTRE: Record<Filtre, { test: (p: PieceAttendue) => boolean; vide: string }> = {
  toutes: { test: () => true, vide: "Le cabinet n'a pas encore établi la liste des pièces attendues pour votre dossier." },
  deposer: { test: (p) => p.state === "missing", vide: "Aucune pièce à déposer : tout ce qui est attendu est entre les mains du cabinet." },
  reprendre: { test: (p) => p.state === "rejected", vide: "Aucune pièce à reprendre : vos envois conviennent au cabinet." },
  validees: { test: (p) => p.state === "validated", vide: "Aucune pièce validée pour l'instant. Le cabinet valide chaque pièce après l'avoir vérifiée." },
};

/** Les pièces qui demandent le plus d'attention d'abord. */
function rang(p: PieceAttendue): number {
  if (p.state === "rejected") return 0;
  if (p.state === "missing" && p.due) return p.required ? 1 : 2;
  if (p.state === "received") return 3;
  if (p.state === "missing") return 4;
  return 5;
}

function Compteur({ valeur, label, tone }: { valeur: number; label: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-panel-2/70 px-4 py-3">
      <div className={cx("font-display text-[26px] font-bold leading-none tabular-nums", tone)}>{valeur}</div>
      <div className="mt-1.5 text-[12.5px] font-medium leading-snug text-ink-2">{label}</div>
    </div>
  );
}

function ListeFichiers({ fichiers, cabinet, moi, vide, telechargement, onTelecharger }: { fichiers: Fichier[]; cabinet?: boolean; moi: string; vide: string; telechargement: number | null; onTelecharger: (f: Fichier) => void }) {
  const [tout, setTout] = useState(false);
  if (!fichiers.length) return <Empty title={vide} />;
  const visibles = tout ? fichiers : fichiers.slice(0, 8);
  return (
    <>
      <ul className="divide-y divide-line">
        {visibles.map((f) => {
          const e = ETAT_FICHIER[f.state];
          return (
            <li key={f.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span aria-hidden className={cx("mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-lg", cabinet ? "bg-accent-doux text-accent" : "bg-panel-2 text-ink-2")}>
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words text-[14px] font-medium leading-snug text-ink">{f.name}</span>
                  {!cabinet && <Badge tone={e.tone}>{e.label}</Badge>}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  Version {f.version} · {dateHeure(f.uploaded_at)}
                  {f.size ? ` · ${taille(f.size)}` : ""}
                  {(cabinet || f.uploaded_by !== moi) && ` · ${f.uploaded_by}`}
                </div>
                {f.comment && (
                  <p className={cx("mt-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug", f.state === "rejected" ? "bg-danger-doux text-danger" : "bg-panel-2 text-ink-2")}>
                    {cabinet ? "" : "Commentaire du cabinet : "}
                    {f.comment}
                  </p>
                )}
              </div>
              <Button variant="ghost" className="flex-none px-2.5" loading={telechargement === f.id} onClick={() => onTelecharger(f)} aria-label={`Télécharger ${f.name}`}>
                {telechargement !== f.id && <Download className="h-4 w-4" />}
                <span className="hidden sm:inline">Télécharger</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {fichiers.length > visibles.length && (
        <Button variant="ghost" className="mt-3 w-full" onClick={() => setTout(true)}>
          {fichiers.length - visibles.length === 1 ? "Afficher l'autre fichier" : `Afficher les ${fichiers.length - visibles.length} autres fichiers`}
        </Button>
      )}
    </>
  );
}

export default function PiecesPortail() {
  const { espace, dossier, rafraichir, me } = usePortail();
  const chemin = dossier ? `/portail/dossiers/${dossier.id}/pieces` : null;
  const { data, error, mutate } = useApi<Pieces>(chemin);
  const { setRetour, bandeau } = useRetour();
  const [filtre, setFiltre] = useState<Filtre>("toutes");
  // Un seul dépôt à la fois : la fin d'un dépôt ne peut plus effacer l'indicateur d'un autre, ni un
  // nouveau clic créer une version en double. La référence bloque aussi deux choix de fichier rapprochés.
  const [envoi, setEnvoi] = useState<number | "autre" | null>(null);
  const enCoursRef = useRef(false);
  const [tour, setTour] = useState(0);
  const [pdf, setPdf] = useState(false);
  const [telechargement, setTelechargement] = useState<number | null>(null);
  const [autre, setAutre] = useState<File | null>(null);
  const [intitule, setIntitule] = useState("");
  const [rattache, setRattache] = useState("");

  const groupes = useMemo(() => {
    const out: Array<{ categorie: string; pieces: PieceAttendue[]; validees: number; total: number }> = [];
    for (const p of data?.attendues ?? []) {
      const categorie = p.category || "Autres pièces";
      let g = out.find((x) => x.categorie === categorie);
      if (!g) {
        g = { categorie, pieces: [], validees: 0, total: 0 };
        out.push(g);
      }
      g.total += 1;
      if (p.state === "validated") g.validees += 1;
      if (FILTRE[filtre].test(p)) g.pieces.push(p);
    }
    for (const g of out) g.pieces.sort((a, b) => rang(a) - rang(b));
    return out.filter((g) => g.pieces.length);
  }, [data, filtre]);

  if (espace && !espace.dossiers.length) return <PasDeDossier />;
  if (error) return <ErrorBox error={erreurLisible(error)} onRetry={() => void mutate()} />;
  if (!data || !dossier) return <Loading label="Chargement de vos pièces…" />;

  const id = dossier.id;
  const ferme = data.closed;
  const p = data.progress;
  const manquantes = Math.max(0, p.due - p.received - p.validated - p.rejected);
  const deposees = p.due ? Math.round(((p.validated + p.received) / p.due) * 100) : 100;
  const compte = (f: Filtre) => data.attendues.filter(FILTRE[f].test).length;
  const mesEnvois = data.fichiers.filter((f) => !f.from_cabinet);
  const duCabinet = data.fichiers.filter((f) => f.from_cabinet);

  /** Remplacer une pièce validée la renvoie en vérification : le porteur le confirme d'abord. */
  async function accepteRemplacement(typeId: number | undefined): Promise<boolean> {
    const piece = typeId ? data?.attendues.find((p) => p.document_type_id === typeId) : undefined;
    if (piece?.state !== "validated") return true;
    return demanderConfirmation(
      `Le cabinet a validé « ${piece.name} ». La nouvelle version la remplacera et devra être vérifiée à nouveau ; la version validée reste conservée.`,
      { titre: "Remplacer une pièce validée ?", action: "Remplacer la pièce" },
    );
  }

  async function deposer(fichier: File, typeId?: number, nom?: string, source: number | "autre" = typeId ?? "autre"): Promise<boolean> {
    if (enCoursRef.current) return false;
    const faute = verifierFichier(fichier);
    if (faute) {
      setRetour({ tone: "danger", texte: faute });
      return false;
    }
    enCoursRef.current = true;
    if (!(await accepteRemplacement(typeId))) {
      enCoursRef.current = false;
      setTour((t) => t + 1);
      return false;
    }
    setEnvoi(source);
    try {
      const form = new FormData();
      form.append("file", fichier);
      if (typeId) form.append("document_type_id", String(typeId));
      if (nom?.trim()) form.append("name", nom.trim());
      await apiUpload(`/portail/dossiers/${id}/documents`, form);
      setRetour({ tone: "ok", texte: `« ${fichier.name} » est bien reçu. Le cabinet le vérifie et vous tient informé.` });
      void mutate();
      rafraichir();
      return true;
    } catch (e) {
      setRetour({ tone: "danger", texte: messageErreur(e) });
      return false;
    } finally {
      enCoursRef.current = false;
      setEnvoi(null);
      setTour((t) => t + 1);
    }
  }

  async function envoyerAutre() {
    if (!autre) return;
    const ok = await deposer(autre, rattache ? Number(rattache) : undefined, intitule, "autre");
    if (ok) {
      setAutre(null);
      setIntitule("");
      setRattache("");
    }
  }

  async function telecharger(f: { id: number; name: string }) {
    setTelechargement(f.id);
    try {
      await telechargerPiece(f.id, f.name);
    } catch (e) {
      setRetour({ tone: "danger", texte: messageErreur(e) });
    } finally {
      setTelechargement(null);
    }
  }

  async function listePdf() {
    setPdf(true);
    try {
      await apiDownload(`/portail/dossiers/${id}/pieces.pdf`, "pieces.pdf");
    } catch (e) {
      setRetour({ tone: "danger", texte: messageErreur(e) });
    } finally {
      setPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      <EnTete
        surtitre="Data room"
        titre="Pièces et data room"
        texte="Déposez ici les pièces que le cabinet attend. Chacune est vérifiée, puis validée ou renvoyée avec un commentaire."
        actions={
          <Button onClick={() => void listePdf()} loading={pdf}>
            {!pdf && <Printer className="h-4 w-4" />}
            Liste imprimable des pièces
          </Button>
        }
      />

      {ferme && <Notice tone="neutral">Ce dossier est clos : vos pièces restent consultables et téléchargeables, mais les dépôts sont fermés.</Notice>}

      {/* Progression */}
      <Card>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-[17px] font-semibold text-ink">Préparation de vos pièces</h2>
              <span className="font-display text-[28px] font-bold leading-none tabular-nums text-ink">{deposees} %</span>
            </div>
            <div className="mt-3">
              <ProgressBar value={deposees} tone={p.due > 0 && p.validated === p.due ? "ok" : "accent"} epaisseur={10} />
            </div>
            <p className="mt-2.5 text-[13px] text-muted">
              {p.due === 0
                ? "Aucune pièce obligatoire n'est attendue à cette étape."
                : `${p.validated + p.received} pièce${p.validated + p.received > 1 ? "s" : ""} déposée${p.validated + p.received > 1 ? "s" : ""} sur ${p.due} attendue${p.due > 1 ? "s" : ""} à cette étape, dont ${p.validated} validée${p.validated > 1 ? "s" : ""}.`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Compteur valeur={p.validated} label="Validées" tone="text-ok-texte" />
            <Compteur valeur={p.received} label="Reçues, en vérification" tone="text-accent" />
            <Compteur valeur={p.rejected} label="À reprendre" tone={p.rejected ? "text-danger" : "text-ink"} />
            <Compteur valeur={manquantes} label="Manquantes" tone="text-ink" />
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-12">
        {/* Pièces attendues */}
        <Card title="Pièces attendues" className="xl:col-span-8">
          <Segmented
            label="Filtrer les pièces"
            value={filtre}
            onChange={setFiltre}
            className="mb-5 max-w-full overflow-x-auto"
            options={[
              { key: "toutes", label: `Toutes (${data.attendues.length})` },
              { key: "deposer", label: `À déposer (${compte("deposer")})` },
              { key: "reprendre", label: `À reprendre (${compte("reprendre")})` },
              { key: "validees", label: `Validées (${compte("validees")})` },
            ]}
          />
          {groupes.length === 0 ? (
            <Empty title={FILTRE[filtre].vide} />
          ) : (
            <div className="space-y-6">
              {groupes.map((g) => (
                <section key={g.categorie} aria-label={g.categorie}>
                  <h3 className="mb-2.5 flex items-center gap-3 text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
                    {g.categorie}
                    <span aria-hidden className="h-px flex-1 bg-line" />
                    <span className="font-semibold normal-case tracking-normal">
                      {g.validees}/{g.total} validée{g.validees > 1 ? "s" : ""}
                    </span>
                  </h3>
                  <ul className="space-y-2.5">
                    {g.pieces.map((piece) => {
                      const e = ETAT[piece.state];
                      const I = e.icon;
                      const enCours = envoi === piece.document_type_id;
                      const libelle = piece.state === "missing" ? "Déposer" : piece.state === "rejected" ? "Déposer la nouvelle version" : "Remplacer";
                      return (
                        <li
                          key={piece.document_type_id}
                          className={cx(
                            "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start",
                            piece.state === "rejected" ? "border-danger/25 bg-danger-doux/30" : "border-line",
                          )}
                        >
                          <span aria-hidden className={cx("hidden h-9 w-9 flex-none place-items-center rounded-full sm:grid", e.pastille)}>
                            <I className="h-[18px] w-[18px]" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[14.5px] font-semibold leading-snug text-ink">{piece.name}</span>
                              <Badge tone={e.tone}>{e.label}</Badge>
                              {!piece.required && <Tag>Facultative</Tag>}
                              {!piece.due && piece.gate && <Tag>Attendue à l'étape {piece.gate}</Tag>}
                            </div>
                            {piece.guidance && <p className="mt-1 text-[13px] leading-relaxed text-muted">{piece.guidance}</p>}
                            {piece.state === "rejected" && piece.last_file?.comment && (
                              <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-danger-doux px-3 py-2 text-[13px] text-danger">
                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                                <span>
                                  <span className="font-semibold">Commentaire du cabinet : </span>
                                  {piece.last_file.comment}
                                </span>
                              </div>
                            )}
                            {piece.last_file && (
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                                <span>
                                  Dernier envoi {quand(piece.last_file.uploaded_at, true)}, version {piece.version}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void telecharger({ id: piece.last_file!.id, name: piece.name })}
                                  disabled={telechargement === piece.last_file.id}
                                  aria-busy={telechargement === piece.last_file.id || undefined}
                                  className="inline-flex items-center gap-1 font-semibold text-accent hover:underline disabled:opacity-60"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  Revoir
                                  <span className="sr-only"> le dernier envoi de {piece.name}</span>
                                </button>
                              </div>
                            )}
                          </div>
                          {!ferme && (
                            <div className="flex-none">
                              {enCours ? (
                                <span role="status" className="inline-flex items-center gap-2 px-2.5 py-1 text-[12.5px] font-semibold text-accent">
                                  <span aria-hidden className="n-tourne h-3.5 w-3.5 rounded-full border-2 border-accent-vif/25 border-t-accent-vif" />
                                  Envoi en cours…
                                </span>
                              ) : envoi !== null ? (
                                <Button size="sm" disabled title="Un envoi est en cours : attendez qu'il se termine.">
                                  <FileUp className="h-3.5 w-3.5" />
                                  {libelle}
                                </Button>
                              ) : (
                                <FileButton key={`${piece.document_type_id}-${tour}`} small label={libelle} accept={FORMATS} onFile={(f) => void deposer(f, piece.document_type_id)} />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6 xl:col-span-4">
          {/* Autre document */}
          <Card title="Un autre document">
            {ferme ? (
              <p className="text-sm text-muted">Les dépôts sont fermés sur ce dossier clos.</p>
            ) : autre ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl bg-panel-2 px-3 py-2.5">
                  <Paperclip className="h-4 w-4 flex-none text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">{autre.name}</div>
                    <div className="text-[12px] text-muted">{taille(autre.size)}</div>
                  </div>
                  <button type="button" onClick={() => setAutre(null)} disabled={envoi !== null} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-3 hover:text-ink disabled:opacity-50" aria-label="Retirer ce fichier">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Field label="Intitulé (facultatif)" hint="Ce que contient le document, pour le cabinet.">
                  <Input aria-label="Intitulé du document" value={intitule} onChange={(e) => setIntitule(e.target.value)} maxLength={200} placeholder={autre.name.replace(/\.[^.]+$/, "")} />
                </Field>
                {data.attendues.length > 0 && (
                  <Field label="Il s'agit de">
                    <Select
                      aria-label="Pièce attendue à laquelle rattacher le document"
                      value={rattache}
                      onChange={(e) => setRattache(e.target.value)}
                      placeholder="Un document libre"
                      options={data.attendues.map((a) => ({ value: a.document_type_id, label: a.name }))}
                    />
                  </Field>
                )}
                <Button variant="primary" className="w-full" loading={envoi === "autre"} disabled={envoi !== null} onClick={() => void envoyerAutre()}>
                  Envoyer le document
                </Button>
              </div>
            ) : (
              <ZoneDepot
                disabled={envoi !== null}
                onFile={(f) => {
                  const faute = verifierFichier(f);
                  if (faute) setRetour({ tone: "danger", texte: faute });
                  else setAutre(f);
                }}
              />
            )}
          </Card>

          <Card title="Bon à savoir">
            <ul className="space-y-3 text-[13px] leading-relaxed text-ink-2">
              {[
                "Un fichier par pièce, complet et lisible : toutes les pages, dans le bon sens.",
                "Pour une photo de document : à plat, bien éclairé, sans reflet ni doigt sur la page.",
                "Une pièce « à reprendre » porte le commentaire du cabinet : déposez simplement la nouvelle version.",
                "Chaque envoi crée une nouvelle version : les précédentes restent conservées.",
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Info className="mt-0.5 h-4 w-4 flex-none text-accent" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Mes envois" actions={<span className="text-[13px] text-muted">{mesEnvois.length} fichier{mesEnvois.length > 1 ? "s" : ""}</span>}>
          <ListeFichiers fichiers={mesEnvois} moi={me.name} vide="Vous n'avez encore envoyé aucun fichier." telechargement={telechargement} onTelecharger={(f) => void telecharger(f)} />
        </Card>
        <Card title="Documents du cabinet" actions={<span className="text-[13px] text-muted">{duCabinet.length} fichier{duCabinet.length > 1 ? "s" : ""}</span>}>
          <ListeFichiers fichiers={duCabinet} cabinet moi={me.name} vide="Le cabinet partagera ici ses documents : modèles, rapports, comptes rendus." telechargement={telechargement} onTelecharger={(f) => void telecharger(f)} />
        </Card>
      </div>

      {bandeau}
    </div>
  );
}
