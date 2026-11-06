"use client";

import { useEffect, useState } from "react";
import { Copy, Mail, RotateCcw, Send, Smartphone } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Notice, Select, Textarea, classesBouton } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import type { DossierDetail, Followup, FollowupState, RelanceItem, Relances as Donnees } from "@/lib/axispro-types";
import { fmtDate, fmtInt, pluriel } from "@/lib/format";
import { useCabinet, useRetour } from "./commun";

const AUJOURDHUI = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Africa/Conakry" });

/** Suivi du porteur : libellé court et ton, pour la liste des dossiers et l'onglet Relances. */
export const SUIVI: Record<FollowupState, { label: string; tone: "danger" | "warn" | "ok" | "neutral" }> = {
  overdue: { label: "Échéance dépassée", tone: "danger" },
  never: { label: "Jamais relancé", tone: "warn" },
  due: { label: "À relancer", tone: "warn" },
  recent: { label: "Relancé", tone: "neutral" },
  complete: { label: "Dossier complet", tone: "ok" },
  inactive: { label: "Sans relance", tone: "neutral" },
};

/** Phrase de suivi : ce qui est attendu, depuis quand, et la prochaine relance. */
export function texteSuivi(f: Followup): string {
  const pieces = pluriel(f.missing, "pièce attendue", "pièces attendues");
  const derniere = f.last_date ? `dernière relance le ${fmtDate(f.last_date)}` : "aucune relance enregistrée";
  switch (f.state) {
    case "overdue":
      return `${pluriel(f.overdue, "échéance dépassée", "échéances dépassées")} sur ${pieces} ; ${derniere}.`;
    case "never":
      return `${pieces}, aucune relance enregistrée.`;
    case "due":
      return `${pieces} ; ${derniere}, il y a ${f.delay_days} jours ou plus.`;
    case "recent":
      return `${pieces} ; ${derniere}, prochaine relance le ${fmtDate(f.next_date)}.`;
    case "complete":
      return "Toutes les pièces attendues jusqu'au gate suivant sont reçues.";
    default:
      return "Dossier suspendu ou clos : il ne se relance pas.";
  }
}

const ETAT_PIECE: Record<RelanceItem["state"], { label: string; tone: "danger" | "warn" | "neutral" }> = {
  missing: { label: "Manquante", tone: "danger" },
  partial: { label: "À compléter", tone: "warn" },
  to_redo: { label: "À reprendre", tone: "warn" },
};

/** Objet et corps du message préparé (première ligne « Objet : … »). */
function decouper(message: string): { objet: string; corps: string } {
  const [premiere = "", ...reste] = message.split("\n");
  if (premiere.startsWith("Objet : ")) return { objet: premiere.slice(8), corps: reste.join("\n").replace(/^\n+/, "") };
  return { objet: "Pièces attendues", corps: message };
}

/** Numéro pour WhatsApp : chiffres seuls, indicatif de la Guinée ajouté à un numéro local de neuf chiffres. */
function numeroWhatsApp(phone: string | null): string | null {
  const chiffres = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (chiffres.length === 9) return `224${chiffres}`;
  return chiffres.length >= 10 ? chiffres : null;
}

/**
 * Relances du porteur : pièces attendues jusqu'au gate suivant, du plus prioritaire au moins prioritaire,
 * message préparé (modifiable, à copier, à ouvrir dans la messagerie ou WhatsApp, ou à envoyer par le
 * portail), relance enregistrée, historique. Le message ne cite jamais l'intitulé d'un critère : le
 * cabinet voit les codes des critères à côté de chaque pièce, le porteur ne les lit pas.
 *
 * Ouvrir le message dans la messagerie ou WhatsApp enregistre aussitôt la relance (même route que
 * « Enregistrer la relance », canal correspondant) : pas de second formulaire. Le noyau n'a pas de route
 * pour retirer une relance : le retour ne propose donc pas d'« Annuler ». Un dossier clos ou suspendu ne
 * se relance pas : les commandes d'envoi disparaissent et l'écran dit pourquoi ; sans accès du porteur
 * au portail, l'envoi par le portail disparaît aussi, avec sa raison.
 */
export function Relances({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const { data, error, mutate } = useApi<Donnees>(`/axispro/dossiers/${d.id}/relances`);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des relances…">
      {(r: Donnees) => <Contenu d={d} r={r} relire={() => { void mutate(); onChanged(); }} />}
    </Etat>
  );
}

function Contenu({ d, r, relire }: { d: DossierDetail; r: Donnees; relire: () => void }) {
  const { cabinet } = useCabinet();
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const [message, setMessage] = useState(r.message);
  const [contact, setContact] = useState({ name: d.contact?.name ?? "", email: d.contact?.email ?? "", phone: d.contact?.phone ?? "" });
  const [saisie, setSaisie] = useState({ date: AUJOURDHUI(), channel: "email", note: "" });
  const [copie, setCopie] = useState(false);
  // Retour affiché près de la commande qui l'a produit : en tête pour le contact, sous le message pour une relance.
  const [ou, setOu] = useState<"haut" | "message">("haut");
  // Message proposé renouvelé (pièces reçues, contact changé) : la saisie suit tant qu'elle n'a pas été retouchée.
  const [propose, setPropose] = useState(r.message);
  useEffect(() => {
    if (r.message !== propose) {
      if (message === propose) setMessage(r.message);
      setPropose(r.message);
    }
  }, [r.message, propose, message]);

  const suivi = SUIVI[r.followup.state];
  const { objet, corps } = decouper(message);
  // Adresse simple seulement : « a@b.c?bcc=… » ajouterait un destinataire caché dans la messagerie.
  const email = /^[^\s@?&#,;]+@[^\s@?&#,;]+$/.test(r.contact.email ?? "") ? r.contact.email : null;
  const whatsapp = numeroWhatsApp(r.contact.phone);
  const contactModifie = contact.name !== (d.contact?.name ?? "") || contact.email !== (d.contact?.email ?? "") || contact.phone !== (d.contact?.phone ?? "");
  const aujourdhui = AUJOURDHUI();
  // Relance possible : profil cabinet, dossier en cours (un dossier clos est refusé par le noyau, un
  // dossier suspendu sort du suivi des relances).
  const relancable = cabinet && d.state === "open";
  const arret = d.state === "closed" ? "Dossier clos : rouvrez-le pour relancer le porteur." : d.state === "on_hold" ? "Dossier suspendu : reprenez-le pour relancer le porteur." : null;

  async function enregistrerContact() {
    setOu("haut");
    const ok = await envoyer(
      () => apiSend("PATCH", `/axispro/dossiers/${d.id}`, { contact_name: contact.name, contact_email: contact.email, contact_phone: contact.phone }),
      "Contact du promoteur enregistré.",
      "contact",
    );
    if (ok !== undefined) relire();
  }

  async function relancer(channel: string, retour?: string) {
    setOu("message");
    const ok = await envoyer(
      () => apiSend("POST", `/axispro/dossiers/${d.id}/relances`, { ...saisie, channel, body: message }),
      retour ?? (channel === "portal" ? "Message envoyé au porteur sur le portail, relance enregistrée." : "Relance enregistrée."),
      channel === "portal" ? "portail" : retour ? "ouverture" : "relance",
    );
    if (ok !== undefined) {
      setSaisie({ date: AUJOURDHUI(), channel: saisie.channel, note: "" });
      relire();
    }
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(message);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    } catch {
      setCopie(false);
    }
  }

  return (
    <div className="space-y-5">
      {ou === "haut" && bandeau}
      <Card title="Suivi du porteur">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={suivi.tone}>{suivi.label}</Badge>
          <span className="text-sm">{texteSuivi(r.followup)}</span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Un porteur est à relancer quand des pièces manquent et qu&apos;aucune relance n&apos;a été enregistrée depuis {r.followup.delay_days} jours, ou dès qu&apos;une échéance est dépassée.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card title={`Pièces attendues · ${fmtInt(r.items.length)}`} className="xl:col-span-7" padded={false}>
          <DataTable
            dense
            rows={r.items}
            rowKey={(i) => i.key}
            empty="Aucune pièce attendue jusqu'au gate suivant."
            columns={[
              { key: "rang", label: "#", render: (i) => <span className="font-mono text-muted">{r.items.indexOf(i) + 1}</span> },
              {
                key: "label",
                label: "Pièce ou document",
                render: (i) => (
                  <div>
                    <div className="font-semibold">{i.label}</div>
                    {(i.category || i.criteria.length > 0) && (
                      <div className="text-xs text-muted" title="Critères de la grille : visibles du cabinet seulement">
                        {[i.category, i.criteria.length ? `critères ${i.criteria.join(", ")}` : null].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: "state", label: "État", render: (i) => <Badge tone={ETAT_PIECE[i.state].tone}>{ETAT_PIECE[i.state].label}</Badge> },
              {
                key: "blocking",
                label: "Priorité",
                render: (i) => (i.knockout ? <Badge tone="danger">Knock-out</Badge> : i.blocking ? <Badge tone="warn">Prioritaire</Badge> : <span className="text-muted">–</span>),
              },
              {
                key: "due_date",
                label: "Échéance",
                render: (i) => (i.due_date ? <span className={i.due_date < aujourdhui ? "font-semibold text-danger" : undefined}>{fmtDate(i.due_date)}</span> : <span className="text-muted">–</span>),
              },
            ]}
          />
        </Card>

        <Card title="Contact du promoteur" className="xl:col-span-5">
          <fieldset disabled={!cabinet || occupe} className="min-w-0 space-y-3">
            <Field label="Nom du contact"><Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder={d.promoter.name} /></Field>
            <Field label="Courriel"><Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder={r.contact.email ?? undefined} /></Field>
            <Field label="Téléphone" hint="Pour WhatsApp : numéro avec l'indicatif (+224…)."><Input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder={r.contact.phone ?? undefined} /></Field>
          </fieldset>
          <p className="mt-2 text-xs text-muted">Sans saisie ici, les relances reprennent le courriel et le téléphone de la fiche du promoteur.</p>
          {cabinet && (
            <div className="mt-3 flex justify-end">
              <Button variant="primary" disabled={!contactModifie || occupe} loading={enCours === "contact"} onClick={() => void enregistrerContact()}>Enregistrer le contact</Button>
            </div>
          )}
        </Card>
      </div>

      <Card title="Message de relance">
        <Textarea rows={16} value={message} disabled={!cabinet} onChange={(e) => setMessage(e.target.value)} aria-label="Message de relance" className="font-mono text-[13px]" />
        {cabinet && arret && <div className="mt-3"><Notice tone="neutral">{arret}</Notice></div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => void copier()}><Copy className="h-4 w-4" /> {copie ? "Copié" : "Copier"}</Button>
          {/* Ouvrir le message enregistre la relance du canal (profil cabinet, dossier en cours). */}
          {email && !arret && (
            <a
              className={classesBouton()}
              href={`mailto:${email}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`}
              onClick={() => relancable && void relancer("email", "Relance par courriel enregistrée.")}
            >
              <Mail className="h-4 w-4" /> Ouvrir dans la messagerie
            </a>
          )}
          {whatsapp && !arret && (
            <a
              className={classesBouton()}
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => relancable && void relancer("whatsapp", "Relance WhatsApp enregistrée.")}
            >
              <Smartphone className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {message !== r.message && cabinet && (
            <Button variant="ghost" onClick={() => setMessage(r.message)}><RotateCcw className="h-4 w-4" /> Message proposé</Button>
          )}
          {relancable && r.portal && (
            <Button variant="primary" className="ml-auto" disabled={!message.trim() || occupe} loading={enCours === "portail"} onClick={() => void relancer("portal")}>
              <Send className="h-4 w-4" /> Envoyer par le portail
            </Button>
          )}
        </div>
        {ou === "message" && bandeau && <div className="mt-3">{bandeau}</div>}
        {cabinet && !arret && (
          <p className="mt-2 text-xs text-muted">
            {r.portal
              ? "L'envoi par le portail notifie le porteur et enregistre la relance. Ouvrir le message dans la messagerie ou WhatsApp enregistre aussi la relance ; par téléphone, réunion ou courrier, enregistrez-la ci-dessous."
              : "Envoi par le portail indisponible : le porteur n'a pas encore d'accès. Ouvrez-le dans la synthèse (« Équipe et accès du porteur au portail »). En attendant, ouvrir le message dans la messagerie ou WhatsApp enregistre la relance ; par téléphone, réunion ou courrier, enregistrez-la ci-dessous."}
          </p>
        )}
        {relancable && (
          <fieldset disabled={occupe} className="mt-4 grid min-w-0 grid-cols-1 gap-3 border-t border-line pt-4 md:grid-cols-12">
            <Field label="Date" className="md:col-span-3"><Input type="date" max={aujourdhui} value={saisie.date} onChange={(e) => setSaisie({ ...saisie, date: e.target.value })} /></Field>
            <Field label="Canal" className="md:col-span-3">
              <Select value={saisie.channel} onChange={(e) => setSaisie({ ...saisie, channel: e.target.value })} options={r.channels.filter((c) => c.key !== "portal").map((c) => ({ value: c.key, label: c.label }))} />
            </Field>
            <Field label="Note" className="md:col-span-4"><Input value={saisie.note} onChange={(e) => setSaisie({ ...saisie, note: e.target.value })} placeholder="Réponse obtenue, engagement du porteur…" /></Field>
            <div className="flex items-end md:col-span-2">
              <Button variant="primary" className="w-full" disabled={!saisie.date || occupe} loading={enCours === "relance"} onClick={() => void relancer(saisie.channel)}>Enregistrer la relance</Button>
            </div>
          </fieldset>
        )}
      </Card>

      <Card title={`Historique des relances · ${fmtInt(r.history.length)}`} padded={false}>
        <DataTable
          dense
          rows={r.history}
          rowKey={(h) => h.id}
          empty="Aucune relance enregistrée."
          columns={[
            { key: "date", label: "Date", render: (h) => fmtDate(h.date) },
            { key: "channel_label", label: "Canal" },
            { key: "user", label: "Par" },
            { key: "pieces", label: "Pièces demandées", align: "right", render: (h) => fmtInt(h.pieces) },
            {
              key: "note",
              label: "Note et message",
              render: (h) => (
                <div className="max-w-xl">
                  {h.note && <div>{h.note}</div>}
                  {h.body && (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer">Message</summary>
                      <pre className="mt-1 whitespace-pre-wrap font-sans">{h.body}</pre>
                    </details>
                  )}
                  {!h.note && !h.body && <span className="text-muted">–</span>}
                </div>
              ),
            },
          ]}
        />
      </Card>
      {!cabinet && <Notice tone="neutral">Lecture seule : seul le cabinet relance les porteurs.</Notice>}
    </div>
  );
}
