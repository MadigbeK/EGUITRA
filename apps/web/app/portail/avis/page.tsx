"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { BadgeCheck, Calendar, CheckCircle2, LayoutDashboard, UserCog, type Icon } from "@/components/icons";
import { Button, Card, Empty, ErrorBox, Field, Loading, Notice, Select, Textarea, cx } from "@/components/ui";
import { EnTete } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { dateSimple } from "@/components/portail/cabinet-porteur/briques";
import { Etoile } from "@/components/portail/cabinet-porteur/pictos";
import { apiSend, useApi } from "@/lib/api-client";
import type { EventRow, FeedbackRow, FeedbackTopic } from "@/lib/portail-types";

const SUJETS: Array<{ key: FeedbackTopic; label: string; aide: string; icon: Icon }> = [
  { key: "global", label: "Accompagnement", aide: "Le suivi de votre dossier dans son ensemble", icon: BadgeCheck },
  { key: "consultant", label: "Consultant", aide: "La disponibilité et les conseils de votre consultant", icon: UserCog },
  { key: "portail", label: "Portail", aide: "Ce portail : clarté, rapidité, ce qui manque", icon: LayoutDashboard },
  { key: "event", label: "Événement", aide: "Un atelier ou une formation suivis", icon: Calendar },
];

const NOTES = ["", "Très décevant", "Décevant", "Correct", "Bien", "Excellent"];
const TRENTE_JOURS = 30 * 86_400_000;

/** Note de 1 à 5 en étoiles : boutons radio natifs (flèches du clavier), aperçu au survol. */
function Etoiles({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const nom = useId();
  const [survol, setSurvol] = useState<number | null>(null);
  const vue = survol ?? value;
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-ink-2">Votre note</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex" onMouseLeave={() => setSurvol(null)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} onMouseEnter={() => setSurvol(n)} className="cursor-pointer rounded-lg p-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent-vif">
              <input type="radio" name={nom} value={n} checked={value === n} onChange={() => onChange(n)} aria-label={`${n} sur 5 : ${NOTES[n]}`} className="sr-only" />
              <Etoile
                className={cx("h-9 w-9 transition-[transform,color] duration-150", n <= vue ? "text-or" : "text-line-strong", survol === n && "scale-110")}
                fill={n <= vue ? "currentColor" : "none"}
                strokeWidth={1.4}
              />
            </label>
          ))}
        </div>
        <span aria-hidden className={cx("text-[14px] font-semibold", vue ? "text-ink" : "text-muted")}>{vue ? NOTES[vue] : "Choisissez de 1 à 5 étoiles"}</span>
      </div>
    </fieldset>
  );
}

function teinteReco(n: number) {
  return n <= 6 ? "bg-danger text-white border-danger" : n <= 8 ? "bg-warn-vif text-foret border-warn-vif" : "bg-ok text-white border-ok";
}

/** Recommandation de 0 à 10 en pastilles (radio natifs). */
function Recommandation({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const nom = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-ink-2">Recommanderiez-vous MB AxisPro à un autre porteur de projet ? (facultatif)</legend>
      <div className="grid grid-cols-11 gap-1 sm:gap-1.5">
        {Array.from({ length: 11 }, (_, n) => (
          <label key={n} className="has-[:focus-visible]:rounded-lg has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent-vif">
            <input type="radio" name={nom} value={n} checked={value === n} onChange={() => onChange(n)} aria-label={`${n} sur 10`} className="sr-only" />
            <span
              aria-hidden
              className={cx(
                "grid h-10 cursor-pointer place-items-center rounded-lg border text-[13.5px] font-bold tabular transition-colors",
                value === n ? teinteReco(n) : "border-line bg-panel text-ink-2 hover:border-line-strong hover:bg-panel-2",
              )}
            >
              {n}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-muted">
        <span>Pas du tout</span>
        {value !== null && (
          <button type="button" onClick={() => onChange(null)} className="font-semibold text-accent hover:underline">
            Effacer
          </button>
        )}
        <span>Sans hésiter</span>
      </div>
    </fieldset>
  );
}

function EtoilesLecture({ n }: { n: number }) {
  return (
    <span className="inline-flex" role="img" aria-label={`Note : ${n} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Etoile key={i} className={cx("h-4 w-4", i <= n ? "text-or" : "text-line-strong")} fill={i <= n ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

/** Votre avis : accompagnement, consultant, portail ou événement ; historique des avis donnés. */
export default function VotreAvis() {
  const params = useSearchParams();
  const evenementVoulu = Number(params.get("evenement")) || null;
  const { espace, dossier } = usePortail();
  const { data: historique, error, mutate } = useApi<FeedbackRow[]>("/portail/avis");
  const { data: evenements } = useApi<EventRow[]>("/portail/evenements");

  const [dossierId, setDossierId] = useState<number | null>(null);
  const [sujet, setSujet] = useState<FeedbackTopic>(evenementVoulu ? "event" : "global");
  const [evenementId, setEvenementId] = useState<number | null>(evenementVoulu);
  const [note, setNote] = useState(0);
  const [reco, setReco] = useState<number | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [tente, setTente] = useState(false);
  const [merci, setMerci] = useState<FeedbackRow | null>(null);

  useEffect(() => {
    if (dossierId === null && dossier) setDossierId(dossier.id);
  }, [dossier, dossierId]);

  const passes = useMemo(
    () =>
      (evenements ?? [])
        .filter((e) => e.my_registration && e.my_registration.state !== "waitlist" && (new Date(e.start).getTime() <= Date.now() || e.id === evenementVoulu))
        .sort((a, b) => b.start.localeCompare(a.start)),
    [evenements, evenementVoulu],
  );

  useEffect(() => {
    if (sujet === "event" && evenementId === null && passes[0]) setEvenementId(passes[0].id);
  }, [sujet, evenementId, passes]);

  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!historique) return <Loading label="Chargement…" />;

  const dossiers = espace?.dossiers ?? [];
  const evenement = sujet === "event" ? passes.find((e) => e.id === evenementId) ?? null : null;
  const precedent = historique.find(
    (f) =>
      f.dossier.id === dossierId &&
      f.topic === sujet &&
      (sujet !== "event" || f.event === evenement?.name) &&
      Date.now() - new Date(f.date).getTime() < TRENTE_JOURS,
  );
  const manque = !dossierId ? "Choisissez le dossier concerné." : sujet === "event" && !evenement ? "Choisissez l'événement." : note < 1 ? "Donnez une note de 1 à 5 étoiles." : null;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setTente(true);
    if (manque || !dossierId) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const row = await apiSend<FeedbackRow>("POST", "/portail/avis", {
        dossier_id: dossierId,
        topic: sujet,
        ...(sujet === "event" && evenement ? { event_id: evenement.id } : {}),
        score: note,
        recommend: reco,
        comment: commentaire.trim(),
      });
      await mutate((liste) => [row, ...(liste ?? []).filter((f) => f.id !== row.id)], false);
      setMerci(row);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErreur(err);
    } finally {
      setEnvoi(false);
    }
  }

  function recommencer() {
    setMerci(null);
    setNote(0);
    setReco(null);
    setCommentaire("");
    setTente(false);
    setSujet("global");
  }

  return (
    <div className="space-y-6">
      <EnTete surtitre="Outils" titre="Votre avis" texte="Dites-nous ce qui vous aide et ce qui manque. Votre consultant et la direction du cabinet lisent chaque avis." />

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          {merci ? (
            <Card>
              <div role="status" className="flex flex-col items-center px-4 py-8 text-center">
                <span aria-hidden className="grid h-16 w-16 place-items-center rounded-full bg-ok-doux text-ok">
                  <CheckCircle2 className="h-8 w-8" />
                </span>
                <h2 className="mt-4 font-display text-[24px] font-bold text-ink">Merci pour votre avis.</h2>
                <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-2">
                  Il est transmis au cabinet. {merci.score <= 2 ? "Votre consultant reviendra vers vous pour comprendre ce qui n'a pas fonctionné." : "Il nous aide à mieux accompagner chaque porteur."}
                </p>
                <div className="mt-3">
                  <EtoilesLecture n={merci.score} />
                </div>
                <Button className="mt-6" onClick={recommencer}>
                  Donner un autre avis
                </Button>
              </div>
            </Card>
          ) : (
            <Card title="Donner mon avis">
              <form onSubmit={(e) => void envoyer(e)} className="space-y-6" noValidate>
                {dossiers.length > 1 && (
                  <Field label="Dossier concerné">
                    <Select value={dossierId ?? ""} onChange={(e) => setDossierId(Number(e.target.value) || null)} options={dossiers.map((d) => ({ value: d.id, label: `${d.reference} · ${d.name}` }))} />
                  </Field>
                )}

                <fieldset>
                  <legend className="mb-2 text-[13px] font-medium text-ink-2">Sujet</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SUJETS.map((s) => {
                      const I = s.icon;
                      const choisi = sujet === s.key;
                      return (
                        <label
                          key={s.key}
                          className={cx(
                            "flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-vif",
                            choisi ? "border-accent-vif bg-accent-doux/60" : "border-line hover:border-line-strong hover:bg-panel-2",
                          )}
                        >
                          <input type="radio" name="sujet" value={s.key} checked={choisi} onChange={() => setSujet(s.key)} className="sr-only" />
                          <span aria-hidden className={cx("grid h-9 w-9 flex-none place-items-center rounded-xl", choisi ? "bg-accent text-white" : "bg-panel-2 text-accent")}>
                            <I className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[14px] font-semibold text-ink">{s.label}</span>
                            <span className="block text-[12.5px] leading-snug text-muted">{s.aide}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {sujet === "event" &&
                  (passes.length === 0 ? (
                    <Notice tone="neutral">{evenements ? "Vous n'avez participé à aucun événement du cabinet ces deux derniers mois." : "Chargement de vos événements…"}</Notice>
                  ) : (
                    <Field label="Événement">
                      <Select
                        value={evenementId ?? ""}
                        onChange={(e) => setEvenementId(Number(e.target.value) || null)}
                        options={passes.map((e) => ({ value: e.id, label: `${e.name}, ${dateSimple(e.start)}` }))}
                      />
                    </Field>
                  ))}

                <Etoiles value={note} onChange={setNote} />
                <Recommandation value={reco} onChange={setReco} />

                <Field label="Votre commentaire (facultatif)">
                  <Textarea
                    value={commentaire}
                    onChange={(e) => setCommentaire(e.target.value.slice(0, 3000))}
                    rows={4}
                    placeholder={sujet === "portail" ? "Ce qui vous a été utile, ce que vous aimeriez trouver…" : "Ce qui vous a aidé, ce qui pourrait être mieux…"}
                  />
                </Field>
                <div className="-mt-4 text-right text-[11.5px] tabular text-muted">{commentaire.length} / 3000</div>

                {precedent && (
                  <Notice tone="accent">Vous avez déjà donné un avis sur ce sujet le {dateSimple(precedent.date)} : le nouvel avis le remplacera.</Notice>
                )}
                {tente && manque && <Notice tone="warn">{manque}</Notice>}
                {erreur !== null && <ErrorBox error={erreur} />}

                <div className="flex justify-end">
                  <Button type="submit" variant="primary" loading={envoi}>
                    Envoyer mon avis
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>

        <div className="xl:col-span-5">
          <Card title="Mes avis">
            {historique.length === 0 ? (
              <Empty title="Vous n'avez pas encore donné d'avis." hint="Le premier compte : il aide le cabinet à améliorer son accompagnement." />
            ) : (
              <ul className="space-y-3">
                {historique.map((f) => (
                  <li key={f.id} className={cx("rounded-2xl border p-4", merci?.id === f.id ? "border-ok/40 bg-ok-doux/50" : "border-line")}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13.5px] font-semibold text-ink">{f.topic_label}</span>
                      {f.event && <span className="text-[12.5px] text-muted">· {f.event}</span>}
                      <span className="ml-auto text-[12px] text-muted">{dateSimple(f.date)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <EtoilesLecture n={f.score} />
                      {f.recommend !== null && <span className="text-[12px] text-muted">Recommandation : <b className="tabular text-ink-2">{f.recommend} / 10</b></span>}
                    </div>
                    {f.comment && <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">« {f.comment} »</p>}
                    {dossiers.length > 1 && <div className="mt-2 text-[11.5px] text-muted">Dossier {f.dossier.reference}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
