"use client";

import { useEffect, useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Modal, Notice, PageHeader, demanderConfirmation } from "@/components/ui";
import { ApiError, apiGet, apiSend, messageErreur, useApi } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import type { CompteClient, ContexteSC } from "@/lib/service-client";

/**
 * Comptes de l'espace client de la société de travail : invitation par courriel (mot de passe à choisir par le
 * client), nouvel envoi ou réinitialisation par le courriel du compte, retrait d'un client suivi. Jamais
 * d'inscription libre.
 */
export default function ComptesClientsPage() {
  const { data, error, mutate } = useApi<CompteClient[]>("/service-client/client-accounts");
  const { data: ctx } = useApi<ContexteSC>("/service-client/context");
  const [ouvert, setOuvert] = useState(false);
  const [lien, setLien] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function renvoyer(c: CompteClient) {
    setErreur(null);
    setLien(null);
    try {
      const r = await apiSend<CompteClient>("POST", `/service-client/client-accounts/${c.id}/invite`);
      if (r.reset) setMessage(`Lien de réinitialisation envoyé à ${c.login}, par courriel seulement.`);
      else if (r.invitation_link) setLien(r.invitation_link);
      else setMessage(`Invitation envoyée à ${c.login}.`);
      void mutate();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function retirer(c: CompteClient, partenaire: { id: number; name: string }) {
    if (!(await demanderConfirmation(`${c.name} ne suivra plus les demandes de ${partenaire.name}. Sans autre client suivi, son compte est désactivé.`, { action: "Retirer", danger: true }))) return;
    try {
      await apiSend("DELETE", `/service-client/client-accounts/${c.id}/partners/${partenaire.id}`);
      void mutate();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Comptes de l'espace client"
        subtitle="Le client y dépose ses demandes, suit leur traitement, répond et note sa satisfaction ; il ne voit que les dossiers de son entreprise, jamais vos notes internes."
        actions={
          <Button variant="primary" onClick={() => setOuvert(true)}>
            <Plus className="h-4 w-4" /> Ouvrir un compte
          </Button>
        }
      />
      <div className="mb-4 space-y-2">
        {ctx && !ctx.channels.mail_server && <Notice tone="warn">Aucun serveur de courrier : l&apos;invitation d&apos;un nouveau compte vous est remise une fois, à transmettre au client par un autre canal ; la réinitialisation d&apos;un compte déjà utilisé est impossible.</Notice>}
        {ctx && !ctx.channels.public_url && <Notice tone="warn">Adresse publique de l&apos;espace client non réglée (Réglages du service client) : aucune invitation ne peut partir.</Notice>}
        {message && <Notice tone="ok">{message}</Notice>}
        {lien && (
          <Notice tone="warn">
            Lien d&apos;invitation, à transmettre au seul client (valable 72 heures, une fois) : <span className="break-all font-semibold">{lien}</span>
          </Notice>
        )}
        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </div>
      <Card padded={false}>
        <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement des comptes…">
          {(comptes) => (
            <DataTable
              rows={comptes}
              rowKey={(c) => c.id}
              empty="Aucun compte pour l'instant."
              columns={[
                { key: "name", label: "Contact", render: (c) => <span className="block"><span className="block font-medium">{c.name}</span><span className="block text-[12.5px] text-muted">{c.login}</span></span> },
                {
                  key: "partners",
                  label: "Clients suivis",
                  render: (c) => (
                    <span className="flex flex-wrap gap-1">
                      {c.partners.map((p) => (
                        <button key={p.id} type="button" title="Retirer ce client" onClick={() => void retirer(c, p)} className="rounded-md bg-panel-3 px-2 py-0.5 text-[12px] font-medium text-ink-2 hover:text-danger">
                          {p.name} ×
                        </button>
                      ))}
                    </span>
                  ),
                },
                { key: "state", label: "État", render: (c) => (!c.active ? <Badge>Désactivé</Badge> : c.last_login ? <Badge tone="ok">Actif</Badge> : <Badge tone="warn">Invité</Badge>) },
                { key: "last_login", label: "Dernière connexion", render: (c) => (c.last_login ? fmtDateTime(c.last_login) : "–") },
                {
                  key: "actions",
                  label: "",
                  render: (c) =>
                    c.active ? (
                      <Button size="sm" onClick={() => void renvoyer(c)}>
                        {c.last_login ? "Réinitialiser le mot de passe" : "Renvoyer l'invitation"}
                      </Button>
                    ) : null,
                },
              ]}
            />
          )}
        </Etat>
      </Card>
      {ouvert && (
        <NouveauCompte
          onClose={() => setOuvert(false)}
          onFait={(r) => {
            setOuvert(false);
            setLien(r.invitation_link ?? null);
            setMessage(r.invitation_sent ? `Invitation envoyée à ${r.login}.` : r.created ? null : `${r.login} suit désormais ce client.`);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function NouveauCompte({ onClose, onFait }: { onClose: () => void; onFait: (r: CompteClient) => void }) {
  const [saisie, setSaisie] = useState("");
  const [trouves, setTrouves] = useState<Array<{ id: number; name: string; email: string | null }>>([]);
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [nom, setNom] = useState("");
  const [courriel, setCourriel] = useState("");
  const [confirmer, setConfirmer] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    if (saisie.trim().length < 2) return setTrouves([]);
    const t = setTimeout(() => {
      apiGet<{ partners: Array<{ id: number; name: string; email: string | null }> }>(`/service-client/clients?q=${encodeURIComponent(saisie.trim())}`)
        .then((r) => setTrouves(r.partners))
        .catch(() => setTrouves([]));
    }, 300);
    return () => clearTimeout(t);
  }, [saisie]);

  async function ouvrir(confirm_link = false) {
    if (!client) return;
    setEnvoi(true);
    setErreur(null);
    try {
      onFait(await apiSend<CompteClient>("POST", "/service-client/client-accounts", { partner_id: client.id, name: nom, email: courriel, confirm_link }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConfirmer(messageErreur(e));
      else setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      title="Ouvrir l'espace client à un contact"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          {confirmer ? (
            <Button variant="danger" loading={envoi} onClick={() => void ouvrir(true)}>
              Confirmer le rattachement
            </Button>
          ) : (
            <Button variant="primary" loading={envoi} disabled={!client || !courriel.trim()} onClick={() => void ouvrir()}>
              Inviter
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {client ? (
          <Notice tone="ok">
            Client : <strong>{client.name}</strong>{" "}
            <button type="button" className="ml-2 font-semibold text-accent hover:underline" onClick={() => setClient(null)}>
              changer
            </button>
          </Notice>
        ) : (
          <>
            <Field label="Client (tiers de la société)">
              <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder="Nom, téléphone ou courriel" />
            </Field>
            {trouves.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span>{p.name}</span>
                <Button size="sm" onClick={() => setClient({ id: p.id, name: p.name })}>
                  Choisir
                </Button>
              </div>
            ))}
          </>
        )}
        <Field label="Nom du contact">
          <Input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Adresse électronique" hint="Elle devient l'identifiant ; l'invitation y part, avec un lien pour choisir le mot de passe.">
          <Input type="email" value={courriel} onChange={(e) => { setCourriel(e.target.value); setConfirmer(null); }} maxLength={254} />
        </Field>
        {confirmer && <Notice tone="warn">{confirmer}</Notice>}
        {erreur && <p className="text-[13px] font-semibold text-danger">{erreur}</p>}
      </div>
    </Modal>
  );
}
