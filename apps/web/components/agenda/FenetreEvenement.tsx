"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "@/components/icons";
import { Button, Field, Input, Modal, Notice, Segmented, Select, Textarea, cx } from "@/components/ui";
import { apiGet, apiSend, messageErreur } from "@/lib/api-client";
import {
  AIDE_VISIBILITE,
  CODES_JOURS,
  DELAIS_RAPPEL,
  FICHES,
  JOURS,
  LIBELLES_STATUT,
  LIBELLES_VISIBILITE,
  heure,
  jourDe,
  jourLong,
  libelleRappel,
  lireInstant,
  recurrenceParDefaut,
  versApi,
  type AgendaMe,
  type Creneau,
  type DetailEvenement,
  type Disponibilite,
  type Portee,
  type Rappel,
  type Resultat,
  type SpecRecurrence,
  type Statut,
  type Visibilite,
} from "@/lib/agenda";
import { decalerJours, depuisSaisieHeure, versSaisieHeure } from "@/lib/format";

export type Brouillon =
  | { mode: "creer"; debut: Date; fin: Date; allday?: boolean; calendar_id?: number; res_model?: string; res_id?: number; titre?: string }
  | { mode: "modifier"; detail: DetailEvenement };

type Invite = { cle: string; user_id?: number; partner_id?: number; email?: string; name: string; required: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RANGS = [
  { value: 1, label: "1er" }, { value: 2, label: "2e" }, { value: 3, label: "3e" }, { value: 4, label: "4e" }, { value: -1, label: "dernier" },
];

function invitesDe(detail: DetailEvenement): Invite[] {
  return detail.attendees.map((a) => ({
    cle: a.user_id ? `u${a.user_id}` : `e${a.email}`, user_id: a.user_id ?? undefined, partner_id: a.partner_id ?? undefined,
    email: a.user_id ? undefined : (a.email ?? undefined), name: a.name, required: a.required,
  }));
}

/** Formulaire complet d'un événement : création, ou modification (d'une occurrence, de la suite ou de toute la série). */
export function FenetreEvenement({ me, brouillon, onFermer, onFait }: { me: AgendaMe; brouillon: Brouillon; onFermer: () => void; onFait: (r: Resultat, message: string) => void }) {
  const detail = brouillon.mode === "modifier" ? brouillon.detail : null;
  const ecrivables = me.calendars.filter((c) => c.can_write && c.kind !== "resource");
  const ressources = me.calendars.filter((c) => c.kind === "resource");
  const debut0 = detail ? detail.start : versApi(brouillon.mode === "creer" ? brouillon.debut : new Date());
  const fin0 = detail ? detail.stop : versApi(brouillon.mode === "creer" ? brouillon.fin : new Date());
  const [titre, setTitre] = useState(detail?.title ?? (brouillon.mode === "creer" ? (brouillon.titre ?? "") : ""));
  const [calendrier, setCalendrier] = useState<number>(detail?.event_calendar_id ?? (brouillon.mode === "creer" ? (brouillon.calendar_id ?? me.personal_calendar_id) : me.personal_calendar_id));
  const [journee, setJournee] = useState(detail?.allday ?? (brouillon.mode === "creer" ? Boolean(brouillon.allday) : false));
  const [debut, setDebut] = useState(versSaisieHeure(debut0));
  const [fin, setFin] = useState(versSaisieHeure(fin0));
  const [jourDebut, setJourDebut] = useState(detail?.start_date ?? jourDe(lireInstant(debut0)));
  const [jourFin, setJourFin] = useState(detail?.end_date ?? jourDe(lireInstant(debut0)));
  const [lieu, setLieu] = useState(detail?.location ?? "");
  const [visio, setVisio] = useState(detail?.video_url ?? "");
  const [description, setDescription] = useState(detail?.description ?? "");
  const [visibilite, setVisibilite] = useState<Visibilite>(detail?.privacy ?? "public");
  const [statut, setStatut] = useState<Statut>(detail?.show_as ?? "busy");
  const [categories, setCategories] = useState<number[]>(detail?.categories.map((c) => c.id) ?? []);
  const [rappels, setRappels] = useState<Rappel[] | null>(detail?.alarms ?? null);
  const [recurrence, setRecurrence] = useState<SpecRecurrence | null>(detail?.recurrence?.spec ?? null);
  const [recurrenceTouchee, setRecurrenceTouchee] = useState(false);
  const [invites, setInvites] = useState<Invite[]>(detail ? invitesDe(detail) : []);
  const [choixRessources, setChoixRessources] = useState<number[]>(detail?.resource_ids?.map((r) => r.id) ?? []);
  const [portee, setPortee] = useState<Portee>(detail?.recurring ? (detail.exception ? "this" : "this") : "all");
  const [q, setQ] = useState("");
  const [trouves, setTrouves] = useState<Array<{ cle: string; name: string; detail: string; invite: Invite }>>([]);
  const [dispos, setDispos] = useState<Map<number, Disponibilite>>(new Map());
  const [occupationsRessources, setOccupationsRessources] = useState<Map<number, Disponibilite["busy"]>>(new Map());
  const [creneaux, setCreneaux] = useState<Creneau[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const fiche = brouillon.mode === "creer" && brouillon.res_model ? { model: brouillon.res_model, id: brouillon.res_id } : null;

  const instants = useMemo(() => {
    if (journee) {
      return { s: lireInstant(`${jourDebut}T00:00:00Z`), e: lireInstant(`${decalerJours(jourFin, 1)}T00:00:00Z`) };
    }
    const s = depuisSaisieHeure(debut);
    const e = depuisSaisieHeure(fin);
    return { s: s ? new Date(s) : null, e: e ? new Date(e) : null };
  }, [journee, debut, fin, jourDebut, jourFin]);

  // Recherche d'un collègue ou d'un contact du carnet ; une adresse électronique s'ajoute telle quelle.
  useEffect(() => {
    const texte = q.trim();
    if (texte.length < 2) {
      setTrouves([]);
      return;
    }
    const t = window.setTimeout(async () => {
      const [users, contacts] = await Promise.all([
        apiGet<Array<{ id: number; name: string; email: string | null }>>(`/agenda/users?q=${encodeURIComponent(texte)}&limit=6`).catch(() => []),
        apiGet<Array<{ id: number; name: string; email: string }>>(`/agenda/contacts?q=${encodeURIComponent(texte)}`).catch(() => []),
      ]);
      const deja = new Set(invites.map((i) => i.cle));
      const liste: Array<{ cle: string; name: string; detail: string; invite: Invite }> = [
        ...users.filter((u) => u.id !== me.user.id).map((u) => ({ cle: `u${u.id}`, name: u.name, detail: "Compte NIMOVA", invite: { cle: `u${u.id}`, user_id: u.id, name: u.name, required: true } })),
        ...contacts.map((c) => ({ cle: `e${c.email.toLowerCase()}`, name: c.name, detail: c.email, invite: { cle: `e${c.email.toLowerCase()}`, partner_id: c.id, name: c.name, required: true } })),
      ];
      if (EMAIL.test(texte)) liste.push({ cle: `e${texte.toLowerCase()}`, name: texte, detail: "Adresse électronique", invite: { cle: `e${texte.toLowerCase()}`, email: texte, name: texte, required: true } });
      setTrouves(liste.filter((x) => !deja.has(x.cle)));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, invites, me.user.id]);

  // Disponibilités en direct des participants internes et des ressources, pour la journée de l'événement.
  const internes = invites.filter((i) => i.user_id).map((i) => i.user_id!);
  const cleDispos = `${internes.join(",")}|${choixRessources.join(",")}|${instants.s ? jourDe(instants.s) : ""}`;
  useEffect(() => {
    if (!instants.s || (!internes.length && !choixRessources.length)) return;
    const jour = jourDe(instants.s);
    const t = window.setTimeout(async () => {
      const r = await apiSend<{ people: Disponibilite[]; resources: Array<{ id: number; busy: Disponibilite["busy"] }> }>("POST", "/agenda/freebusy", {
        user_ids: internes, resource_ids: choixRessources, start: `${jour}T00:00:00Z`, end: `${decalerJours(jour, 1)}T00:00:00Z`,
      }).catch(() => null);
      if (!r) return;
      setDispos(new Map(r.people.map((p) => [p.id, p])));
      setOccupationsRessources(new Map(r.resources.map((x) => [x.id, x.busy])));
    }, 400);
    return () => window.clearTimeout(t);
    // La clé résume participants, ressources et jour : relire seulement quand elle change.
  }, [cleDispos]);

  function etat(busy: Disponibilite["busy"]): { texte: string; ton: string } {
    if (!instants.s || !instants.e) return { texte: "", ton: "" };
    const s = instants.s.getTime();
    const e = instants.e.getTime();
    const choc = busy.find((b) => lireInstant(b.start).getTime() < e && lireInstant(b.stop).getTime() > s && !(detail && b.start === detail.start && b.stop === detail.stop));
    if (!choc) return { texte: "Libre", ton: "text-ok-texte" };
    const motif = { oof: "Absent du bureau", absence: "En congé", tentative: "Provisoire", busy: "Occupé" }[choc.kind];
    return { texte: `${motif} (${heure(choc.start)} - ${heure(choc.stop)})`, ton: choc.kind === "tentative" ? "text-warn" : "text-danger" };
  }

  async function trouver() {
    setErreur(null);
    const duree = instants.s && instants.e ? Math.max(15, Math.round((instants.e.getTime() - instants.s.getTime()) / 60_000)) : 60;
    const depuis = instants.s && instants.s.getTime() > Date.now() ? jourDe(instants.s) : jourDe(new Date());
    const cal = me.calendars.find((c) => c.id === calendrier);
    try {
      const r = await apiSend<{ slots: Creneau[]; unknown: number[] }>("POST", "/agenda/find-slots", {
        organizer_id: cal?.kind === "personal" ? cal.owner?.id : me.user.id,
        user_ids: invites.filter((i) => i.user_id && i.required).map((i) => i.user_id),
        optional_user_ids: invites.filter((i) => i.user_id && !i.required).map((i) => i.user_id),
        resource_ids: choixRessources, duration: Math.min(duree, 24 * 60), start: `${depuis}T00:00:00Z`, end: `${decalerJours(depuis, 14)}T00:00:00Z`,
      });
      setCreneaux(r.slots);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  function appliquer(c: Creneau) {
    setJournee(false);
    setDebut(versSaisieHeure(c.start));
    setFin(versSaisieHeure(c.stop));
    setCreneaux(null);
  }

  async function enregistrer() {
    setErreur(null);
    if (!titre.trim()) return setErreur("Donnez un titre à l'événement.");
    if (!journee && (!instants.s || !instants.e)) return setErreur("Indiquez le début et la fin.");
    const corps: Record<string, unknown> = {
      name: titre.trim(), location: lieu, video_url: visio.trim(), description, privacy: visibilite, show_as: statut,
      category_ids: categories, alarms: rappels, resource_ids: choixRessources,
      attendees: invites.map((i) => ({ user_id: i.user_id, partner_id: i.partner_id, email: i.email, name: i.name, required: i.required })),
      allday: journee,
    };
    if (journee) Object.assign(corps, { start_date: jourDebut, end_date: jourFin });
    else Object.assign(corps, { start: versApi(instants.s!), stop: versApi(instants.e!) });
    if (!detail || recurrenceTouchee) corps.recurrence = recurrence;
    setEnvoi(true);
    try {
      let r: Resultat;
      if (detail) {
        r = await apiSend<Resultat>("PATCH", `/agenda/events/${detail.id}`, { ...corps, scope: detail.recurring ? portee : "all", occurrence: detail.occurrence });
      } else {
        r = await apiSend<Resultat>("POST", "/agenda/events", { ...corps, calendar_id: calendrier, ...(fiche ? { res_model: fiche.model, res_id: fiche.id } : {}) });
      }
      const parties = [detail ? "Événement modifié." : "Événement créé."];
      if (r.conflicts.length) parties.push(r.conflicts.map((c) => c.message).join(" "));
      if (r.warnings.length) parties.push(r.warnings.map((w) => w.message).join(" "));
      if (r.mail && r.mail.sent) parties.push(`${r.mail.sent} courriel(s) d'invitation envoyé(s).`);
      else if (r.mail && !r.mail.mail_server && invites.length) parties.push("Aucun serveur de courrier : les invitations restent dans l'application.");
      onFait(r, parties.join(" "));
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  function changerRecurrence(freq: string) {
    setRecurrenceTouchee(true);
    if (!freq) return setRecurrence(null);
    const base = recurrence ?? recurrenceParDefaut(journee ? jourDebut : instants.s ? jourDe(instants.s) : jourDebut);
    setRecurrence({ ...base, freq: freq as SpecRecurrence["freq"] });
  }

  function majRecurrence(v: Partial<SpecRecurrence>) {
    setRecurrenceTouchee(true);
    setRecurrence((r) => (r ? { ...r, ...v } : r));
  }

  return (
    <Modal
      open
      wide
      title={detail ? "Modifier l'événement" : "Nouvel événement"}
      onClose={onFermer}
      footer={
        <>
          <Button onClick={onFermer}>Annuler</Button>
          <Button variant="primary" loading={envoi} onClick={() => void enregistrer()}>
            {detail ? "Enregistrer" : "Créer l'événement"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        {detail?.recurring && (
          <fieldset className="rounded-xl border border-line p-3">
            <legend className="px-1 text-[13px] font-semibold text-ink-2">Événement récurrent : appliquer à</legend>
            <div className="flex flex-wrap gap-4 text-[13.5px]">
              {([["this", "cette occurrence"], ["following", "celle-ci et les suivantes"], ["all", "toute la série"]] as const).map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-2">
                  <input type="radio" name="portee" checked={portee === k} onChange={() => setPortee(k)} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <Field label="Titre">
            <Input data-autofocus value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={200} placeholder="Comité de trésorerie" />
          </Field>
          <Field label="Agenda">
            <Select value={calendrier} disabled={Boolean(detail)} onChange={(e) => setCalendrier(Number(e.target.value))} options={ecrivables.map((c) => ({ value: c.id, label: c.mine ? c.name : `${c.name} (${c.level === "manage" ? "délégation" : "partage"})` }))} />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-[auto_1fr_1fr]">
          <label className="inline-flex items-center gap-2 self-end pb-2 text-[13.5px]">
            <input type="checkbox" checked={journee} onChange={(e) => setJournee(e.target.checked)} />
            Journée entière
          </label>
          {journee ? (
            <>
              <Field label="Premier jour">
                <Input type="date" value={jourDebut} onChange={(e) => { setJourDebut(e.target.value); if (e.target.value > jourFin) setJourFin(e.target.value); }} />
              </Field>
              <Field label="Dernier jour">
                <Input type="date" value={jourFin} min={jourDebut} onChange={(e) => setJourFin(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Début">
                <Input type="datetime-local" step={300} value={debut} onChange={(e) => {
                  const ancien = depuisSaisieHeure(debut);
                  const ancienneFin = depuisSaisieHeure(fin);
                  const nouveau = depuisSaisieHeure(e.target.value);
                  setDebut(e.target.value);
                  // La durée suit : la fin se décale avec le début.
                  if (ancien && ancienneFin && nouveau) setFin(versSaisieHeure(versApi(new Date(new Date(nouveau).getTime() + (new Date(ancienneFin).getTime() - new Date(ancien).getTime())))));
                }} />
              </Field>
              <Field label="Fin">
                <Input type="datetime-local" step={300} value={fin} onChange={(e) => setFin(e.target.value)} />
              </Field>
            </>
          )}
        </div>

        {/* Récurrence */}
        <div className="rounded-xl border border-line p-3">
          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <Field label="Répétition">
              <Select value={recurrence?.freq ?? ""} disabled={Boolean(detail?.exception) || (detail?.recurring && portee === "this")} onChange={(e) => changerRecurrence(e.target.value)} options={[
                { value: "", label: "Ne se répète pas" }, { value: "daily", label: "Chaque jour" }, { value: "weekly", label: "Chaque semaine" },
                { value: "monthly", label: "Chaque mois" }, { value: "yearly", label: "Chaque année" },
              ]} />
            </Field>
            {recurrence && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Tous les">
                  <Input type="number" min={1} max={99} value={recurrence.interval} onChange={(e) => majRecurrence({ interval: Math.max(1, Number(e.target.value) || 1) })} className="w-20" />
                </Field>
                {recurrence.freq === "weekly" && (
                  <div role="group" aria-label="Jours de la semaine" className="flex gap-1">
                    {CODES_JOURS.map((code, i) => {
                      const actif = recurrence.days.includes(code);
                      return (
                        <button key={code} type="button" aria-pressed={actif} title={JOURS[i]} onClick={() => majRecurrence({ days: actif ? recurrence.days.filter((d) => d !== code) : [...recurrence.days, code] })} className={cx("h-9 w-9 rounded-full text-[12px] font-semibold capitalize", actif ? "bg-accent text-white" : "bg-panel-2 text-ink-2 hover:bg-panel-3")}>
                          {JOURS[i]!.slice(0, 2)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {(recurrence.freq === "monthly" || recurrence.freq === "yearly") && (
                  <>
                    <Segmented label="Mode" value={recurrence.monthly} onChange={(k) => majRecurrence({ monthly: k })} options={[{ key: "date", label: "Par date" }, { key: "rank", label: "Par rang" }]} />
                    {recurrence.monthly === "date" ? (
                      <Field label="Le">
                        <Input type="number" min={1} max={31} value={recurrence.month_day ?? 1} onChange={(e) => majRecurrence({ month_day: Number(e.target.value) || 1 })} className="w-20" />
                      </Field>
                    ) : (
                      <>
                        <Field label="Rang">
                          <Select value={recurrence.rank ?? 1} onChange={(e) => majRecurrence({ rank: Number(e.target.value) })} options={RANGS} />
                        </Field>
                        <Field label="Jour">
                          <Select value={recurrence.rank_day ?? "MO"} onChange={(e) => majRecurrence({ rank_day: e.target.value })} options={CODES_JOURS.map((c, i) => ({ value: c, label: JOURS[i]! }))} />
                        </Field>
                      </>
                    )}
                  </>
                )}
                <Field label="Fin">
                  <Select value={recurrence.end} onChange={(e) => majRecurrence({ end: e.target.value as SpecRecurrence["end"] })} options={[{ value: "never", label: "Jamais" }, { value: "count", label: "Après…" }, { value: "until", label: "Le…" }]} />
                </Field>
                {recurrence.end === "count" && (
                  <Field label="Occurrences">
                    <Input type="number" min={1} max={730} value={recurrence.count ?? 10} onChange={(e) => majRecurrence({ count: Number(e.target.value) || 1 })} className="w-24" />
                  </Field>
                )}
                {recurrence.end === "until" && (
                  <Field label="Dernier jour">
                    <Input type="date" value={recurrence.until ?? ""} onChange={(e) => majRecurrence({ until: e.target.value })} />
                  </Field>
                )}
              </div>
            )}
          </div>
          {detail?.recurrence && !recurrenceTouchee && <p className="mt-2 text-[12.5px] text-muted">{detail.recurrence.label}</p>}
        </div>

        {/* Participants et ressources */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <span className="block text-[13px] font-medium text-ink-2">Participants</span>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Collègue, contact ou adresse électronique" aria-label="Inviter un participant" className="pl-9" />
              {trouves.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-[var(--ombre-flottante)]">
                  {trouves.map((t) => (
                    <li key={t.cle}>
                      <button type="button" onClick={() => { setInvites((l) => [...l, t.invite]); setQ(""); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-panel-2">
                        <span className="truncate font-medium">{t.name}</span>
                        <span className="truncate text-[11.5px] text-muted">{t.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ul className="space-y-1">
              {invites.map((i) => {
                const d = i.user_id ? dispos.get(i.user_id) : undefined;
                const e = d ? (d.visible ? etat(d.busy) : { texte: "Disponibilités non communiquées", ton: "text-muted" }) : null;
                return (
                  <li key={i.cle} className="flex items-center gap-2 rounded-lg bg-panel-2 px-2.5 py-1.5 text-[13px]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{i.name}</span>
                      {e && <span className={cx("block text-[11.5px]", e.ton)}>{e.texte}</span>}
                      {d?.ooo && <span className="block text-[11.5px] text-warn">Absent du bureau{d.ooo.message ? ` : ${d.ooo.message}` : ""}</span>}
                      {!i.user_id && <span className="block text-[11.5px] text-muted">Invitation par courriel</span>}
                    </span>
                    <label className="inline-flex items-center gap-1 text-[12px] text-ink-2">
                      <input type="checkbox" checked={i.required} onChange={(ev) => setInvites((l) => l.map((x) => (x.cle === i.cle ? { ...x, required: ev.target.checked } : x)))} />
                      Obligatoire
                    </label>
                    <button type="button" aria-label={`Retirer ${i.name}`} onClick={() => setInvites((l) => l.filter((x) => x.cle !== i.cle))} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-panel-3 hover:text-ink">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="space-y-2">
            <span className="block text-[13px] font-medium text-ink-2">Ressources</span>
            {ressources.length === 0 && <p className="text-[12.5px] text-muted">Aucune salle, aucun véhicule ni équipement n&apos;est encore déclaré.</p>}
            <ul className="space-y-1">
              {ressources.map((r) => {
                const choisie = choixRessources.includes(r.id);
                const e = choisie && occupationsRessources.has(r.id) ? etat(occupationsRessources.get(r.id)!) : null;
                return (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-panel-2">
                      <input type="checkbox" checked={choisie} onChange={(ev) => setChoixRessources((l) => (ev.target.checked ? [...l, r.id] : l.filter((x) => x !== r.id)))} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{r.name}</span>
                        <span className="block text-[11.5px] text-muted">
                          {r.resource_label}
                          {r.capacity ? `, ${r.capacity} places` : ""}
                          {r.location ? `, ${r.location}` : ""}
                        </span>
                      </span>
                      {e && <span className={cx("text-[11.5px]", e.ton)}>{e.texte === "Libre" ? "Libre" : "Déjà réservée"}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
            <Button size="sm" onClick={() => void trouver()}>
              <Search className="h-3.5 w-3.5" /> Trouver un créneau
            </Button>
            {creneaux && (
              <div className="rounded-xl border border-line p-2">
                {creneaux.length === 0 && <p className="px-1 text-[12.5px] text-muted">Aucun créneau commun sur les quatorze jours qui viennent, dans les heures de travail de chacun.</p>}
                <ul className="space-y-1">
                  {creneaux.map((c) => (
                    <li key={c.start}>
                      <button type="button" onClick={() => appliquer(c)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-accent-doux">
                        <span className="font-medium capitalize">{jourLong(jourDe(lireInstant(c.start)))}, {heure(c.start)} - {heure(c.stop)}</span>
                        <span className={c.missing.length ? "text-warn" : "text-ok-texte"}>{c.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Lieu">
            <Input value={lieu} onChange={(e) => setLieu(e.target.value)} maxLength={300} placeholder="Siège, salle du conseil" />
          </Field>
          <Field label="Lien de visioconférence" hint="Adresse en https://">
            <Input value={visio} onChange={(e) => setVisio(e.target.value)} placeholder="https://" inputMode="url" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Segmented label="Visibilité" value={visibilite} onChange={setVisibilite} options={(["public", "private", "confidential"] as const).map((k) => ({ key: k, label: LIBELLES_VISIBILITE[k] }))} />
            <p className="mt-1.5 text-[12px] text-muted">{AIDE_VISIBILITE[visibilite]}</p>
          </div>
          <Field label="Afficher comme">
            <Select value={statut} onChange={(e) => setStatut(e.target.value as Statut)} options={(Object.keys(LIBELLES_STATUT) as Statut[]).map((k) => ({ value: k, label: LIBELLES_STATUT[k] }))} />
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Catégories</span>
          <div className="flex flex-wrap gap-1.5">
            {me.categories.map((c) => {
              const actif = categories.includes(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={actif} onClick={() => setCategories((l) => (actif ? l.filter((x) => x !== c.id) : [...l, c.id]))} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]", actif ? "border-transparent bg-accent-doux font-semibold text-ink" : "border-line text-ink-2 hover:bg-panel-2")}>
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Rappels</span>
          <label className="mb-2 inline-flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={rappels === null} onChange={(e) => setRappels(e.target.checked ? null : [...me.preferences.default_alarms])} />
            Mes rappels par défaut ({me.preferences.default_alarms.map((r) => libelleRappel(r.minutes).toLowerCase()).join(", ") || "aucun"})
          </label>
          {rappels !== null && (
            <ul className="space-y-1.5">
              {rappels.map((r, n) => (
                <li key={n} className="flex flex-wrap items-center gap-2">
                  <Select value={r.minutes} onChange={(e) => setRappels((l) => l!.map((x, i) => (i === n ? { ...x, minutes: Number(e.target.value) } : x)))} options={DELAIS_RAPPEL.map((m) => ({ value: m, label: libelleRappel(m) }))} className="w-44" aria-label="Délai du rappel" />
                  <Select value={r.channel} onChange={(e) => setRappels((l) => l!.map((x, i) => (i === n ? { ...x, channel: e.target.value as Rappel["channel"] } : x)))} options={[{ value: "app", label: "Dans l'application" }, { value: "email", label: "Par courriel" }]} className="w-48" aria-label="Canal du rappel" />
                  <button type="button" aria-label="Retirer ce rappel" onClick={() => setRappels((l) => l!.filter((_, i) => i !== n))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-3 hover:text-ink">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {rappels.length < 5 && (
                <li>
                  <Button size="sm" onClick={() => setRappels((l) => [...(l ?? []), { minutes: 15, channel: "app" }])}>
                    <Plus className="h-3.5 w-3.5" /> Ajouter un rappel
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
        {fiche && <Notice tone="accent">Lié à la fiche : {FICHES[fiche.model] ?? "fiche de la plateforme"}.</Notice>}
      </div>
    </Modal>
  );
}
