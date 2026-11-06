"use client";

import { useEffect, useState } from "react";
import { Copy, Mail, RotateCcw, Send, Smartphone } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Notice, Select, Textarea, classesBouton, cx } from "@/components/ui";
import { useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { decouper, numeroWhatsApp } from "@/components/axispro/dossier/Relances";
import { enregistrerRelance, useRelancesDossier } from "@/lib/axispro-api";
import type { RelanceItem, Relances } from "@/lib/axispro-types";
import { aujourdhui, fmtDate, fmtFixe, fmtInt } from "@/lib/format";
import { useDossier } from "./DossierParcours";

/** Pièces manquantes affichées : les 20 premières par priorité (EC-09). */
const TOP = 20;

/** Statut d'une pièce manquante d'un dossier de l'ancienne méthode, sans libellé du noyau. */
const ETAT_MANQUE: Record<RelanceItem["state"], string> = { missing: "Non disponible", partial: "Incomplet", to_redo: "À reprendre" };

/**
 * Étape 5, relances (EC-09) : pièces manquantes par priorité, message de relance (annexe D, préparé par le
 * noyau), historique. Ouvrir le message dans la messagerie ou WhatsApp enregistre la relance du canal,
 * comme l'onglet du cabinet ; le portail notifie le porteur s'il a un accès. Écriture : profil cabinet,
 * dossier en cours (POST /axispro/dossiers/<id>/relances) ; les autres comptes lisent.
 */
export function EtapeRelances() {
  const { d, relire } = useDossier();
  const { data, error, mutate } = useRelancesDossier(d.id);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des relances…">
      {(r: Relances) => (
        <Contenu
          r={r}
          apres={() => {
            void mutate();
            relire();
          }}
        />
      )}
    </Etat>
  );
}

function Contenu({ r, apres }: { r: Relances; apres: () => void }) {
  const { d } = useDossier();
  const { cabinet } = useCabinet();
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const [message, setMessage] = useState(r.message);
  const [propose, setPropose] = useState(r.message);
  const [copie, setCopie] = useState(false);
  const [saisie, setSaisie] = useState({ date: aujourdhui(), channel: "email", note: "" });
  // Message proposé renouvelé : la saisie suit tant qu'elle n'a pas été retouchée.
  useEffect(() => {
    if (r.message === propose) return;
    if (message === propose) setMessage(r.message);
    setPropose(r.message);
  }, [r.message, propose, message]);

  const { objet, corps } = decouper(message);
  const email = /^[^\s@?&#,;]+@[^\s@?&#,;]+$/.test(r.contact.email ?? "") ? r.contact.email : null;
  const whatsapp = numeroWhatsApp(r.contact.phone);
  const relancable = cabinet && d.state === "open";
  const jour = aujourdhui();
  const lignes = r.items.slice(0, TOP);
  const historique = [...r.history].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  async function relancer(channel: string, retour?: string, envoi = false) {
    const ok = await envoyer(
      () => enregistrerRelance(d.id, { date: saisie.date, channel, note: saisie.note, body: message, send: envoi || undefined }),
      retour ?? (channel === "portal" ? "Message envoyé au porteur sur le portail, relance enregistrée." : "Relance enregistrée."),
      channel === "portal" ? "portail" : envoi ? "courriel" : retour ? "ouverture" : "relance",
    );
    if (ok !== undefined) {
      setSaisie({ date: aujourdhui(), channel: saisie.channel, note: "" });
      apres();
    }
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(message);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    } catch {
      // Presse-papiers refusé : le texte se sélectionne pour une copie à la main.
      (document.getElementById("message-relance") as HTMLTextAreaElement | null)?.select();
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <Card title={`Pièces manquantes · ${fmtInt(r.followup.missing)}`} actions={<span className="text-[12.5px] text-muted">Top {TOP} par ordre de priorité</span>} padded={false}>
        <DataTable
          dense
          rows={lignes}
          rowKey={(g) => g.key}
          empty="Aucune pièce manquante."
          columns={[
            { key: "rang", label: "#", render: (g) => <span className="font-mono text-muted">{lignes.indexOf(g) + 1}</span> },
            {
              key: "name",
              label: "Critère",
              render: (g) => (
                <div className="min-w-[220px]">
                  <div className="font-semibold text-ink">{g.label}</div>
                  <div className="text-[12px] text-muted">
                    {g.domain}
                    {g.knockout ? <span className="font-semibold text-danger">{g.domain ? " · " : ""}knock-out{g.knockout_gate === null || g.knockout_gate === undefined ? "" : ` Gate ${g.knockout_gate}`}</span> : ""}
                  </div>
                </div>
              ),
            },
            { key: "status", label: "Statut", render: (g) => <span className="whitespace-nowrap">{g.status_label ?? ETAT_MANQUE[g.state]}</span> },
            { key: "priority", label: "Indice", align: "right", render: (g) => fmtFixe(g.priority, g.priority % 1 ? 1 : 0) },
            {
              key: "due_date",
              label: "Échéance",
              render: (g) => (g.due_date ? <span className={cx("whitespace-nowrap", (g.overdue ?? g.due_date < jour) && "font-semibold text-danger")}>{fmtDate(g.due_date)}</span> : <span className="text-muted">–</span>),
            },
          ]}
        />
      </Card>
      <div className="min-w-0 space-y-4">
        <Card title="Message de relance" actions={<Button onClick={() => void copier()}><Copy aria-hidden className="h-4 w-4" /> {copie ? "Copié" : "Copier le message"}</Button>}>
          {(r.contact.email || r.contact.phone) && <p className="mb-2 text-[13px] text-muted">Destinataire : {[r.contact.email, r.contact.phone].filter(Boolean).join(" · ")}</p>}
          <Textarea id="message-relance" rows={12} readOnly={!cabinet} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message de relance" className="font-mono text-[13px]" />
          <p className="mt-2 text-[12.5px] text-muted">Copiez le message dans votre messagerie, puis enregistrez la relance ci-dessous pour mettre à jour le suivi.</p>
          {relancable && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {email && r.email_ready && (
                <Button disabled={!message.trim() || occupe} loading={enCours === "courriel"} onClick={() => void relancer("email", `Courriel envoyé à ${email}, relance enregistrée.`, true)}>
                  <Send aria-hidden className="h-4 w-4" /> Envoyer par courriel
                </Button>
              )}
              {email && (
                <a className={classesBouton()} href={`mailto:${email}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`} onClick={() => void relancer("email", "Relance par courriel enregistrée.")}>
                  <Mail aria-hidden className="h-4 w-4" /> Ouvrir dans la messagerie
                </a>
              )}
              {whatsapp && (
                <a className={classesBouton()} href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" onClick={() => void relancer("whatsapp", "Relance WhatsApp enregistrée.")}>
                  <Smartphone aria-hidden className="h-4 w-4" /> WhatsApp
                </a>
              )}
              {r.portal && (
                <Button disabled={!message.trim() || occupe} loading={enCours === "portail"} onClick={() => void relancer("portal")}>
                  <Send aria-hidden className="h-4 w-4" /> Envoyer par le portail
                </Button>
              )}
              {message !== r.message && (
                <Button variant="ghost" onClick={() => setMessage(r.message)}><RotateCcw aria-hidden className="h-4 w-4" /> Message proposé</Button>
              )}
            </div>
          )}
        </Card>
        {bandeau}
        {relancable ? (
          <Card title="Enregistrer une relance">
            <fieldset disabled={occupe} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Date"><Input type="date" max={jour} value={saisie.date} onChange={(e) => setSaisie({ ...saisie, date: e.target.value })} /></Field>
              <Field label="Canal"><Select value={saisie.channel} onChange={(e) => setSaisie({ ...saisie, channel: e.target.value })} options={r.channels.filter((c) => c.key !== "portal").map((c) => ({ value: c.key, label: c.label }))} /></Field>
              <Field label="Note" className="sm:col-span-2"><Input value={saisie.note} placeholder="ex. Promoteur s'engage à envoyer l'EIES sous 10 jours" onChange={(e) => setSaisie({ ...saisie, note: e.target.value })} /></Field>
            </fieldset>
            <Button variant="primary" className="mt-3" disabled={!saisie.date || occupe} loading={enCours === "relance"} onClick={() => void relancer(saisie.channel)}>Enregistrer la relance</Button>
          </Card>
        ) : (
          cabinet && <Notice tone="neutral">{d.state === "closed" ? "Dossier clos : rouvrez-le pour relancer le promoteur." : "Dossier suspendu : reprenez-le pour relancer le promoteur."}</Notice>
        )}
        <Card title="Historique des relances">
          {historique.length === 0 ? (
            <p className="text-[13.5px] text-muted">Aucune relance enregistrée.</p>
          ) : (
            <ul className="divide-y divide-line">
              {historique.map((h) => (
                <li key={h.id} className="py-2 text-[13.5px] text-ink-2">
                  <span className="font-semibold text-ink">{fmtDate(h.date)}</span> · <Badge tone="neutral">{h.channel_label}</Badge>
                  {h.note ? ` · ${h.note}` : ""}
                  <span className="text-muted"> · {h.user}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
