"use client";

import { useState } from "react";
import { Building2, Calendar, ChevronDown, Clock, MapPin, Plus, Smartphone, Trash2, Users, Wifi, type Icon } from "@/components/icons";
import { Badge, Button, Card, Empty, ErrorBox, FEUILLE, Field, Input, Loading, Modal, Notice, Segmented, Textarea, cx, type Tone } from "@/components/ui";
import { EnTete, TexteRiche, ajouterAuCalendrier, dateLongue, formatConakry, heure, instant, quand, versIso, versLocal } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { LienBouton, PasDeDossier, majuscule, messageErreur, useRetour, erreurLisible } from "@/components/portail/projet/outils";
import { apiSend, useApi } from "@/lib/api-client";
import type { MeetingMode, MeetingRow, MeetingState } from "@/lib/portail-types";

const MODES: Array<{ key: MeetingMode; label: string; icon: Icon; aide: string }> = [
  { key: "office", label: "Au cabinet", icon: Building2, aide: "Dans les locaux du cabinet." },
  { key: "video", label: "Visioconférence", icon: Wifi, aide: "Le lien de connexion accompagne la confirmation." },
  { key: "phone", label: "Téléphone", icon: Smartphone, aide: "Un échange par téléphone à l'heure convenue." },
  { key: "site", label: "Sur le site du projet", icon: MapPin, aide: "Votre consultant se déplace sur le lieu du projet." },
];

const ICONE_MODE: Record<MeetingMode, Icon> = { office: Building2, video: Wifi, phone: Smartphone, site: MapPin };

const TON: Record<MeetingState, Tone> = { requested: "warn", confirmed: "ok", done: "ok", declined: "warn", cancelled: "neutral" };

const DUREES = [
  { key: "30", label: "30 min" },
  { key: "60", label: "60 min" },
  { key: "90", label: "90 min" },
] as const;

type Duree = (typeof DUREES)[number]["key"];

const MAX_DEMANDES = 3;

function temps(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}

function finDe(m: MeetingRow): number {
  return m.end ? temps(m.end) : temps(m.start) + m.duration * 60_000;
}

function lienSur(url: string | null): url is string {
  return Boolean(url && /^https:\/\/\S+$/.test(url));
}

/* ─── Rendez-vous confirmé à venir ─────────────────────────────────────── */

function CarteAVenir({ m, ferme, onAnnuler }: { m: MeetingRow; ferme: boolean; onAnnuler: (m: MeetingRow) => void }) {
  const d = instant(m.start!);
  const I = ICONE_MODE[m.mode];
  return (
    <article className={cx(FEUILLE, "overflow-hidden")}>
      <div className="flex flex-col sm:flex-row">
        <div className="bg-accent-strong flex items-center gap-4 px-5 py-4 text-white sm:w-44 sm:flex-none sm:flex-col sm:justify-center sm:gap-1 sm:py-6 sm:text-center">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/80">{formatConakry(d, { weekday: "long" })}</span>
          <span className="font-display text-[44px] font-bold leading-none">{formatConakry(d, { day: "numeric" })}</span>
          <span className="text-[13.5px] font-semibold">{formatConakry(d, { month: "long", year: "numeric" })}</span>
          <span className="ml-auto rounded-full bg-white/15 px-3 py-1 text-[13px] font-semibold sm:ml-0 sm:mt-2">{heure(m.start)}</span>
        </div>
        <div className="min-w-0 flex-1 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ok">Confirmé</Badge>
            <span className="text-[12.5px] font-medium text-muted">{majuscule(quand(m.start))}</span>
          </div>
          <h3 className="mt-2 text-[17px] font-semibold leading-snug text-ink">{m.subject}</h3>
          <p className="mt-0.5 text-[13.5px] text-ink-2">
            {majuscule(dateLongue(m.start))}, jusqu'à {heure(m.end)} ({m.duration} min)
          </p>
          <ul className="mt-3 space-y-1.5 text-[13.5px] text-ink-2">
            <li className="flex items-start gap-2">
              <I className="mt-0.5 h-4 w-4 flex-none text-accent" />
              <span>
                {m.mode_label}
                {m.location && <span className="text-ink">, {m.location}</span>}
              </span>
            </li>
            {lienSur(m.online_url) && (
              <li className="flex items-start gap-2">
                <Wifi className="mt-0.5 h-4 w-4 flex-none text-accent" />
                <a href={m.online_url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all font-semibold text-accent underline underline-offset-2">
                  Rejoindre la visioconférence
                </a>
              </li>
            )}
            {m.consultant && (
              <li className="flex items-start gap-2">
                <Users className="mt-0.5 h-4 w-4 flex-none text-accent" />
                <span>
                  Avec {m.consultant.name}
                  {m.consultant.phone && (
                    <>
                      {", "}
                      <a href={`tel:${m.consultant.phone.replace(/\s/g, "")}`} className="font-medium text-accent hover:underline">
                        {m.consultant.phone}
                      </a>
                    </>
                  )}
                </span>
              </li>
            )}
          </ul>
          {m.agenda && (
            <div className="mt-3 rounded-xl bg-panel-2 px-3.5 py-2.5">
              <div className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-muted">Points à aborder</div>
              <p className="mt-1 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink-2">{m.agenda}</p>
            </div>
          )}
          {m.cabinet_note && (
            <div className="mt-3 rounded-xl border border-accent-vif/20 bg-accent-doux/60 px-3.5 py-2.5 text-[13px] text-ink">
              <span className="font-semibold">Message du cabinet : </span>
              {m.cabinet_note}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {lienSur(m.online_url) && (
              <LienBouton href={m.online_url} variant="primary">
                <Wifi className="h-4 w-4" />
                Rejoindre
              </LienBouton>
            )}
            <Button
              onClick={() =>
                ajouterAuCalendrier({
                  titre: `Rendez-vous MB AxisPro Consulting : ${m.subject}`,
                  debut: m.start!,
                  fin: m.end,
                  lieu: m.location ?? (lienSur(m.online_url) ? m.online_url : m.mode_label),
                  description: [m.agenda, m.consultant ? `Avec ${m.consultant.name}` : null, lienSur(m.online_url) ? `Lien : ${m.online_url}` : null].filter(Boolean).join("\n\n"),
                  uid: `rdv-${m.id}`,
                })
              }
            >
              <Calendar className="h-4 w-4" />
              Ajouter à mon agenda
            </Button>
            {!ferme && (
              <Button variant="danger" onClick={() => onAnnuler(m)}>
                Annuler
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─── Demande en attente de confirmation ───────────────────────────────── */

function CarteEnAttente({ m, ferme, onAnnuler }: { m: MeetingRow; ferme: boolean; onAnnuler: (m: MeetingRow) => void }) {
  const I = ICONE_MODE[m.mode];
  return (
    <article className="flex flex-col rounded-2xl border border-dashed border-warn/40 bg-warn-doux/30 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn" vivant>
          En attente de confirmation
        </Badge>
        <span className="text-[12.5px] text-muted">
          Demandé {quand(m.create_date, true)}
          {!m.requested_by_me && ` par ${m.requested_by}`}
        </span>
      </div>
      <h3 className="mt-2 text-[16px] font-semibold leading-snug text-ink">{m.subject}</h3>
      <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-2">
        <I className="h-4 w-4 text-accent" />
        {m.mode_label}, {m.duration} min
      </p>
      <div className="mt-3">
        <div className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-muted">
          Créneau{m.slots.length > 1 ? "x" : ""} proposé{m.slots.length > 1 ? "s" : ""}
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-2">
          {m.slots.map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5 rounded-lg bg-panel px-2.5 py-1.5 text-[13px] font-medium text-ink ring-1 ring-line">
              <Clock className="h-3.5 w-3.5 text-muted" />
              {majuscule(dateLongue(s))}
            </li>
          ))}
        </ul>
      </div>
      {m.agenda && <p className="mt-3 line-clamp-3 whitespace-pre-line break-words text-[13px] leading-relaxed text-muted">{m.agenda}</p>}
      <p className="mt-3 text-[12.5px] text-muted">Le cabinet retient l'un de ces créneaux ou vous en propose un autre. Vous êtes prévenu dès sa réponse.</p>
      {!ferme && (
        <div className="mt-3">
          <Button variant="danger" size="sm" className="px-3" onClick={() => onAnnuler(m)}>
            <Trash2 className="h-4 w-4" />
            Retirer la demande
          </Button>
        </div>
      )}
    </article>
  );
}

/* ─── Historique ───────────────────────────────────────────────────────── */

function LigneHistorique({ m, ouvertParDefaut }: { m: MeetingRow; ouvertParDefaut: boolean }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  const date = m.start ?? m.slots[0] ?? m.create_date;
  const passe = m.state === "confirmed";
  const label = passe ? "Date passée" : m.state_label;
  return (
    <li className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("text-[14.5px] font-semibold leading-snug", m.state === "cancelled" || m.state === "declined" ? "text-ink-2" : "text-ink")}>{m.subject}</span>
            <Badge tone={passe ? "neutral" : TON[m.state]}>{label}</Badge>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {majuscule(dateLongue(date))} · {m.mode_label}
            {m.consultant && ` · ${m.consultant.name}`}
          </div>
        </div>
        {m.minutes && (
          <Button variant="ghost" size="sm" aria-expanded={ouvert} onClick={() => setOuvert((v) => !v)}>
            {ouvert ? "Masquer le compte rendu" : "Lire le compte rendu"}
            <ChevronDown className={cx("h-4 w-4 transition-transform", ouvert && "rotate-180")} />
          </Button>
        )}
      </div>
      {m.state === "cancelled" && (
        <p className="mt-2 text-[12.5px] text-muted">{m.cancelled_by === "porteur" ? "Annulé à votre demande." : m.cancelled_by === "cabinet" ? "Annulé par le cabinet." : "Rendez-vous annulé."}</p>
      )}
      {m.cabinet_note && (m.state === "declined" || m.state === "cancelled") && (
        <p className="mt-2.5 rounded-lg bg-panel-2 px-3 py-2 text-[13px] leading-relaxed text-ink-2">
          {/* Le motif d'une annulation par le porteur est le sien ; dans les autres cas, le texte vient du cabinet. */}
          <span className="font-semibold text-ink">{m.state === "cancelled" && m.cancelled_by === "porteur" ? "Votre motif" : "Message du cabinet"} : </span>
          {m.cabinet_note}
        </p>
      )}
      {passe && !m.minutes && <p className="mt-2 text-[12.5px] text-muted">Le compte rendu sera partagé ici par votre consultant.</p>}
      {ouvert && m.minutes && (
        <div className="mt-3 rounded-xl bg-panel-2/70 p-4">
          <TexteRiche source={m.minutes} compact />
        </div>
      )}
    </li>
  );
}

/* ─── Demande de rendez-vous ───────────────────────────────────────────── */

function Demande({ chemin, onClose, onEnvoye }: { chemin: string; onClose: () => void; onEnvoye: () => void }) {
  const [sujet, setSujet] = useState("");
  const [ordre, setOrdre] = useState("");
  const [mode, setMode] = useState<MeetingMode>("office");
  const [creneaux, setCreneaux] = useState<string[]>([""]);
  const [duree, setDuree] = useState<Duree>("60");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const minimum = versLocal(new Date().toISOString());
  const aide = MODES.find((x) => x.key === mode)?.aide;

  async function envoyer() {
    const objet = sujet.trim();
    if (!objet) return setErreur("Indiquez l'objet du rendez-vous.");
    const choisis = creneaux.filter(Boolean);
    if (!choisis.length) return setErreur("Proposez au moins un créneau.");
    // Un créneau se lit à l'heure de Conakry, comme le cabinet le lira, quel que soit le fuseau de l'appareil.
    if (choisis.some((s) => !versIso(s))) return setErreur("Un créneau est incomplet : indiquez la date et l'heure.");
    if (choisis.some((s) => new Date(versIso(s)!).getTime() <= Date.now())) return setErreur("Les créneaux proposés doivent être à venir.");
    if (new Set(choisis).size < choisis.length) return setErreur("Deux créneaux proposés sont identiques.");
    setEnvoi(true);
    setErreur(null);
    try {
      await apiSend<MeetingRow>("POST", chemin, {
        subject: objet,
        agenda: ordre.trim(),
        mode,
        slots: choisis.map(versIso).filter((s): s is string => Boolean(s)),
        duration: Number(duree),
      });
      onEnvoye();
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="Demander un rendez-vous"
      onClose={() => !envoi && onClose()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={envoi}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="demande-rendez-vous" loading={envoi}>
            Envoyer la demande
          </Button>
        </>
      }
    >
      <form
        id="demande-rendez-vous"
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void envoyer();
        }}
      >
        <Field label="Objet">
          <Input aria-label="Objet du rendez-vous" value={sujet} onChange={(e) => setSujet(e.target.value)} maxLength={200} required autoFocus placeholder="Par exemple : préparer le rendez-vous avec la banque" />
        </Field>
        <Field label="Points à aborder (facultatif)" hint="Ce que vous souhaitez voir ensemble : votre consultant pourra préparer l'échange.">
          <Textarea aria-label="Points à aborder pendant le rendez-vous" value={ordre} onChange={(e) => setOrdre(e.target.value)} maxLength={3000} rows={4} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Forme du rendez-vous</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((x) => {
              const I = x.icon;
              const choisi = mode === x.key;
              return (
                <label
                  key={x.key}
                  className={cx(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-[14px] font-medium transition-colors focus-within:ring-4 focus-within:ring-accent-vif/15",
                    choisi ? "border-accent-vif bg-accent-doux text-ink" : "border-line text-ink-2 hover:border-line-strong",
                  )}
                >
                  <input type="radio" name="mode-rendez-vous" value={x.key} checked={choisi} onChange={() => setMode(x.key)} aria-label={x.label} className="sr-only" />
                  <span aria-hidden className={cx("grid h-8 w-8 flex-none place-items-center rounded-lg", choisi ? "bg-accent text-white" : "bg-panel-2 text-accent")}>
                    <I className="h-4 w-4" />
                  </span>
                  {x.label}
                </label>
              );
            })}
          </div>
          {aide && <p className="mt-1.5 text-[12px] text-muted">{aide}</p>}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Créneaux proposés (de 1 à 3)</legend>
          <ul className="space-y-2">
            {creneaux.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent-doux text-[12px] font-bold text-accent">{i + 1}</span>
                <Input
                  type="datetime-local"
                  aria-label={`Créneau proposé ${i + 1}`}
                  value={c}
                  min={minimum}
                  required={i === 0}
                  onChange={(e) => setCreneaux((l) => l.map((v, j) => (j === i ? e.target.value : v)))}
                  className="max-w-[260px]"
                />
                {creneaux.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCreneaux((l) => l.filter((_, j) => j !== i))}
                    className="grid h-9 w-9 flex-none place-items-center rounded-lg text-muted hover:bg-panel-3 hover:text-danger"
                    aria-label={`Retirer le créneau ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {creneaux.length < 3 && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCreneaux((l) => [...l, ""])}>
              <Plus className="h-4 w-4" />
              Proposer un autre créneau
            </Button>
          )}
          <p className="mt-1.5 text-[12px] text-muted">Heures de Conakry. Plusieurs créneaux laissent plus de chances au cabinet d'en retenir un rapidement.</p>
        </fieldset>

        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">Durée souhaitée</div>
          <Segmented label="Durée souhaitée" options={DUREES.map((x) => ({ key: x.key, label: x.label }))} value={duree} onChange={setDuree} />
        </div>

        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </form>
    </Modal>
  );
}

/* ─── Annulation ───────────────────────────────────────────────────────── */

function Annulation({ m, onClose, onFait }: { m: MeetingRow; onClose: () => void; onFait: () => void }) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const demande = m.state === "requested";

  async function confirmer() {
    setEnvoi(true);
    setErreur(null);
    try {
      await apiSend<MeetingRow>("POST", `/portail/rendez-vous/${m.id}/annuler`, { reason: motif.trim() });
      onFait();
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      title={demande ? "Retirer la demande de rendez-vous" : "Annuler le rendez-vous"}
      onClose={() => !envoi && onClose()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={envoi}>
            Revenir
          </Button>
          <Button variant="danger" loading={envoi} onClick={() => void confirmer()}>
            {demande ? "Retirer la demande" : "Confirmer l'annulation"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-panel-2 px-3.5 py-3">
          <div className="text-[14.5px] font-semibold text-ink">{m.subject}</div>
          <div className="mt-0.5 text-[13px] text-muted">{m.start ? majuscule(dateLongue(m.start)) : `${m.slots.length} créneau${m.slots.length > 1 ? "x" : ""} proposé${m.slots.length > 1 ? "s" : ""}`}</div>
        </div>
        <Field label="Motif, transmis à votre consultant" hint="Quelques mots suffisent. Vous pourrez demander un autre rendez-vous ensuite.">
          <Textarea aria-label={`Motif de l'annulation de « ${m.subject} »`} value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={1000} rows={3} autoFocus />
        </Field>
        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </div>
    </Modal>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function RendezVous() {
  const { espace, dossier, rafraichir } = usePortail();
  const chemin = dossier ? `/portail/dossiers/${dossier.id}/rendez-vous` : null;
  const { data, error, mutate } = useApi<MeetingRow[]>(chemin);
  const { setRetour, bandeau } = useRetour();
  const [demande, setDemande] = useState(false);
  const [annulation, setAnnulation] = useState<MeetingRow | null>(null);

  if (espace && !espace.dossiers.length) return <PasDeDossier />;
  if (error) return <ErrorBox error={erreurLisible(error)} onRetry={() => void mutate()} />;
  if (!data || !dossier || !chemin) return <Loading label="Chargement de vos rendez-vous…" />;

  const ferme = dossier.state === "closed";
  const maintenant = Date.now();
  const aVenir = data.filter((m) => m.state === "confirmed" && m.start && finDe(m) >= maintenant).sort((a, b) => temps(a.start) - temps(b.start));
  const enAttente = data.filter((m) => m.state === "requested").sort((a, b) => temps(a.slots[0]) - temps(b.slots[0]));
  const historique = data
    .filter((m) => !aVenir.includes(m) && !enAttente.includes(m))
    .sort((a, b) => temps(b.start ?? b.slots[0] ?? b.create_date) - temps(a.start ?? a.slots[0] ?? a.create_date));
  const plein = enAttente.length >= MAX_DEMANDES;
  const premierCompteRendu = historique.find((m) => m.minutes)?.id;

  return (
    <div className="space-y-6">
      <EnTete
        surtitre="Échanges"
        titre="Rendez-vous"
        texte="Demandez un rendez-vous à votre consultant en proposant jusqu'à trois créneaux. Le cabinet confirme l'un d'eux ou vous en propose un autre."
        actions={
          !ferme && (
            <Button variant="primary" onClick={() => setDemande(true)} disabled={plein}>
              <Plus className="h-4 w-4" />
              Demander un rendez-vous
            </Button>
          )
        }
      />

      {ferme && <Notice tone="neutral">Ce dossier est clos : vos rendez-vous restent consultables, sans nouvelle demande.</Notice>}
      {!ferme && plein && <Notice tone="warn">Trois demandes attendent déjà une réponse du cabinet. Vous pourrez en faire une nouvelle dès qu'il aura répondu.</Notice>}

      {data.length === 0 ? (
        <Card>
          <Empty title="Aucun rendez-vous pour l'instant." hint="Proposez un ou plusieurs créneaux à votre consultant : il confirme celui qui lui convient et vous êtes prévenu." />
        </Card>
      ) : (
        <>
          <Card title="À venir" actions={aVenir.length > 0 && <span className="text-[13px] text-muted">{aVenir.length} rendez-vous</span>}>
            {aVenir.length === 0 ? (
              <p className="text-sm text-muted">
                Aucun rendez-vous confirmé à venir.
                {!ferme && !plein && (
                  <>
                    {" "}
                    <button type="button" onClick={() => setDemande(true)} className="font-semibold text-accent hover:underline">
                      Demander un rendez-vous
                    </button>
                  </>
                )}
              </p>
            ) : (
              <div className="space-y-4">
                {aVenir.map((m) => (
                  <CarteAVenir key={m.id} m={m} ferme={ferme} onAnnuler={setAnnulation} />
                ))}
              </div>
            )}
          </Card>

          {enAttente.length > 0 && (
            <Card title="En attente de confirmation" actions={<span className="text-[13px] text-muted">{enAttente.length} demande{enAttente.length > 1 ? "s" : ""}</span>}>
              <div className="grid gap-4 lg:grid-cols-2">
                {enAttente.map((m) => (
                  <CarteEnAttente key={m.id} m={m} ferme={ferme} onAnnuler={setAnnulation} />
                ))}
              </div>
            </Card>
          )}

          {historique.length > 0 && (
            <Card title="Historique">
              <ul className="space-y-3">
                {historique.map((m) => (
                  <LigneHistorique key={m.id} m={m} ouvertParDefaut={m.id === premierCompteRendu} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {/* Fenêtres et bandeau dans un conteneur toujours présent : l'entrée animée de la page ne les rejoue pas. */}
      <div>
        {demande && (
          <Demande
            chemin={chemin}
            onClose={() => setDemande(false)}
            onEnvoye={() => {
              setDemande(false);
              setRetour({ tone: "ok", texte: "Votre demande est envoyée. Le cabinet vous confirmera le créneau retenu." });
              void mutate();
              rafraichir();
            }}
          />
        )}
        {annulation && (
          <Annulation
            m={annulation}
            onClose={() => setAnnulation(null)}
            onFait={() => {
              const etaitDemande = annulation.state === "requested";
              setAnnulation(null);
              setRetour({ tone: "ok", texte: etaitDemande ? "Votre demande est retirée." : "Le rendez-vous est annulé. Votre consultant en est informé." });
              void mutate();
              rafraichir();
            }}
          />
        )}

        {bandeau}
      </div>
    </div>
  );
}
