"use client";

import { useState, type MouseEvent } from "react";
import { Download, FileText, Inbox, Pencil, Plus, RotateCcw, Send, Sparkles, Trash2 } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import {
  Coche, EditeurTexte, Intitule, LectureSeule, RESERVE_CABINET, Recherche, basculerCode, correspond, etatPublication, listeCodes, messageErreur, pluriel, useEcriture, useRetour,
} from "@/components/portail/cabinet/outils";
import { COULEUR, FORMATS, FORMATS_TEXTE, iconeRubrique, quand, taille } from "@/components/portail/commun";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, FileButton, IconTile, Input, Kpi, Loading, Modal, Notice, PageHeader, Segmented, Select, Tag, Textarea, cx, demanderConfirmation, type Column } from "@/components/ui";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import type { ArticleAdmin, ArticleKind, CategoryColor, CategoryRow, Cibles, PublicationState } from "@/lib/portail-types";

type FiltreEtat = "all" | PublicationState;
type ActionArticle = "publier" | "brouillon" | "archiver" | "supprimer";

const ICONES_PROPOSEES = ["BookOpen", "Landmark", "TrendingUp", "HandCoins", "Scale", "Building2", "FileCheck2", "FileText", "ListChecks", "Calculator", "Wallet", "Target", "Users", "Calendar", "Gavel", "Layers", "Info", "FolderOpen"];

const NOM_COULEUR: Record<CategoryColor, string> = { azur: "Azur", lagon: "Lagon", or: "Or", jade: "Jade", corail: "Corail", violet: "Rose" };

export default function RessourcesPage() {
  const ecriture = useEcriture();
  const { data, error, mutate } = useApi<ArticleAdmin[]>("/axispro/portail/articles");
  const { data: rubriques, error: erreurRubriques, mutate: majRubriques } = useApi<CategoryRow[]>("/axispro/portail/rubriques");
  const { data: cibles } = useApi<Cibles>("/axispro/portail/cibles");
  const [etat, setEtat] = useState<FiltreEtat>("all");
  const [rubrique, setRubrique] = useState("");
  const [q, setQ] = useState("");
  const [edition, setEdition] = useState<ArticleAdmin | "nouveau" | null>(null);
  const [rubriqueEditee, setRubriqueEditee] = useState<CategoryRow | "nouvelle" | null>(null);
  const { agir, bandeau } = useRetour();

  const articles = data ?? [];
  const cats = [...(rubriques ?? [])].sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name, "fr"));
  const nomRubrique = (id: number | null) => cats.find((c) => c.id === id) ?? null;
  const brouillons = articles.filter((a) => a.state === "draft").length;
  const publies = articles.filter((a) => a.state === "published");
  const vues = articles.reduce((s, a) => s + a.stats.views, 0);
  const utiles = articles.reduce((s, a) => s + a.stats.helpful, 0);
  const avis = utiles + articles.reduce((s, a) => s + a.stats.not_helpful, 0);
  const rows = articles.filter(
    (a) =>
      (etat === "all" || a.state === etat) &&
      (rubrique === "" || (rubrique === "none" ? a.category_id === null : String(a.category_id) === rubrique)) &&
      correspond(q, a.title, a.summary, a.tags_text, a.kind_label),
  );

  async function action(a: ArticleAdmin, act: ActionArticle) {
    const questions: Record<ActionArticle, string | null> = {
      publier: `Publier « ${a.title} » ? Les porteurs des dossiers en cours en seront prévenus.`,
      brouillon: `Repasser « ${a.title} » en brouillon ? Il disparaîtra du portail jusqu'à sa republication.`,
      archiver: `Archiver « ${a.title} » ? Il disparaîtra du portail des porteurs.`,
      supprimer: `Supprimer définitivement « ${a.title} » et ses fichiers ?`,
    };
    const question = questions[act];
    if (question && !(await demanderConfirmation(question, { action: { publier: "Publier", brouillon: "Repasser en brouillon", archiver: "Archiver", supprimer: "Supprimer" }[act], danger: act === "supprimer" }))) return;
    const ok: Record<ActionArticle, string> = { publier: "Contenu publié.", brouillon: "Contenu repassé en brouillon.", archiver: "Contenu archivé.", supprimer: "Contenu supprimé." };
    const r = await agir(() => apiSend("POST", `/axispro/portail/articles/${a.id}/${act}`), ok[act]);
    if (r !== undefined) await Promise.all([mutate(), majRubriques()]);
  }

  const blocage = !ecriture ? RESERVE_CABINET : undefined;
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const colonnes: Column<ArticleAdmin>[] = [
    {
      key: "title",
      label: "Contenu",
      sortValue: (a) => a.title.toLowerCase(),
      render: (a) => (
        <div className="min-w-[240px] max-w-[440px]">
          <div className="font-semibold text-ink">{a.title}</div>
          {a.summary && <div className="line-clamp-1 text-[12.5px] text-muted">{a.summary}</div>}
          {(a.featured || a.files.length > 0 || a.video_url || a.gate_codes) && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {a.featured && <Badge tone="accent">À la une</Badge>}
              {a.files.length > 0 && <Tag>{pluriel(a.files.length, "fichier", "fichiers")}</Tag>}
              {a.video_url && <Tag>Vidéo</Tag>}
              {a.gate_codes && <Tag>{`Étapes ${listeCodes(a.gate_codes).join(", ")}`}</Tag>}
            </div>
          )}
        </div>
      ),
    },
    { key: "kind_label", label: "Format", sortValue: (a) => a.kind_label },
    {
      key: "category_id",
      label: "Rubrique",
      sortValue: (a) => nomRubrique(a.category_id)?.name ?? "",
      render: (a) => {
        const c = nomRubrique(a.category_id);
        return c ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: COULEUR[c.color].vif }} />
            {c.name}
          </span>
        ) : (
          <span className="text-muted">Sans rubrique</span>
        );
      },
    },
    {
      key: "state",
      label: "État",
      sortValue: (a) => a.state,
      render: (a) => {
        const e = etatPublication(a.state);
        return (
          <span className="flex flex-col items-start gap-0.5">
            <Badge tone={e.tone}>{a.state === "draft" ? "Brouillon à relire" : e.label}</Badge>
            {a.published_at && <span className="whitespace-nowrap text-[11.5px] text-muted">publié {quand(a.published_at)}</span>}
          </span>
        );
      },
    },
    { key: "views", label: "Lectures", align: "right", sortValue: (a) => a.stats.views, render: (a) => a.stats.views },
    { key: "readers", label: "Lecteurs", align: "right", sortValue: (a) => a.stats.readers, render: (a) => a.stats.readers },
    {
      key: "helpful",
      label: "Utile / pas utile",
      align: "right",
      sortValue: (a) => a.stats.helpful - a.stats.not_helpful,
      render: (a) => (
        <span title={`${pluriel(a.stats.helpful, "porteur l'a trouvé utile", "porteurs l'ont trouvé utile")}, ${a.stats.not_helpful} pas utile`}>
          <span className="text-ok-texte">{a.stats.helpful}</span> / <span className={a.stats.not_helpful ? "text-danger" : undefined}>{a.stats.not_helpful}</span>
        </span>
      ),
    },
    { key: "bookmarks", label: "Favoris", align: "right", sortValue: (a) => a.stats.bookmarks, render: (a) => a.stats.bookmarks },
    {
      key: "actions",
      label: "",
      render: (a) => (
        <div className="flex items-center justify-end gap-1">
          {a.state !== "published" && (
            <Button variant="primary" size="sm" disabled={!ecriture} title={blocage} onClick={stop(() => void action(a, "publier"))}>
              <Send className="h-3.5 w-3.5" /> {a.state === "archived" ? "Republier" : "Publier"}
            </Button>
          )}
          {a.state !== "draft" && (
            <Button variant="ghost" size="sm" disabled={!ecriture} title={blocage ?? "Repasser en brouillon"} onClick={stop(() => void action(a, "brouillon"))}>
              <RotateCcw className="h-3.5 w-3.5" /> Brouillon
            </Button>
          )}
          {a.state !== "archived" && (
            <Button variant="ghost" size="sm" disabled={!ecriture} title={blocage ?? "Archiver"} onClick={stop(() => void action(a, "archiver"))}>
              <Inbox className="h-3.5 w-3.5" /> Archiver
            </Button>
          )}
          {a.state !== "published" && (
            <button type="button" aria-label={`Supprimer ${a.title}`} title={blocage ?? "Supprimer"} disabled={!ecriture} onClick={stop(() => void action(a, "supprimer"))} className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger disabled:cursor-not-allowed disabled:opacity-40">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Centre de ressources"
        subtitle="Guides, fiches outils, modèles et vidéos proposés aux porteurs, rangés par rubrique. Un contenu peut être recommandé aux dossiers arrivés à certaines étapes."
        actions={
          <>
            <Button disabled={!ecriture} title={blocage} onClick={() => setRubriqueEditee("nouvelle")}>
              <Plus className="h-4 w-4" /> Nouvelle rubrique
            </Button>
            <Button variant="primary" disabled={!ecriture || !cibles} title={blocage} onClick={() => setEdition("nouveau")}>
              <Plus className="h-4 w-4" /> Nouveau contenu
            </Button>
          </>
        }
      />
      <OngletsPortail />
      <div className="space-y-5">
        <LectureSeule ecriture={ecriture} />
        {bandeau}
        {error && <ErrorBox error={error} onRetry={() => void mutate()} />}

        {data && (
          <section aria-label="Chiffres clés" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Contenus publiés" value={String(publies.length)} hint={`sur ${pluriel(articles.length, "contenu", "contenus")}`} />
            <Kpi label="Brouillons à relire" value={String(brouillons)} tone={brouillons ? "warn" : "ok"} hint={brouillons ? "À relire, compléter puis publier" : "Tout est relu"} />
            <Kpi label="Lectures" value={String(vues)} hint={`Lecteurs cumulés par contenu : ${articles.reduce((s, a) => s + a.stats.readers, 0)}`} />
            <Kpi label="Jugés utiles" value={avis ? `${Math.round((utiles / avis) * 100)} %` : "–"} tone={avis ? (utiles / avis >= 0.7 ? "ok" : "warn") : "neutral"} hint={avis ? `sur ${pluriel(avis, "avis", "avis")}` : "Aucun avis pour l'instant"} />
          </section>
        )}

        {brouillons > 0 && etat !== "draft" && (
          <Notice tone="warn">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <b>{pluriel(brouillons, "contenu attend", "contenus attendent")} une relecture.</b> Les contenus proposés à l&apos;installation sont des brouillons : relisez-les, adaptez-les au cabinet, puis publiez-les.
              </span>
              <Button size="sm" onClick={() => setEtat("draft")}>
                Afficher les brouillons
              </Button>
            </span>
          </Notice>
        )}

        <Card title="Contenus" padded={false} actions={<span className="text-[12.5px] text-muted">{pluriel(rows.length, "contenu affiché", "contenus affichés")}</span>}>
          <div className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-1">
            <div className="-mx-1 overflow-x-auto px-1">
              <Segmented
                label="État des contenus"
                value={etat}
                onChange={setEtat}
                options={[
                  { key: "all", label: `Tous (${articles.length})` },
                  { key: "draft", label: `Brouillons (${brouillons})` },
                  { key: "published", label: `Publiés (${publies.length})` },
                  { key: "archived", label: `Archivés (${articles.filter((a) => a.state === "archived").length})` },
                ]}
              />
            </div>
            <Select aria-label="Rubrique" className="w-52" value={rubrique} onChange={(e) => setRubrique(e.target.value)} options={[{ value: "", label: "Toutes les rubriques" }, { value: "none", label: "Sans rubrique" }, ...cats.map((c) => ({ value: String(c.id), label: c.name }))]} />
            <Recherche className="min-w-[200px] flex-1" label="Rechercher un contenu" placeholder="Titre, chapeau, mot-clé" value={q} onChange={setQ} />
          </div>
          {!data ? (
            !error && <Loading label="Chargement des contenus…" />
          ) : (
            <DataTable columns={colonnes} rows={rows} rowKey={(a) => a.id} onRowClick={(a) => setEdition(a)} empty={articles.length ? "Aucun contenu dans cette sélection." : "Aucun contenu pour l'instant."} />
          )}
        </Card>

        <Card title="Rubriques" actions={<span className="text-[12.5px] text-muted">Ordre d&apos;affichage au portail</span>}>
          {erreurRubriques && <ErrorBox error={erreurRubriques} onRetry={() => void majRubriques()} />}
          {!rubriques ? (
            !erreurRubriques && <Loading label="Chargement des rubriques…" />
          ) : cats.length === 0 ? (
            <Empty title="Aucune rubrique." hint="Créez des rubriques (financement, gestion, juridique…) pour ranger les contenus du centre de ressources." />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cats.map((c) => (
                <li key={c.id} className="flex items-start gap-3 rounded-xl border border-line p-3.5">
                  <IconTile icon={iconeRubrique(c.icon)} teinte={COULEUR[c.color].teinte} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold text-ink">{c.name}</span>
                      <span className="flex-none text-[11.5px] tabular text-muted">ordre {c.sequence}</span>
                    </div>
                    {c.description && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{c.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12.5px]">
                      <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setRubrique(String(c.id))}>
                        {pluriel(c.count ?? 0, "contenu", "contenus")}
                      </button>
                      <button type="button" className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40" disabled={!ecriture} title={blocage} onClick={() => setRubriqueEditee(c)}>
                        <Pencil className="h-3.5 w-3.5" /> Modifier
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {edition && cibles && (
        <EditeurArticle
          initial={edition === "nouveau" ? null : edition}
          rubriques={cats}
          cibles={cibles}
          ecriture={ecriture}
          onClose={() => setEdition(null)}
          onChange={() => Promise.all([mutate(), majRubriques()])}
          onDone={async (texte) => {
            setEdition(null);
            await agir(() => Promise.all([mutate(), majRubriques()]), texte);
          }}
        />
      )}
      {rubriqueEditee && cibles && (
        <EditeurRubrique
          rubrique={rubriqueEditee === "nouvelle" ? null : rubriqueEditee}
          couleurs={cibles.colors}
          suivant={(cats[cats.length - 1]?.sequence ?? 0) + 10}
          onClose={() => setRubriqueEditee(null)}
          onDone={async (texte) => {
            setRubriqueEditee(null);
            await agir(() => majRubriques(), texte);
          }}
        />
      )}
    </div>
  );
}

/* ─── Rubrique ─────────────────────────────────────────────────────────── */

function EditeurRubrique({ rubrique, couleurs, suivant, onClose, onDone }: { rubrique: CategoryRow | null; couleurs: CategoryColor[]; suivant: number; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [f, setF] = useState({
    name: rubrique?.name ?? "",
    description: rubrique?.description ?? "",
    icon: rubrique?.icon ?? "BookOpen",
    color: rubrique?.color ?? couleurs[0] ?? "azur",
    sequence: String(rubrique?.sequence ?? suivant),
  });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const icones = ICONES_PROPOSEES.includes(f.icon) ? ICONES_PROPOSEES : [f.icon, ...ICONES_PROPOSEES];

  async function enregistrer() {
    if (!f.name.trim()) {
      setErreur("Donnez un nom à la rubrique.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    const corps = { name: f.name.trim(), description: f.description.trim(), icon: f.icon, color: f.color, sequence: Number(f.sequence) || 0 };
    try {
      if (rubrique) await apiSend("PATCH", `/axispro/portail/rubriques/${rubrique.id}`, corps);
      else await apiSend("POST", "/axispro/portail/rubriques", corps);
      await onDone(rubrique ? "Rubrique modifiée." : "Rubrique créée.");
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  const Apercu = iconeRubrique(f.icon);
  return (
    <Modal
      open
      title={rubrique ? "Modifier la rubrique" : "Nouvelle rubrique"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={envoi} onClick={() => void enregistrer()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <div className="flex items-center gap-3 rounded-xl bg-panel-2 p-3">
          <IconTile icon={Apercu} teinte={COULEUR[f.color].teinte} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">{f.name || "Nom de la rubrique"}</div>
            <div className="truncate text-[12.5px] text-muted">{f.description || "Description courte"}</div>
          </div>
        </div>
        <Field label="Nom">
          <Input value={f.name} maxLength={80} placeholder="Exemple : Trouver un financement" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Description" hint="Une phrase, 200 caractères au plus.">
          <Textarea className="min-h-[60px]" value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div>
          <Intitule>Icône</Intitule>
          <div role="radiogroup" aria-label="Icône de la rubrique" className="flex flex-wrap gap-1.5">
            {icones.map((nom) => {
              const I = iconeRubrique(nom);
              const pris = f.icon === nom;
              return (
                <button key={nom} type="button" role="radio" aria-checked={pris} aria-label={nom} title={nom} onClick={() => setF({ ...f, icon: nom })} className={cx("grid h-9 w-9 place-items-center rounded-lg border transition-colors", pris ? "border-accent-vif bg-accent-doux text-accent" : "border-line text-ink-2 hover:border-line-strong hover:bg-panel-2")}>
                  <I className="h-[18px] w-[18px]" />
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <Intitule>Teinte</Intitule>
            <div role="radiogroup" aria-label="Teinte de la rubrique" className="flex flex-wrap gap-2">
              {couleurs.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={NOM_COULEUR[c]} title={NOM_COULEUR[c]} onClick={() => setF({ ...f, color: c })} className={cx("h-8 w-8 rounded-full transition-transform", f.color === c ? "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-panel" : "hover:scale-105")} style={{ background: COULEUR[c].vif }} />
              ))}
            </div>
          </div>
          <Field label="Ordre" hint="Plus petit d'abord.">
            <Input type="number" inputMode="numeric" step={1} value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Contenu ──────────────────────────────────────────────────────────── */

interface SaisieArticle {
  title: string;
  summary: string;
  kind: ArticleKind;
  category_id: string;
  tags: string;
  gate_codes: string;
  featured: boolean;
  video_url: string;
  body: string;
}

function saisieDe(a: ArticleAdmin | null): SaisieArticle {
  return {
    title: a?.title ?? "",
    summary: a?.summary ?? "",
    kind: a?.kind ?? "article",
    category_id: a?.category_id ? String(a.category_id) : "",
    tags: a?.tags_text ?? "",
    gate_codes: a?.gate_codes ?? "",
    featured: a?.featured ?? false,
    video_url: a?.video_url ?? "",
    body: a?.body ?? "",
  };
}

function EditeurArticle({ initial, rubriques, cibles, ecriture, onClose, onChange, onDone }: { initial: ArticleAdmin | null; rubriques: CategoryRow[]; cibles: Cibles; ecriture: boolean; onClose: () => void; onChange: () => Promise<unknown>; onDone: (message: string) => Promise<void> }) {
  const [article, setArticle] = useState<ArticleAdmin | null>(initial);
  const [f, setF] = useState<SaisieArticle>(() => saisieDe(initial));
  const [envoi, setEnvoi] = useState<"brouillon" | "publier" | "fichier" | null>(null);
  const [retour, setRetour] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const set = <K extends keyof SaisieArticle>(k: K, v: SaisieArticle[K]) => setF((x) => ({ ...x, [k]: v }));
  const etat = article?.state ?? "draft";
  const ordreGates = cibles.gates.map((g) => g.code);

  function controle(): string | null {
    if (!f.title.trim()) return "Donnez un titre au contenu.";
    if (f.video_url.trim() && !f.video_url.trim().startsWith("https://")) return "L'adresse de la vidéo doit commencer par https://.";
    if (f.body.length > 60_000) return "Texte trop long (60 000 caractères au plus).";
    return null;
  }

  async function enregistrer(publier: boolean) {
    const probleme = controle();
    if (probleme) {
      setRetour({ tone: "danger", text: probleme });
      return;
    }
    if (publier && etat !== "published" && !(await demanderConfirmation("Publier ce contenu ? Les porteurs des dossiers en cours en seront prévenus.", { action: "Publier" }))) return;
    setEnvoi(publier ? "publier" : "brouillon");
    setRetour(null);
    const corps = {
      title: f.title.trim(),
      summary: f.summary.trim(),
      kind: f.kind,
      category_id: f.category_id ? Number(f.category_id) : null,
      tags: f.tags.trim(),
      gate_codes: f.gate_codes,
      featured: f.featured,
      video_url: f.video_url.trim(),
      body: f.body,
    };
    try {
      const enregistre = article
        ? await apiSend<ArticleAdmin>("PATCH", `/axispro/portail/articles/${article.id}`, corps)
        : await apiSend<ArticleAdmin>("POST", "/axispro/portail/articles", corps);
      setArticle(enregistre);
      if (!article) await onChange();
      if (publier && etat !== "published") {
        await apiSend("POST", `/axispro/portail/articles/${enregistre.id}/publier`);
        await onDone("Contenu publié : les porteurs en sont prévenus.");
        return;
      }
      if (!article) {
        setRetour({ tone: "ok", text: "Brouillon enregistré. Vous pouvez maintenant joindre des fichiers." });
        return;
      }
      await onDone(etat === "published" ? "Contenu mis à jour." : "Brouillon enregistré.");
    } catch (e) {
      setRetour({ tone: "danger", text: messageErreur(e) });
    } finally {
      setEnvoi(null);
    }
  }

  async function joindre(file: File) {
    if (!article) return;
    setEnvoi("fichier");
    setRetour(null);
    const form = new FormData();
    form.set("file", file);
    try {
      setArticle(await apiUpload<ArticleAdmin>(`/axispro/portail/articles/${article.id}/fichiers`, form));
      await onChange();
      setRetour({ tone: "ok", text: `Fichier « ${file.name} » ajouté.` });
    } catch (e) {
      setRetour({ tone: "danger", text: messageErreur(e) });
    } finally {
      setEnvoi(null);
    }
  }

  async function retirer(attId: number, nom: string) {
    if (!article || !(await demanderConfirmation(`Retirer le fichier « ${nom} » ?`, { action: "Retirer", danger: true }))) return;
    setRetour(null);
    try {
      setArticle(await apiSend<ArticleAdmin>("DELETE", `/axispro/portail/articles/${article.id}/fichiers/${attId}`));
      await onChange();
    } catch (e) {
      setRetour({ tone: "danger", text: messageErreur(e) });
    }
  }

  async function telecharger(attId: number, nom: string) {
    if (!article) return;
    try {
      await apiDownload(`/axispro/portail/articles/${article.id}/fichiers/${attId}`, nom);
    } catch (e) {
      setRetour({ tone: "danger", text: messageErreur(e) });
    }
  }

  const e = etatPublication(etat);
  return (
    <Modal
      open
      wide
      title={!article ? "Nouveau contenu" : ecriture ? "Modifier le contenu" : "Contenu"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          {ecriture && etat !== "published" && (
            <Button variant="secondary" loading={envoi === "brouillon"} disabled={envoi !== null} onClick={() => void enregistrer(false)}>
              {etat === "archived" ? "Enregistrer" : "Enregistrer le brouillon"}
            </Button>
          )}
          {ecriture && (
            <Button variant="primary" loading={envoi === "publier"} disabled={envoi !== null} onClick={() => void enregistrer(true)}>
              <Send className="h-4 w-4" /> {etat === "published" ? "Enregistrer" : etat === "archived" ? "Republier" : "Publier"}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={!ecriture} className="min-w-0 space-y-4">
        {retour && <Notice tone={retour.tone}>{retour.text}</Notice>}
        {article && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <Badge tone={e.tone}>{etat === "draft" ? "Brouillon à relire" : e.label}</Badge>
            <span>
              {article.author}
              {article.published_at ? `, publié ${quand(article.published_at)}` : ""}, {pluriel(article.reading_minutes || 1, "minute", "minutes")} de lecture.
            </span>
            <span>
              {pluriel(article.stats.views, "lecture", "lectures")}, {pluriel(article.stats.readers, "lecteur", "lecteurs")}, {article.stats.helpful} utile, {article.stats.not_helpful} pas utile, {pluriel(article.stats.bookmarks, "favori", "favoris")}.
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Titre" className="md:col-span-2">
            <Input value={f.title} maxLength={200} placeholder="Exemple : Préparer son plan de trésorerie" onChange={(ev) => set("title", ev.target.value)} />
          </Field>
          <Field label="Format">
            <Select value={f.kind} onChange={(ev) => set("kind", ev.target.value as ArticleKind)} options={cibles.article_kinds.map((k) => ({ value: k.key, label: k.label }))} />
          </Field>
        </div>
        <Field label="Chapeau" hint="Une ou deux phrases qui donnent envie de lire, 300 caractères au plus.">
          <Textarea className="min-h-[60px]" value={f.summary} maxLength={300} onChange={(ev) => set("summary", ev.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Rubrique">
            <Select value={f.category_id} onChange={(ev) => set("category_id", ev.target.value)} options={[{ value: "", label: "Sans rubrique" }, ...rubriques.map((c) => ({ value: String(c.id), label: c.name }))]} />
          </Field>
          <Field label="Mots-clés" hint="Séparés par des virgules." className="md:col-span-2">
            <Input value={f.tags} maxLength={300} placeholder="trésorerie, banque, crédit" onChange={(ev) => set("tags", ev.target.value)} />
          </Field>
        </div>
        <div>
          <Intitule hint="Le contenu est proposé en priorité aux dossiers arrivés à ces étapes.">Étapes recommandées</Intitule>
          <div className="flex flex-wrap gap-2">
            {cibles.gates.length === 0 && <span className="text-[13px] text-muted">Aucune étape : la grille d&apos;évaluation n&apos;est pas importée.</span>}
            {cibles.gates.map((g) => {
              const coche = listeCodes(f.gate_codes).includes(g.code);
              return (
                <label key={g.code} className={cx("inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors", coche ? "border-accent-vif/50 bg-accent-doux text-ink" : "border-line bg-panel text-ink-2 hover:border-line-strong")}>
                  <input type="checkbox" aria-label={`Recommander à l'étape ${g.code} ${g.name}`} className="h-3.5 w-3.5" checked={coche} onChange={() => set("gate_codes", basculerCode(f.gate_codes, g.code, ordreGates))} />
                  <span className="font-semibold">{g.code}</span> {g.name}
                </label>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Adresse de la vidéo" hint="Facultative, https://… (YouTube, Vimeo…)." className="md:col-span-2">
            <Input value={f.video_url} maxLength={500} inputMode="url" placeholder="https://" onChange={(ev) => set("video_url", ev.target.value)} />
          </Field>
          <div className="md:pt-7">
            <Coche checked={f.featured} onChange={(v) => set("featured", v)} hint="Mis en avant en tête du centre de ressources.">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-or" /> À la une
              </span>
            </Coche>
          </div>
        </div>
        <EditeurTexte label="Texte" value={f.body} onChange={(v) => set("body", v)} hauteur={320} placeholder={"# Pourquoi c'est utile\nUn plan de trésorerie montre au banquier que vous **maîtrisez vos encaissements**.\n- Listez les entrées\n- Listez les sorties\n> Votre consultant relit votre plan avant le comité."} />
      </fieldset>

      <section aria-label="Fichiers joints" className="mt-5 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Intitule hint={`${FORMATS_TEXTE} Dix fichiers au plus.`}>Fichiers joints</Intitule>
          {ecriture && article && <FileButton small label={envoi === "fichier" ? "Envoi en cours…" : "Ajouter un fichier"} accept={FORMATS} onFile={(file) => void joindre(file)} />}
        </div>
        {!article ? (
          <p className="mt-2 text-[13px] text-muted">Enregistrez d&apos;abord le contenu (en brouillon) pour y joindre des fichiers.</p>
        ) : article.files.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">Aucun fichier joint.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {article.files.map((file) => (
              <li key={file.id} className="flex items-center gap-3 py-2">
                <FileText className="h-4 w-4 flex-none text-muted" />
                <button type="button" className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium text-ink hover:text-accent hover:underline" onClick={() => void telecharger(file.id, file.name)} title={`Télécharger ${file.name}`}>
                  {file.name}
                </button>
                <span className="flex-none text-[12px] text-muted">{taille(file.size)}</span>
                <button type="button" aria-label={`Télécharger ${file.name}`} className="rounded-lg p-1.5 text-muted hover:bg-panel-3 hover:text-ink" onClick={() => void telecharger(file.id, file.name)}>
                  <Download className="h-4 w-4" />
                </button>
                {ecriture && (
                  <button type="button" aria-label={`Retirer ${file.name}`} title="Retirer" className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger" onClick={() => void retirer(file.id, file.name)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
