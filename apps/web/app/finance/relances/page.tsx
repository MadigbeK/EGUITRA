"use client";

import { useState } from "react";
import { Mail, Printer, RefreshCw } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Kpi, Modal, Notice, PageHeader, Tabs } from "@/components/ui";
import { ECRITURE_FINANCE } from "@/components/finance/communPieces";
import { ApiError, apiDownload, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { fmtDate, fmtDateTime, fmtGNF, fmtShort, pluriel } from "@/lib/format";

interface Reminder {
  id: number;
  partner: { id: number; name: string };
  email: string | null;
  date: string;
  level: "1" | "2" | "3";
  level_label: string;
  days_overdue: number;
  amount_due: number;
  invoices: number;
  state: "to_send" | "sent" | "cancelled";
  channel: "email" | "letter" | null;
  sent_at: string | null;
  sent_by: string | null;
}
interface Letter {
  subject: string;
  object: string;
  company: string;
  partner: string;
  partner_address: string[];
  date: string;
  level_label: string;
  intro: string;
  invoices: Array<{ name: string; date: string; due: string; total: number; residual: number }>;
  amount_due: number;
  closing: string;
}

const LEVEL_TONE = { "1": "accent", "2": "warn", "3": "danger" } as const;

export default function RemindersPage() {
  const [state, setState] = useState<"to_send" | "sent">("to_send");
  const { data, error, mutate } = useApi<{ items: Reminder[]; mail_server: boolean }>(`/finance/reminders?state=${state}`);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const rows = data?.items ?? [];
  // Calcul, envoi et annulation : routes de la finance et de l'administration ; la direction consulte.
  const ecriture = useAutorise(ECRITURE_FINANCE);

  async function generate() {
    setMessage(null);
    try {
      const res = await apiSend<{ created: number }>("POST", "/finance/reminders/generate");
      setMessage({ tone: "ok", text: res.created ? `${pluriel(res.created, "relance")} à envoyer.` : "Aucune nouvelle relance : les retards sont déjà relancés à leur niveau." });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Calcul impossible." });
    }
  }

  return (
    <div>
      <PageHeader
        title="Relances clients"
        subtitle="Calculées chaque nuit selon le retard : rappel, relance ferme, mise en demeure. Les deux premiers niveaux partent seuls par courriel quand un serveur d'envoi est paramétré ; la mise en demeure attend votre décision."
        actions={ecriture && <Button onClick={generate}><RefreshCw className="h-4 w-4" /> Calculer maintenant</Button>}
      />
      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {data && !data.mail_server && <div className="mb-4"><Notice tone="warn">Aucun serveur d&apos;envoi de courriel n&apos;est paramétré : les relances s&apos;impriment et se remettent ou s&apos;envoient par courrier.</Notice></div>}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Relances affichées" value={String(rows.length)} />
        <Kpi label="Montant relancé" value={fmtShort(rows.reduce((a, r) => a + r.amount_due, 0))} tone="warn" />
        <Kpi label="Mises en demeure" value={String(rows.filter((r) => r.level === "3").length)} tone="danger" />
      </div>
      <Tabs tabs={[{ key: "to_send", label: "À envoyer" }, { key: "sent", label: "Envoyées" }]} value={state} onChange={setState} />
      <Card padded={false}>
        {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable rows={rows} rowKey={(r) => r.id} onRowClick={(r) => setSelected(r.id)} empty={state === "to_send" ? "Aucune relance en attente." : "Aucune relance envoyée."} columns={[
            { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
            { key: "partner", label: "Client", render: (r) => r.partner.name },
            { key: "level", label: "Niveau", render: (r) => <Badge tone={LEVEL_TONE[r.level]}>{r.level_label}</Badge> },
            { key: "days_overdue", label: "Retard", align: "right", render: (r) => `${r.days_overdue} j` },
            { key: "invoices", label: "Factures", align: "right" },
            { key: "amount_due", label: "Montant échu", align: "right", render: (r) => fmtGNF(r.amount_due) },
            { key: "sent", label: state === "sent" ? "Envoi" : "Courriel", render: (r) => state === "sent" ? `${r.channel === "email" ? "Courriel" : "Courrier"}, ${fmtDateTime(r.sent_at)}` : r.email ?? "–" },
          ]} />
        )}
      </Card>
      {selected !== null && <LetterModal id={selected} mailServer={!!data?.mail_server} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
    </div>
  );
}

function LetterModal({ id, mailServer, onClose, onChanged }: { id: number; mailServer: boolean; onClose: () => void; onChanged: () => void }) {
  const { data, error: erreurChargement, mutate } = useApi<Reminder & { letter: Letter }>(`/finance/reminders/${id}`);
  const [error, setError] = useState<string | null>(null);
  const ecriture = useAutorise(ECRITURE_FINANCE);
  async function act(path: string, body?: unknown) {
    setError(null);
    try {
      await apiSend("POST", path, body);
      void mutate();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action impossible.");
    }
  }
  const l = data?.letter;
  return (
    <Modal
      open
      wide
      title={data ? `${data.level_label} : ${data.partner.name}` : "Relance"}
      onClose={onClose}
      footer={data?.state === "to_send" && (
        <>
          {ecriture && <Button variant="ghost" onClick={() => act(`/finance/reminders/${id}/cancel`)}>Annuler la relance</Button>}
          <Button onClick={() => void apiDownload(`/finance/reminders/${id}/pdf`, `Relance-${data.partner.name}.pdf`)}><Printer className="h-4 w-4" /> Lettre en PDF</Button>
          {ecriture && <Button onClick={() => act(`/finance/reminders/${id}/send`, { channel: "letter" })}>Marquer remise par courrier</Button>}
          {ecriture && mailServer && data.email && <Button variant="primary" onClick={() => act(`/finance/reminders/${id}/send`, { channel: "email" })}><Mail className="h-4 w-4" /> Envoyer à {data.email}</Button>}
        </>
      )}
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {!l ? <Etat error={erreurChargement} onRetry={() => mutate()} /> : (
        <article className="space-y-4 text-sm leading-relaxed">
          <div className="flex justify-between">
            <div className="font-semibold">{l.company}</div>
            <div>Conakry, le {fmtDate(l.date)}</div>
          </div>
          <div className="text-right">
            <div className="font-medium">{l.partner}</div>
            {l.partner_address.map((ligne) => <div key={ligne}>{ligne}</div>)}
          </div>
          <div className="font-semibold">Objet : {l.object.charAt(0).toLowerCase() + l.object.slice(1)}</div>
          <p>Madame, Monsieur,</p>
          <p>{l.intro}</p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted"><th className="py-1">Facture</th><th>Date</th><th>Échéance</th><th className="text-right">Montant TTC</th><th className="text-right">Reste dû</th></tr>
            </thead>
            <tbody>
              {l.invoices.map((i) => (
                <tr key={i.name} className="border-b border-line/50"><td className="py-1">{i.name}</td><td>{fmtDate(i.date)}</td><td>{fmtDate(i.due)}</td><td className="text-right font-mono">{fmtGNF(i.total)}</td><td className="text-right font-mono">{fmtGNF(i.residual)}</td></tr>
              ))}
            </tbody>
          </table>
          <p>Total échu : <b>{fmtGNF(l.amount_due)}</b></p>
          <p>{l.closing}</p>
          <p>Veuillez agréer, Madame, Monsieur, nos salutations distinguées.</p>
          <p className="pt-6">La Direction financière</p>
        </article>
      )}
    </Modal>
  );
}
