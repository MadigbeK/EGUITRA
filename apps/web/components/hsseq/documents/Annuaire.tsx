"use client";

import { useState } from "react";
import { Pencil, Plus, RotateCcw, Trash2 } from "@/components/icons";
import { Button, Card, Empty, ErrorBox, Etat, Notice, demanderConfirmation } from "@/components/ui";
import { Bascule, ChampSite, requete, useReferentiels } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtInt } from "@/lib/format";
import { ListeContacts } from "./elements";
import { FenetreContact } from "./fenetres";
import { messageDocument, useRafraichir, type VueProps } from "./libelles";
import type { ContactInput, CrisisContact } from "./types";

interface Message {
  tone: "ok" | "danger";
  text: string;
}

/** Contacts d'un groupe de l'annuaire : les contacts communs, ou ceux d'un site. */
interface Groupe {
  cle: string;
  titre: string;
  contacts: CrisisContact[];
}

/** Groupes de l'annuaire : contacts communs à tous les sites d'abord, puis chaque site ; dans l'ordre d'appel. */
function grouper(contacts: CrisisContact[]): Groupe[] {
  const groupes = new Map<string, Groupe>();
  const tries = [...contacts].sort((a, b) => Number(Boolean(a.site)) - Number(Boolean(b.site)) || (a.site?.name ?? "").localeCompare(b.site?.name ?? "", "fr") || a.call_order - b.call_order || a.id - b.id);
  for (const c of tries) {
    const cle = c.site ? `s${c.site.id}` : "commun";
    if (!groupes.has(cle)) groupes.set(cle, { cle, titre: c.site ? c.site.name : "Tous les sites", contacts: [] });
    groupes.get(cle)!.contacts.push(c);
  }
  return [...groupes.values()];
}

/**
 * Annuaire de crise (GET /hsseq/crisis-contacts) : numéros à appeler en cas d'urgence, contacts
 * communs à tous les sites puis ceux de chaque site, dans l'ordre d'appel ; chaque numéro s'appelle
 * d'un geste au téléphone. Le chef de parc et l'auditeur n'ont que leurs sites et les contacts
 * communs. Le Responsable HSSEQ ajoute, modifie, retire et rétablit les contacts. Site et contacts
 * retirés portés par l'adresse (site, retires).
 */
export function Annuaire({ lire, ecrire, droits }: VueProps) {
  const { data: ref } = useReferentiels();
  const rafraichir = useRafraichir();
  const site = /^\d+$/.test(lire("site")) ? lire("site") : "";
  const retires = droits.ecriture && lire("retires") === "1";
  const cle = `/hsseq/crisis-contacts?${requete({ site_id: site || null, active: retires ? "all" : null })}`;
  const { data, error, mutate } = useApi<CrisisContact[]>(cle, { keepPreviousData: true });
  const [fenetre, setFenetre] = useState<{ contact: CrisisContact | null } | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [occupe, setOccupe] = useState<number | null>(null);

  async function enregistrer(contact: CrisisContact | null, corps: ContactInput) {
    const maj = await apiSend<CrisisContact>(contact ? "PATCH" : "POST", contact ? `/hsseq/crisis-contacts/${contact.id}` : "/hsseq/crisis-contacts", corps);
    await mutate();
    void rafraichir(cle);
    setMessage({ tone: "ok", text: contact ? `Contact «${INSECABLE}${maj.function}${INSECABLE}» mis à jour.` : `Contact «${INSECABLE}${maj.function}${INSECABLE}» ajouté à l'annuaire.` });
  }

  async function basculer(c: CrisisContact) {
    if (c.active) {
      const ok = await demanderConfirmation(`${c.function} (${c.name}) n'apparaît plus dans l'annuaire ni dans les plans d'intervention qui le citent. Il se rétablit depuis les contacts retirés.`, {
        titre: `Retirer ce contact de l'annuaire${INSECABLE}?`,
        action: "Retirer",
        danger: true,
      });
      if (!ok) return;
    }
    setOccupe(c.id);
    setMessage(null);
    try {
      await apiSend<CrisisContact>("PATCH", `/hsseq/crisis-contacts/${c.id}`, { active: !c.active } satisfies ContactInput);
      await mutate();
      void rafraichir(cle);
      setMessage({ tone: "ok", text: c.active ? `Contact «${INSECABLE}${c.function}${INSECABLE}» retiré.` : `Contact «${INSECABLE}${c.function}${INSECABLE}» rétabli.` });
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Opération impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  const groupes = data ? grouper(data) : [];
  const commandes = droits.ecriture
    ? (c: CrisisContact) => (
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setFenetre({ contact: c })} aria-label={`Modifier le contact ${c.function}`} title="Modifier">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" loading={occupe === c.id} onClick={() => void basculer(c)} aria-label={c.active ? `Retirer le contact ${c.function}` : `Rétablir le contact ${c.function}`} title={c.active ? "Retirer" : "Rétablir"}>
            {occupe !== c.id && (c.active ? <Trash2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />)}
          </Button>
        </span>
      )
    : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <ChampSite ref_={ref} valeur={site} onChange={(v) => ecrire({ site: v || null })} />
        {droits.ecriture && (
          <Bascule actif={retires} onChange={(v) => ecrire({ retires: v ? "1" : null })}>
            Contacts retirés
          </Bascule>
        )}
        {droits.ecriture && (
          <Button variant="primary" className="sm:ml-auto" onClick={() => setFenetre({ contact: null })}>
            <Plus className="h-4 w-4" /> Nouveau contact
          </Button>
        )}
      </div>
      <p className="m-0 max-w-[80ch] text-[12.5px] leading-snug text-muted">
        Numéros à appeler en cas d&apos;urgence, dans l&apos;ordre d&apos;appel&nbsp;; un contact sans site vaut pour tous les sites. Depuis un téléphone, un numéro s&apos;appelle d&apos;un geste. Les conducteurs retrouvent l&apos;annuaire de leur site dans NIMOVA Terrain.
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!data ? (
        <Card>
          <Etat error={error} onRetry={() => void mutate()} label="Chargement de l'annuaire…" />
        </Card>
      ) : (
        <>
          {error && <ErrorBox error={error} onRetry={() => void mutate()} />}
          {!groupes.length ? (
            <Card>
              <Empty title={site ? "Aucun contact pour ce site" : "Annuaire vide"} hint={droits.ecriture ? "Ajoutez les sapeurs-pompiers, la gendarmerie, le centre de santé, l'assureur et la direction, dans l'ordre d'appel." : "Le Responsable HSSEQ tient l'annuaire de crise."} />
            </Card>
          ) : (
            groupes.map((g) => (
              <Card key={g.cle} title={`${g.titre} (${fmtInt(g.contacts.length)})`}>
                <ListeContacts contacts={g.contacts} actions={commandes} sansSite />
              </Card>
            ))
          )}
        </>
      )}
      {fenetre && <FenetreContact contact={fenetre.contact ?? undefined} onClose={() => setFenetre(null)} envoyer={(corps) => enregistrer(fenetre.contact, corps)} />}
    </div>
  );
}
