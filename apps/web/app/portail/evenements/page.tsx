"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Calendar, CheckCircle2, ChevronDown, Clock, Link2, MapPin, Users } from "@/components/icons";
import { Badge, Button, Card, Empty, ErrorBox, FEUILLE, Loading, Modal, Notice, ProgressBar, Tabs, Textarea, cx, type Tone } from "@/components/ui";
import { EnTete, TexteRiche, ajouterAuCalendrier, dateLongue, heure, quand } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { BOUTON_PRINCIPAL, BlocDate, dateSimple, jourLocal, majuscule, pluriel } from "@/components/portail/cabinet-porteur/briques";
import { erreurLisible } from "@/components/portail/projet/outils";
import { apiSend, useApi } from "@/lib/api-client";
import type { EventRow, RegistrationState } from "@/lib/portail-types";

type Vue = "a-venir" | "inscriptions" | "passes";

const INSCRIPTION: Record<RegistrationState, Tone> = {
  registered: "ok",
  waitlist: "warn",
  attended: "ok",
  absent: "neutral",
  cancelled: "neutral",
};

function passe(e: EventRow) {
  return new Date(e.end).getTime() < Date.now();
}

function horaires(e: EventRow) {
  if (jourLocal(e.start) === jourLocal(e.end)) return `${majuscule(dateLongue(e.start, false))}, de ${heure(e.start)} à ${heure(e.end)}`;
  return `Du ${dateLongue(e.start)} au ${dateLongue(e.end)}`;
}

function Programme({ texte }: { texte: string }) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useId();
  return (
    <div className="mt-4">
      <button type="button" aria-expanded={ouvert} aria-controls={zone} onClick={() => setOuvert((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
        {ouvert ? "Masquer le programme" : "Voir le programme"}
        <ChevronDown className={cx("h-4 w-4 transition-transform", ouvert && "rotate-180")} />
      </button>
      <div id={zone} hidden={!ouvert} className="mt-3 rounded-2xl bg-panel-2 px-4 py-4 sm:px-5">
        <TexteRiche source={texte} compact />
      </div>
    </div>
  );
}

function Places({ e }: { e: EventRow }) {
  if (!e.capacity || e.seats_left === null) return null;
  const prises = e.capacity - e.seats_left;
  const ratio = e.seats_left / e.capacity;
  const tone: Tone = e.seats_left === 0 ? "danger" : ratio <= 0.2 ? "warn" : "accent";
  return (
    <div className="mt-4 max-w-sm">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className={cx("font-semibold", e.seats_left === 0 ? "text-danger" : ratio <= 0.2 ? "text-warn" : "text-ink-2")}>
          {e.seats_left === 0 ? "Complet : liste d'attente ouverte" : `${pluriel(e.seats_left, "place restante", "places restantes")}`}
        </span>
        <span className="tabular text-muted">{prises} / {e.capacity}</span>
      </div>
      <ProgressBar value={(prises / e.capacity) * 100} tone={tone} epaisseur={6} />
    </div>
  );
}

function CarteEvenement({ e, eclaire, message, onInscrire, onDesinscrire }: { e: EventRow; eclaire: boolean; message: string | null; onInscrire: () => void; onDesinscrire: () => void }) {
  const fini = passe(e);
  const annule = e.state === "cancelled";
  const r = e.my_registration;
  const inscrit = r && (r.state === "registered" || r.state === "waitlist");
  const enLigne = e.online_url && /^https:\/\//.test(e.online_url) ? e.online_url : null;
  const lieu = e.location ?? (e.online ? "En ligne" : null);
  return (
    <article
      id={`evenement-${e.id}`}
      className={cx(
        FEUILLE, "relative scroll-mt-24 overflow-hidden transition-shadow duration-500",
        eclaire && "ring-2 ring-accent-vif ring-offset-2 ring-offset-bg",
      )}
    >
      {annule && (
        <div className="flex items-center gap-2 bg-danger-doux px-5 py-2.5 text-[13px] font-semibold text-danger sm:px-6">
          <AlertTriangle className="h-4 w-4 flex-none" /> Événement annulé par le cabinet.
        </div>
      )}
      <div className="flex gap-4 p-5 sm:gap-5 sm:p-6">
        <BlocDate date={e.start} passe={fini || annule} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{e.kind_label}</Badge>
            {r && <Badge tone={INSCRIPTION[r.state]}>{r.state === "registered" && !fini ? "Vous êtes inscrit" : r.state_label}</Badge>}
            {!fini && !annule && <span className="text-[12px] text-muted">{majuscule(quand(e.start))}</span>}
          </div>
          <h3 className={cx("mt-2 font-display text-[19px] font-bold leading-snug", annule ? "text-muted" : "text-ink")}>{e.name}</h3>

          <ul className="mt-3 space-y-1.5 text-[13.5px] text-ink-2">
            <li className="flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 flex-none text-muted" />
              <span>{horaires(e)}</span>
            </li>
            {lieu && (
              <li className="flex items-start gap-2">
                {e.location ? <MapPin className="mt-0.5 h-4 w-4 flex-none text-muted" /> : <Link2 className="mt-0.5 h-4 w-4 flex-none text-muted" />}
                <span>
                  {lieu}
                  {e.location && e.online && <span className="text-muted"> et en ligne</span>}
                </span>
              </li>
            )}
            {e.speaker && (
              <li className="flex items-start gap-2">
                <Users className="mt-0.5 h-4 w-4 flex-none text-muted" />
                <span>Avec {e.speaker}</span>
              </li>
            )}
          </ul>

          {!fini && !annule && <Places e={e} />}

          {!fini && !annule && e.registration_open && e.registration_deadline && !inscrit && (
            <p className="mt-3 text-[12.5px] text-muted">Inscriptions ouvertes jusqu'au {dateLongue(e.registration_deadline)}.</p>
          )}
          {r?.note && <p className="mt-3 text-[12.5px] text-muted">Votre question : « {r.note} »</p>}

          {e.description && <Programme texte={e.description} />}

          {message && (
            <div className="mt-4">
              <Notice tone="ok">{message}</Notice>
            </div>
          )}

          {!annule && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {!fini && !inscrit && e.registration_open && (
                <Button variant="primary" onClick={onInscrire}>
                  {e.seats_left === 0 ? "M'inscrire en liste d'attente" : "Je m'inscris"}
                </Button>
              )}
              {!fini && !inscrit && !e.registration_open && <span className="text-[13px] font-medium text-muted">Inscriptions closes.</span>}
              {!fini && inscrit && enLigne && (
                <a href={enLigne} target="_blank" rel="noopener noreferrer" className={BOUTON_PRINCIPAL}>
                  <Link2 className="h-4 w-4" /> Rejoindre en ligne
                  <span className="sr-only"> (s'ouvre dans un nouvel onglet)</span>
                </a>
              )}
              {!fini && (
                <Button
                  onClick={() =>
                    ajouterAuCalendrier({
                      titre: e.name,
                      debut: e.start,
                      fin: e.end,
                      lieu: e.location ?? enLigne ?? (e.online ? "En ligne" : null),
                      description: [e.kind_label, e.speaker ? `Avec ${e.speaker}` : null, enLigne].filter(Boolean).join("\n"),
                      uid: `evenement-${e.id}`,
                    })
                  }
                >
                  <Calendar className="h-4 w-4" /> Ajouter à mon agenda
                </Button>
              )}
              {!fini && inscrit && (
                <Button variant="danger" onClick={onDesinscrire}>
                  Me désinscrire
                </Button>
              )}
              {fini && r && (r.state === "attended" || r.state === "registered") && (
                <Link href={`/portail/avis?evenement=${e.id}`} className={BOUTON_PRINCIPAL}>
                  <BadgeCheck className="h-4 w-4" /> Donner mon avis
                </Link>
              )}
            </div>
          )}
          {!fini && inscrit && !enLigne && e.online && <p className="mt-2 text-[12px] text-muted">Le lien de connexion apparaîtra ici dès que le cabinet l'aura communiqué.</p>}
        </div>
      </div>
    </article>
  );
}

/** Événements et formations du cabinet : inscription, liste d'attente, agenda, avis après coup. */
export default function Evenements() {
  const { dossier, espace, rafraichir } = usePortail();
  const { data, error, mutate } = useApi<EventRow[]>("/portail/evenements");
  const [vue, setVue] = useState<Vue>("a-venir");
  const [inscription, setInscription] = useState<EventRow | null>(null);
  const [desinscription, setDesinscription] = useState<EventRow | null>(null);
  const [note, setNote] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [eclaire, setEclaire] = useState<number | null>(null);

  const { aVenir, mesInscriptions, passes } = useMemo(() => {
    const liste = data ?? [];
    const futurs = liste.filter((e) => !passe(e)).sort((a, b) => a.start.localeCompare(b.start));
    return {
      aVenir: futurs,
      mesInscriptions: futurs.filter((e) => e.my_registration && e.state !== "cancelled"),
      passes: liste.filter(passe).sort((a, b) => b.start.localeCompare(a.start)),
    };
  }, [data]);

  // Lien profond (#evenement-12) : bon onglet, défilement et mise en évidence.
  useEffect(() => {
    if (!data) return;
    const m = /^#evenement-(\d+)$/.exec(window.location.hash);
    const cible = m ? data.find((e) => e.id === Number(m[1])) : undefined;
    if (!cible) return;
    setVue(passe(cible) ? "passes" : "a-venir");
    setEclaire(cible.id);
    const t1 = window.setTimeout(() => document.getElementById(`evenement-${cible.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    const t2 = window.setTimeout(() => setEclaire(null), 2600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [data]);

  function remplacer(row: EventRow) {
    void mutate((liste) => (liste ?? []).map((e) => (e.id === row.id ? row : e)), { revalidate: false });
  }

  function fermer() {
    setInscription(null);
    setDesinscription(null);
    setNote("");
    setErreur(null);
  }

  async function inscrire() {
    if (!inscription) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const row = await apiSend<EventRow>("POST", `/portail/evenements/${inscription.id}/inscription`, { note: note.trim(), ...(dossier ? { dossier_id: dossier.id } : {}) });
      remplacer(row);
      setMessages((m) => ({
        ...m,
        [row.id]: row.my_registration?.state === "waitlist"
          ? "Vous êtes sur la liste d'attente. Le cabinet vous préviendra si une place se libère."
          : "Inscription confirmée. Ajoutez l'événement à votre agenda pour ne pas l'oublier.",
      }));
      rafraichir();
      fermer();
    } catch (e) {
      setErreur(e);
    } finally {
      setEnvoi(false);
    }
  }

  async function desinscrire() {
    if (!desinscription) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const row = await apiSend<EventRow>("POST", `/portail/evenements/${desinscription.id}/desinscription`);
      remplacer(row);
      setMessages((m) => ({ ...m, [row.id]: "Vous êtes désinscrit. Votre place revient à un autre porteur." }));
      rafraichir();
      fermer();
    } catch (e) {
      setErreur(e);
    } finally {
      setEnvoi(false);
    }
  }

  if (error) return <ErrorBox error={erreurLisible(error)} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement des événements du cabinet…" />;

  const liste = vue === "a-venir" ? aVenir : vue === "inscriptions" ? mesInscriptions : passes;
  const prochain = mesInscriptions.find((e) => e.my_registration?.state === "registered");
  const plusieursDossiers = (espace?.dossiers.length ?? 0) > 1;

  return (
    <div className="space-y-6">
      <EnTete
        surtitre="Le cabinet"
        titre="Événements et formations"
        texte="Ateliers, formations, webinaires et rencontres de MB AxisPro Consulting. Inscrivez-vous en un geste ; le lien de connexion des séances en ligne vous est réservé."
      />

      {prochain && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-ok-doux px-5 py-3.5 text-[13.5px] text-ink">
          <CheckCircle2 className="h-5 w-5 flex-none text-ok" />
          <span className="min-w-0 flex-1">
            Votre prochain rendez-vous : <b>{prochain.name}</b>, {dateLongue(prochain.start)}.
          </span>
        </div>
      )}

      <Tabs<Vue>
        value={vue}
        onChange={setVue}
        tabs={[
          { key: "a-venir", label: "À venir", count: aVenir.length },
          { key: "inscriptions", label: "Mes inscriptions", count: mesInscriptions.length },
          { key: "passes", label: "Passés", count: passes.length },
        ]}
      />

      {liste.length === 0 ? (
        <Card>
          {vue === "a-venir" ? (
            <Empty title="Aucun événement programmé pour l'instant." hint="Le cabinet annonce ici ses ateliers et formations. Vous recevrez une notification à chaque nouvelle date." />
          ) : vue === "inscriptions" ? (
            <Empty title="Vous n'êtes inscrit à aucun événement à venir." hint="Parcourez l'onglet « À venir » : un atelier peut faire gagner des semaines à votre dossier." />
          ) : (
            <Empty title="Aucun événement passé sur les deux derniers mois." />
          )}
        </Card>
      ) : (
        <ul className="space-y-4">
          {liste.map((e) => (
            <li key={e.id}>
              <CarteEvenement
                e={e}
                eclaire={eclaire === e.id}
                message={messages[e.id] ?? null}
                onInscrire={() => {
                  setErreur(null);
                  setInscription(e);
                }}
                onDesinscrire={() => {
                  setErreur(null);
                  setDesinscription(e);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={inscription !== null}
        title="Votre inscription"
        onClose={fermer}
        footer={
          <>
            <Button onClick={fermer}>Annuler</Button>
            <Button variant="primary" loading={envoi} onClick={() => void inscrire()}>
              {inscription?.seats_left === 0 ? "Rejoindre la liste d'attente" : "Confirmer mon inscription"}
            </Button>
          </>
        }
      >
        {inscription && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <BlocDate date={inscription.start} />
              <div className="min-w-0">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">{inscription.kind_label}</div>
                <div className="mt-1 text-[16px] font-semibold leading-snug text-ink">{inscription.name}</div>
                <div className="mt-1 text-[13px] text-muted">{horaires(inscription)}</div>
                <div className="text-[13px] text-muted">{inscription.location ?? "En ligne"}</div>
              </div>
            </div>
            {inscription.seats_left === 0 && (
              <Notice tone="warn">L'événement est complet : vous serez inscrit sur la liste d'attente et prévenu si une place se libère.</Notice>
            )}
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Une question ou une attente pour l'intervenant ? (facultatif)</span>
              <Textarea
                value={note}
                onChange={(ev) => setNote(ev.target.value.slice(0, 1000))}
                aria-label="Question ou attente pour l'intervenant, facultative"
                placeholder="Par exemple : comment présenter mes garanties à une banque ?"
                rows={3}
              />
              <span className="mt-1 block text-right text-[11.5px] tabular text-muted">{note.length} / 1000</span>
            </label>
            {plusieursDossiers && dossier && <p className="text-[12.5px] text-muted">Inscription au titre du dossier {dossier.reference}, {dossier.name}.</p>}
            {inscription.registration_deadline && <p className="text-[12.5px] text-muted">Inscriptions ouvertes jusqu'au {dateSimple(inscription.registration_deadline)}.</p>}
            {erreur !== null && <ErrorBox error={erreurLisible(erreur)} />}
          </div>
        )}
      </Modal>

      <Modal
        open={desinscription !== null}
        title="Vous désinscrire ?"
        onClose={fermer}
        footer={
          <>
            <Button onClick={fermer}>Garder ma place</Button>
            <Button variant="danger" loading={envoi} onClick={() => void desinscrire()}>
              Me désinscrire
            </Button>
          </>
        }
      >
        {desinscription && (
          <div className="space-y-3 text-[14px] leading-relaxed text-ink-2">
            <p>
              Vous quittez « <b className="text-ink">{desinscription.name}</b> », {dateLongue(desinscription.start)}.
            </p>
            <p>Votre place reviendra au premier porteur de la liste d'attente. Vous pourrez vous réinscrire tant que les inscriptions restent ouvertes.</p>
            {erreur !== null && <ErrorBox error={erreurLisible(erreur)} />}
          </div>
        )}
      </Modal>
    </div>
  );
}
