"use client";

import { useState } from "react";
import { AvatarCompte } from "@/components/AvatarCompte";
import { Copy, Plus, Trash2 } from "@/components/icons";
import { Button, Card, ErrorBox, Field, FileButton, Input, Loading, Notice, Select, Textarea, cx } from "@/components/ui";
import { apiSend, apiUpload, messageErreur, useApi } from "@/lib/api-client";
import { DELAIS_RAPPEL, JOURS, libelleRappel, type Abonnement, type AgendaMe, type Delegation, type Personne, type Rappel, type TypeRendezVous } from "@/lib/agenda";
import { depuisSaisieHeure, fmtDateTime, versSaisieHeure } from "@/lib/format";

const COULEURS = ["#4340b8", "#0a6e86", "#12956a", "#2d82dc", "#c4417a", "#d9831f", "#7a5af8", "#b8872e", "#e25f35", "#4b5563"];
const FUSEAUX = ["Africa/Conakry", "Africa/Dakar", "Africa/Abidjan", "Africa/Bamako", "Africa/Lagos", "Europe/Paris", "Europe/London", "America/New_York", "Asia/Dubai", "Asia/Shanghai", "UTC"];
const NIVEAUX = [{ value: "freebusy", label: "Disponibilités seulement" }, { value: "read", label: "Lecture des détails" }, { value: "write", label: "Modification" }];

type Retour = { ton: "ok" | "danger"; texte: string } | null;

function useAction(apres: () => void) {
  const [retour, setRetour] = useState<Retour>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  async function agir(cle: string, fn: () => Promise<unknown>, ok: string) {
    setOccupe(cle);
    setRetour(null);
    try {
      await fn();
      setRetour({ ton: "ok", texte: ok });
      apres();
    } catch (e) {
      setRetour({ ton: "danger", texte: messageErreur(e) });
    } finally {
      setOccupe(null);
    }
  }
  return { retour, occupe, agir };
}

/** Recherche d'un collègue qui a un agenda (partage, délégation). */
function ChoixCollegue({ onChoix, libelle }: { onChoix: (p: Personne) => void; libelle: string }) {
  const [q, setQ] = useState("");
  const { data } = useApi<Personne[]>(q.trim().length >= 2 ? `/agenda/users?q=${encodeURIComponent(q.trim())}&limit=8` : null);
  return (
    <div className="relative w-full max-w-xs">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={libelle} aria-label={libelle} />
      {data && data.length > 0 && q.trim().length >= 2 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-line bg-panel p-1 shadow-[var(--ombre-flottante)]">
          {data.map((u) => (
            <li key={u.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-panel-2" onClick={() => { onChoix(u); setQ(""); }}>
                <AvatarCompte id={u.id} nom={u.name} avatar={u.avatar} className="bg-accent grid h-6 w-6 flex-none place-items-center rounded-full font-display text-[9px] font-bold tracking-[0.04em] text-white" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Réglages de l'agenda : heures de travail et fuseau, rappels par défaut, temps tampon, récapitulatif du
 * matin, disponibilités visibles, absence du bureau, agendas d'équipe et partages, délégations (et, pour la
 * direction et l'administration, celles des dirigeants), lien d'abonnement, import d'un fichier .ics,
 * rendez-vous en ligne et journal de l'agenda.
 */
export function Reglages() {
  const { data: me, error, mutate } = useApi<AgendaMe>("/agenda/me");
  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!me) return <Loading label="Chargement des réglages…" />;
  return <ReglagesPrets me={me} relire={() => void mutate()} />;
}

function ReglagesPrets({ me, relire }: { me: AgendaMe; relire: () => void }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Preferences me={me} relire={relire} />
      <Absence me={me} relire={relire} />
      <MesAgendas me={me} relire={relire} />
      <Delegations me={me} relire={relire} />
      <LienAbonnement me={me} relire={relire} />
      <ImportIcs me={me} />
      <RendezVous me={me} />
      <Journal />
    </div>
  );
}

function Preferences({ me, relire }: { me: AgendaMe; relire: () => void }) {
  const p = me.preferences;
  const [heures, setHeures] = useState<Record<string, [string, string][]>>(p.work_hours);
  const [tz, setTz] = useState(p.tz);
  const [tampon, setTampon] = useState(p.buffer_minutes);
  const [rappels, setRappels] = useState<Rappel[]>(p.default_alarms);
  const [visible, setVisible] = useState(p.freebusy_visible);
  const [recap, setRecap] = useState(p.digest);
  const [heureRecap, setHeureRecap] = useState(p.digest_hour);
  const { retour, occupe, agir } = useAction(relire);
  const majJour = (d: number, i: number, k: 0 | 1, v: string) => setHeures((h) => ({ ...h, [String(d)]: (h[String(d)] ?? []).map((r, n) => (n === i ? (k === 0 ? [v, r[1]] : [r[0], v]) : r)) as [string, string][] }));
  return (
    <Card title="Heures de travail et rappels">
      <div className="space-y-4 text-[13.5px]">
        {retour && <Notice tone={retour.ton}>{retour.texte}</Notice>}
        <ul className="space-y-1.5">
          {JOURS.map((nom, d) => {
            const plages = heures[String(d)] ?? [];
            return (
              <li key={nom} className="flex flex-wrap items-center gap-2">
                <label className="inline-flex w-28 items-center gap-2 capitalize">
                  <input type="checkbox" checked={plages.length > 0} onChange={(e) => setHeures((h) => ({ ...h, [String(d)]: e.target.checked ? [["08:00", "17:00"]] : [] }))} />
                  {nom}
                </label>
                {plages.map((r, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <Input type="time" value={r[0]} onChange={(e) => majJour(d, i, 0, e.target.value)} aria-label={`${nom}, début de la plage ${i + 1}`} className="w-28" />
                    à
                    <Input type="time" value={r[1]} onChange={(e) => majJour(d, i, 1, e.target.value)} aria-label={`${nom}, fin de la plage ${i + 1}`} className="w-28" />
                  </span>
                ))}
                {plages.length === 1 && <button type="button" className="text-[12px] font-semibold text-accent hover:underline" onClick={() => setHeures((h) => ({ ...h, [String(d)]: [["08:00", "12:00"], ["13:00", "17:00"]] }))}>Avec une pause</button>}
                {plages.length === 2 && <button type="button" className="text-[12px] font-semibold text-accent hover:underline" onClick={() => setHeures((h) => ({ ...h, [String(d)]: [[plages[0]![0], plages[1]![1]]] }))}>Sans pause</button>}
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fuseau horaire">
            <Select value={tz} onChange={(e) => setTz(e.target.value)} options={(FUSEAUX.includes(tz) ? FUSEAUX : [tz, ...FUSEAUX]).map((z) => ({ value: z, label: z === "Africa/Conakry" ? "Conakry (UTC+0)" : z }))} />
          </Field>
          <Field label="Temps tampon (minutes)" hint="Gardé autour des réunions proposées par « Trouver un créneau ».">
            <Input type="number" min={0} max={120} step={5} value={tampon} onChange={(e) => setTampon(Number(e.target.value) || 0)} />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Rappels par défaut</span>
          <ul className="space-y-1.5">
            {rappels.map((r, n) => (
              <li key={n} className="flex flex-wrap items-center gap-2">
                <Select value={r.minutes} onChange={(e) => setRappels((l) => l.map((x, i) => (i === n ? { ...x, minutes: Number(e.target.value) } : x)))} options={DELAIS_RAPPEL.map((m) => ({ value: m, label: libelleRappel(m) }))} className="w-44" aria-label="Délai" />
                <Select value={r.channel} onChange={(e) => setRappels((l) => l.map((x, i) => (i === n ? { ...x, channel: e.target.value as Rappel["channel"] } : x)))} options={[{ value: "app", label: "Dans l'application" }, { value: "email", label: "Par courriel" }]} className="w-48" aria-label="Canal" />
                <button type="button" aria-label="Retirer ce rappel" onClick={() => setRappels((l) => l.filter((_, i) => i !== n))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-3"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          {rappels.length < 5 && <Button size="sm" className="mt-1.5" onClick={() => setRappels((l) => [...l, { minutes: 15, channel: "app" }])}><Plus className="h-3.5 w-3.5" /> Ajouter un rappel</Button>}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Mes disponibilités (« Occupé », sans détail) sont visibles de mes collègues</label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={recap} onChange={(e) => setRecap(e.target.checked)} /> Récapitulatif de ma journée chaque matin, à</label>
          <Select value={heureRecap} onChange={(e) => setHeureRecap(Number(e.target.value))} options={[5, 6, 7, 8, 9, 10].map((h) => ({ value: h, label: `${h} h 00` }))} className="w-28" aria-label="Heure du récapitulatif" />
        </div>
        <Button variant="primary" loading={occupe === "prefs"} onClick={() => void agir("prefs", () => apiSend("PATCH", "/agenda/preferences", { work_hours: heures, tz, buffer_minutes: tampon, default_alarms: rappels, freebusy_visible: visible, digest: recap, digest_hour: heureRecap }), "Réglages enregistrés.")}>Enregistrer</Button>
      </div>
    </Card>
  );
}

function Absence({ me, relire }: { me: AgendaMe; relire: () => void }) {
  const o = me.preferences.ooo;
  const [actif, setActif] = useState(o.active);
  const [debut, setDebut] = useState(o.start ? versSaisieHeure(o.start) : "");
  const [fin, setFin] = useState(o.stop ? versSaisieHeure(o.stop) : "");
  const [message, setMessage] = useState(o.message ?? "");
  const [refus, setRefus] = useState(o.auto_decline);
  const { retour, occupe, agir } = useAction(relire);
  return (
    <Card title="Absence du bureau">
      <div className="space-y-3 text-[13.5px]">
        {retour && <Notice tone={retour.ton}>{retour.texte}</Notice>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} /> Je suis absent du bureau</label>
        {actif && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Du"><Input type="datetime-local" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
              <Field label="Jusqu'au"><Input type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
            </div>
            <Field label="Message aux invitants"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder="En mission à Boké, de retour lundi." /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" checked={refus} onChange={(e) => setRefus(e.target.checked)} /> Refuser d&apos;office les invitations qui tombent pendant l&apos;absence</label>
          </>
        )}
        <Button variant="primary" loading={occupe === "ooo"} onClick={() => void agir("ooo", () => apiSend("PATCH", "/agenda/preferences", { ooo: actif ? { active: true, start: depuisSaisieHeure(debut), stop: depuisSaisieHeure(fin), message, auto_decline: refus } : { active: false } }), actif ? "Absence enregistrée : vos invitants en sont prévenus." : "Absence levée.")}>Enregistrer</Button>
      </div>
    </Card>
  );
}

function MesAgendas({ me, relire }: { me: AgendaMe; relire: () => void }) {
  const miens = me.calendars.filter((c) => c.mine && c.kind !== "resource");
  const [nom, setNom] = useState("");
  const { retour, occupe, agir } = useAction(relire);
  return (
    <Card title="Mes agendas et leurs partages">
      <div className="space-y-4 text-[13.5px]">
        {retour && <Notice tone={retour.ton}>{retour.texte}</Notice>}
        {miens.map((c) => (
          <div key={c.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 font-semibold">{c.kind === "personal" ? "Mon agenda" : c.name}</span>
              <div role="group" aria-label="Couleur" className="flex gap-1">
                {COULEURS.map((k) => (
                  <button key={k} type="button" aria-label={`Couleur ${k}`} aria-pressed={c.color === k} onClick={() => void agir(`c${c.id}`, () => apiSend("PATCH", `/agenda/calendars/${c.id}`, { color: k }), "Couleur changée.")} className={cx("h-5 w-5 rounded-full", c.color === k && "ring-2 ring-ink ring-offset-1")} style={{ background: k }} />
                ))}
              </div>
              {c.kind === "team" && (
                <Button size="sm" variant="ghost" onClick={() => void agir(`d${c.id}`, () => apiSend("DELETE", `/agenda/calendars/${c.id}`), "Agenda supprimé.")} aria-label={`Supprimer l'agenda ${c.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              )}
            </div>
            <ul className="mt-2 space-y-1">
              {c.shares?.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <AvatarCompte id={s.user.id} nom={s.user.name} avatar={s.user.avatar} className="bg-accent grid h-7 w-7 flex-none place-items-center rounded-full font-display text-[10px] font-bold tracking-[0.04em] text-white" />
                  <span className="min-w-0 flex-1">{s.user.name}</span>
                  <Select value={s.level} onChange={(e) => void agir(`s${s.id}`, () => apiSend("PATCH", `/agenda/shares/${s.id}`, { level: e.target.value }), "Partage modifié.")} options={NIVEAUX} className="w-56" aria-label={`Niveau du partage avec ${s.user.name}`} />
                  <button type="button" aria-label={`Retirer le partage avec ${s.user.name}`} onClick={() => void agir(`r${s.id}`, () => apiSend("DELETE", `/agenda/shares/${s.id}`), "Partage retiré.")} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-3"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <ChoixCollegue libelle="Partager avec…" onChoix={(u) => void agir(`p${c.id}`, () => apiSend("POST", `/agenda/calendars/${c.id}/shares`, { user_id: u.id, level: "freebusy" }), `Agenda partagé avec ${u.name} (disponibilités) : changez le niveau au besoin.`)} />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Nouvel agenda d'équipe ou de projet" className="min-w-56 flex-1"><Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Clôture annuelle" maxLength={80} /></Field>
          <Button loading={occupe === "creer"} disabled={!nom.trim()} onClick={() => void agir("creer", async () => { await apiSend("POST", "/agenda/calendars", { name: nom }); setNom(""); }, "Agenda créé.")}><Plus className="h-4 w-4" /> Créer</Button>
        </div>
      </div>
    </Card>
  );
}

function LigneDelegation({ d, agir, de }: { d: Delegation; agir: (cle: string, fn: () => Promise<unknown>, ok: string) => Promise<void>; de: "owner" | "delegate" }) {
  const personne = de === "owner" ? d.delegate : d.owner;
  return (
    <li className="rounded-xl bg-panel-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <AvatarCompte id={personne.id} nom={personne.name} avatar={personne.avatar} className="bg-accent grid h-7 w-7 flex-none place-items-center rounded-full font-display text-[10px] font-bold tracking-[0.04em] text-white" />
        <span className="min-w-0 flex-1 font-medium">{de === "owner" ? d.delegate.name : `Agenda de ${d.owner.name}`}</span>
        <Button size="sm" variant="ghost" onClick={() => void agir(`x${d.id}`, () => apiSend("DELETE", `/agenda/delegations/${d.id}`), de === "owner" ? "Délégation retirée." : "Vous avez renoncé à cette délégation.")}>{de === "owner" ? "Retirer" : "Y renoncer"}</Button>
      </div>
      {de === "owner" ? (
        <div className="mt-1 flex flex-wrap gap-4 text-[12.5px]">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={d.receive_invitations} onChange={(e) => void agir(`i${d.id}`, () => apiSend("PATCH", `/agenda/delegations/${d.id}`, { receive_invitations: e.target.checked }), "Option enregistrée.")} /> Reçoit aussi les invitations</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={d.see_private} onChange={(e) => void agir(`v${d.id}`, () => apiSend("PATCH", `/agenda/delegations/${d.id}`, { see_private: e.target.checked }), "Option enregistrée.")} /> Voit les événements privés</label>
        </div>
      ) : (
        <p className="mt-0.5 text-[12px] text-muted">{d.receive_invitations ? "Vous recevez ses invitations" : "Vous ne recevez pas ses invitations"} ; {d.see_private ? "vous voyez ses événements privés." : "ses événements privés restent « Occupé »."}</p>
      )}
      {d.granted_by && d.granted_by.id !== d.owner.id && <p className="mt-0.5 text-[12px] text-muted">Posée par {d.granted_by.name}{d.reason ? ` : ${d.reason}` : ""}</p>}
    </li>
  );
}

function Delegations({ me, relire }: { me: AgendaMe; relire: () => void }) {
  const dirigeants = useApi<Array<{ id: number; name: string; delegations: Delegation[] }>>(me.rights.pose_delegation ? "/agenda/admin/executives" : null);
  const [pour, setPour] = useState<number | "">("");
  const [motif, setMotif] = useState("Assistante de direction");
  const { retour, agir } = useAction(() => {
    relire();
    void dirigeants.mutate();
  });
  return (
    <Card title="Délégations">
      <div className="space-y-4 text-[13.5px]">
        {retour && <Notice tone={retour.ton}>{retour.texte}</Notice>}
        <p className="text-[12.5px] text-muted">Un délégué (votre assistante, par exemple) crée, modifie et supprime vos événements et répond à vos invitations en votre nom ; chaque action porte « par … pour le compte de … » et entre au journal de l&apos;agenda.</p>
        <ul className="space-y-1.5">{me.delegations_given.map((d) => <LigneDelegation key={d.id} d={d} agir={agir} de="owner" />)}</ul>
        <ChoixCollegue libelle="Confier mon agenda à…" onChoix={(u) => void agir("donner", () => apiSend("POST", "/agenda/delegations", { delegate_id: u.id, receive_invitations: true, see_private: false }), `${u.name} gère désormais votre agenda.`)} />
        {me.delegations_received.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink-2">Agendas que je gère</h3>
            <ul className="space-y-1.5">{me.delegations_received.map((d) => <LigneDelegation key={d.id} d={d} agir={agir} de="delegate" />)}</ul>
          </div>
        )}
        {me.rights.pose_delegation && dirigeants.data && (
          <div className="rounded-xl border border-line p-3">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink-2">Délégations des dirigeants (direction et administration)</h3>
            <ul className="mb-2 space-y-1 text-[12.5px]">
              {dirigeants.data.map((x) => (
                <li key={x.id}>
                  <span className="font-medium">{x.name}</span> : {x.delegations.length ? x.delegations.map((d) => d.delegate.name).join(", ") : "aucune délégation"}
                  {x.delegations.map((d) => (
                    <button key={d.id} type="button" className="ml-2 font-semibold text-danger hover:underline" onClick={() => void agir(`y${d.id}`, () => apiSend("DELETE", `/agenda/delegations/${d.id}`), "Délégation retirée.")}>retirer {d.delegate.name}</button>
                  ))}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Dirigeant"><Select value={pour} onChange={(e) => setPour(Number(e.target.value) || "")} placeholder="Choisir" options={dirigeants.data.filter((x) => x.id !== me.user.id).map((x) => ({ value: x.id, label: x.name }))} /></Field>
              <Field label="Motif"><Input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={200} /></Field>
              {pour !== "" && <ChoixCollegue libelle="Délégué…" onChoix={(u) => void agir("poser", () => apiSend("POST", "/agenda/delegations", { owner_id: pour, delegate_id: u.id, reason: motif, receive_invitations: true }), `Délégation posée : ${u.name} gère l'agenda. Le dirigeant en est prévenu ; elle est inscrite dans la piste d'audit.`)} />}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function LienAbonnement({ me, relire }: { me: AgendaMe; relire: () => void }) {
  const [nouveau, setNouveau] = useState<string | null>(null);
  const [masque, setMasque] = useState(me.subscription.mask_private ?? true);
  const { retour, occupe, agir } = useAction(relire);
  const s = me.subscription;
  return (
    <Card title="Lien d'abonnement (Outlook, Google Agenda)">
      <div className="space-y-3 text-[13.5px]">
        {retour && <Notice tone={retour.ton}>{retour.texte}</Notice>}
        <p className="text-[12.5px] text-muted">Un lien secret, en lecture seule, de votre agenda personnel : ajoutez-le dans Outlook (« Ajouter un calendrier depuis Internet ») ou Google Agenda (« À partir de l&apos;URL »). Ni participants ni organisateur n&apos;y figurent. Gardez-le pour vous ; un nouveau lien remplace l&apos;ancien.</p>
        {s.active && !nouveau && <p>Lien actif, se terminant par « {s.hint} », créé le {fmtDateTime(s.created)}{s.last_used ? `, lu le ${fmtDateTime(s.last_used)}` : ""}.</p>}
        {nouveau && (
          <div className="flex items-center gap-2">
            <Input readOnly value={nouveau} aria-label="Lien d'abonnement" onFocus={(e) => e.target.select()} />
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(nouveau)} aria-label="Copier le lien"><Copy className="h-4 w-4" /></Button>
          </div>
        )}
        <label className="flex items-center gap-2"><input type="checkbox" checked={masque} onChange={(e) => setMasque(e.target.checked)} /> Événements privés en « Occupé » dans l&apos;abonnement</label>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={occupe === "creer"} onClick={() => void agir("creer", async () => { const r = await apiSend<Abonnement>("POST", "/agenda/subscription", { mask_private: masque }); setNouveau(`${window.location.origin}${r.path}`); }, "Nouveau lien créé : copiez-le maintenant, il ne sera plus affiché.")}>{s.active ? "Créer un nouveau lien" : "Créer le lien"}</Button>
          {s.active && <Button variant="danger" loading={occupe === "revoquer"} onClick={() => void agir("revoquer", async () => { await apiSend("DELETE", "/agenda/subscription"); setNouveau(null); }, "Lien révoqué : il ne sert plus.")}>Révoquer</Button>}
        </div>
      </div>
    </Card>
  );
}

function ImportIcs({ me }: { me: AgendaMe }) {
  const cibles = me.calendars.filter((c) => c.can_write && c.kind !== "resource");
  const [cal, setCal] = useState(me.personal_calendar_id);
  const [bilan, setBilan] = useState<string | null>(null);
  const { retour, occupe, agir } = useAction(() => undefined);
  return (
    <Card title="Importer un fichier .ics">
      <div className="space-y-3 text-[13.5px]">
        {retour && <Notice tone={retour.ton}>{retour.texte}</Notice>}
        {bilan && <Notice tone="accent">{bilan}</Notice>}
        <p className="text-[12.5px] text-muted">Un export d&apos;Outlook, de Google Agenda ou d&apos;un autre agenda (5 Mo, 500 événements au plus). Personne n&apos;est invité ; un événement déjà importé est mis à jour, pas recopié.</p>
        <Field label="Dans l'agenda"><Select value={cal} onChange={(e) => setCal(Number(e.target.value))} options={cibles.map((c) => ({ value: c.id, label: c.mine ? c.name : `${c.name} (${c.level_label.toLowerCase()})` }))} /></Field>
        <FileButton label={occupe ? "Import en cours…" : "Choisir le fichier"} accept=".ics,text/calendar" onFile={(f) => {
          const form = new FormData();
          form.append("calendar_id", String(cal));
          form.append("file", f);
          setBilan(null);
          void agir("import", async () => {
            const r = await apiUpload<{ created: number; updated: number; skipped: number; warnings: string[] }>("/agenda/import", form);
            setBilan(`${r.created} événement(s) créé(s), ${r.updated} mis à jour${r.skipped ? `, ${r.skipped} ignoré(s)` : ""}. ${r.warnings.join(" ")}`.trim());
          }, "Fichier importé.");
        }} />
      </div>
    </Card>
  );
}

function RendezVous({ me }: { me: AgendaMe }) {
  const { data, mutate } = useApi<{ open: boolean; types: TypeRendezVous[] }>("/agenda/booking-types");
  const [nom, setNom] = useState("");
  const [duree, setDuree] = useState(30);
  const [domaines, setDomaines] = useState("");
  const [question, setQuestion] = useState("Objet de la demande");
  const { retour, occupe, agir } = useAction(() => void mutate());
  if (!data) return null;
  return (
    <Card title="Rendez-vous en ligne">
      <div className="space-y-3 text-[13.5px]">
        {retour && <Notice tone={retour.ton}>{retour.texte}</Notice>}
        {!data.open && <Notice tone="accent">La prise de rendez-vous en ligne n&apos;est pas ouverte sur la plateforme : l&apos;administration l&apos;active (adresse publique du site et serveur de courrier). Vous pouvez préparer vos types de rendez-vous.</Notice>}
        <ul className="space-y-1.5">
          {data.types.map((t) => (
            <li key={t.id} className="rounded-xl bg-panel-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 font-medium">{t.name} · {t.duration} min</span>
                <label className="inline-flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={t.active} disabled={!data.open && !t.active} onChange={(e) => void agir(`a${t.id}`, () => apiSend("PATCH", `/agenda/booking-types/${t.id}`, { active: e.target.checked }), e.target.checked ? "Publié." : "Retiré.")} /> Publié</label>
                <button type="button" aria-label={`Supprimer ${t.name}`} onClick={() => void agir(`d${t.id}`, () => apiSend("DELETE", `/agenda/booking-types/${t.id}`), "Supprimé.")} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel-3"><Trash2 className="h-4 w-4" /></button>
              </div>
              <p className="text-[12px] text-muted">{t.allowed_domains ? `Adresses de : ${t.allowed_domains}` : "Toutes adresses (ajoutez des domaines autorisés pour limiter les demandes)"} ; délai minimal {t.min_notice_hours} h, horizon {t.max_days} jours.</p>
              {t.active && t.link && (
                <div className="mt-1 flex items-center gap-2">
                  <Input readOnly value={t.link} aria-label={`Lien public de ${t.name}`} onFocus={(e) => e.target.select()} />
                  <Button size="sm" onClick={() => void navigator.clipboard?.writeText(t.link!)} aria-label="Copier le lien"><Copy className="h-4 w-4" /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Intitulé"><Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Entretien fournisseur" maxLength={80} /></Field>
          <Field label="Durée (minutes)"><Input type="number" min={10} max={480} step={5} value={duree} onChange={(e) => setDuree(Number(e.target.value) || 30)} /></Field>
          <Field label="Domaines autorisés" hint="Séparés par des virgules, par exemple fournisseur.gn"><Input value={domaines} onChange={(e) => setDomaines(e.target.value)} /></Field>
          <Field label="Question posée"><Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} /></Field>
        </div>
        <Button loading={occupe === "creer"} disabled={!nom.trim()} onClick={() => void agir("creer", async () => { await apiSend("POST", "/agenda/booking-types", { name: nom, duration: duree, allowed_domains: domaines, questions: question ? [question] : [] }); setNom(""); }, "Type de rendez-vous créé (non publié).")}><Plus className="h-4 w-4" /> Créer</Button>
        <p className="text-[12px] text-muted">Plages proposées : vos heures de travail ({me.preferences.tz}), moins vos occupations.</p>
      </div>
    </Card>
  );
}

function Journal() {
  const { data } = useApi<Array<{ id: number; date: string; label: string; by: string | null; on_behalf: string | null; note: string | null }>>("/agenda/journal?limit=30");
  return (
    <Card title="Journal de mon agenda">
      {!data ? <Loading /> : (
        <ul className="space-y-1 text-[12.5px]">
          {data.length === 0 && <li className="text-muted">Aucune action enregistrée.</li>}
          {data.map((j) => (
            <li key={j.id} className="flex flex-wrap gap-x-2">
              <span className="tabular text-muted">{fmtDateTime(j.date)}</span>
              <span className="font-medium">{j.label}</span>
              {j.note && <span className="text-ink-2">({j.note})</span>}
              {j.by && <span className="text-muted">par {j.by}{j.on_behalf ? ` pour le compte de ${j.on_behalf}` : ""}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
