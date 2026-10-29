"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Modal, Notice, Select, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { fmtDate, fmtGNF, fmtInt, lireNombre, nombreIllisible } from "@/lib/format";
import { ChampNombre } from "../commun";
import { texteErreur } from "./PanneauDocuments";
import { CASH, OPS, type BonCarburant } from "./types";

interface Reponse {
  items: BonCarburant[];
  stations: Array<{ station: { id: number; name: string }; count: number; amount: number; liters: number }>;
}

interface PieceStation {
  id: number;
  name: string | null;
  ref: string | null;
  state: string;
  date: string;
  amount_untaxed: number;
  reconciliation: { vouchers: number; vouchers_amount: number; invoice_amount: number; gap: number };
}

const ETATS: Record<BonCarburant["state"], string> = { issued: "Remis au chauffeur", reconciled: "Rapproché", cancelled: "Annulé" };

/**
 * Bons carburant (BCA) : émis à l'approbation du budget de voyage, remis au chauffeur pour une station, puis
 * rapprochés de la facture de la station (pièce d'achat). Reste à rapprocher par station.
 */
export function BonsCarburant() {
  const [etat, setEtat] = useState("issued");
  const [station, setStation] = useState("");
  const { data, error, mutate } = useApi<Reponse>(`/transport/fuel-vouchers?state=${etat}${station ? `&partner_id=${station}` : ""}`, { keepPreviousData: true });
  const finance = useAutorise(CASH);
  const annulation = useAutorise([...OPS, ...CASH]);
  const [rapprochement, setRapprochement] = useState<BonCarburant | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function agir(appel: () => Promise<unknown>, texte: string) {
    setMessage(null);
    try {
      await appel();
      setMessage({ tone: "ok", text: texte });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: texteErreur(e) });
    }
  }

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {data && data.stations.length > 0 && (
        <Card title="À rapprocher, par station">
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {data.stations.map((s) => (
              <li key={s.station.id}>
                <button type="button" className="w-full rounded-xl p-3 text-left ring-1 ring-line hover:ring-accent" onClick={() => { setStation(String(s.station.id)); setEtat("issued"); }}>
                  <div className="font-semibold text-ink">{s.station.name}</div>
                  <div className="text-[13px] text-muted">{s.count} bon(s), {fmtInt(s.liters)} L, <span className="font-mono">{fmtGNF(s.amount)}</span></div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex flex-wrap gap-3">
        <Field label="État"><Select value={etat} onChange={(e) => setEtat(e.target.value)} options={[{ value: "issued", label: "Remis, à rapprocher" }, { value: "reconciled", label: "Rapprochés" }, { value: "cancelled", label: "Annulés" }, { value: "issued,reconciled,cancelled", label: "Tous" }]} /></Field>
        <Field label="Station"><Select value={station} onChange={(e) => setStation(e.target.value)} placeholder="Toutes" options={(data?.stations ?? []).map((s) => ({ value: s.station.id, label: s.station.name }))} /></Field>
      </div>
      <Card padded={false}>
        {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable
            rows={data.items}
            rowKey={(v) => v.id}
            empty="Aucun bon carburant pour ce filtre."
            columns={[
              { key: "name", label: "N°", render: (v) => <span className="font-mono text-xs">{v.name}</span> },
              { key: "date", label: "Date", render: (v) => fmtDate(v.date) },
              { key: "station", label: "Station", render: (v) => v.station.name },
              { key: "op", label: "Opération", render: (v) => <Link className="inline-flex items-center gap-1 font-mono text-xs text-accent underline" href={`/transport/operations?id=${v.rotation.id}`}>{v.rotation.name}<ArrowUpRight className="h-3 w-3" /></Link> },
              { key: "driver", label: "Chauffeur", render: (v) => v.driver?.name ?? "–" },
              { key: "liters", label: "Litres", align: "right", render: (v) => fmtInt(v.quantity) },
              { key: "amount", label: "Montant du bon", align: "right", render: (v) => fmtInt(v.amount) },
              { key: "actual", label: "Facturé", align: "right", render: (v) => (v.state === "reconciled" ? fmtInt(v.actual_amount) : "–") },
              { key: "invoice", label: "Facture de la station", render: (v) => v.invoice ? `${v.invoice.name ?? "brouillon"}${v.invoice.ref ? ` (${v.invoice.ref})` : ""}` : "–" },
              { key: "state", label: "État", render: (v) => <Badge tone={tonEtat(ETATS[v.state])}>{ETATS[v.state]}</Badge> },
              { key: "actions", label: "", render: (v) => (
                <span className="flex gap-1">
                  {finance && v.state === "issued" && <Button size="sm" onClick={() => setRapprochement(v)}>Rapprocher</Button>}
                  {finance && v.state === "reconciled" && <Button size="sm" variant="ghost" onClick={() => void agir(() => apiSend("POST", `/transport/fuel-vouchers/${v.id}/unreconcile`), `Bon ${v.name} détaché de la facture.`)}>Défaire</Button>}
                  {annulation && v.state === "issued" && <Button size="sm" variant="ghost" onClick={async () => {
                    if (await demanderConfirmation(`Annuler le bon ${v.name} ? Il ne compte plus dans le carburant de l'opération.`, { action: "Annuler le bon", danger: true })) void agir(() => apiSend("POST", `/transport/fuel-vouchers/${v.id}/cancel`), `Bon ${v.name} annulé.`);
                  }}>Annuler</Button>}
                </span>
              ) },
            ]}
          />
        )}
      </Card>
      {rapprochement && <Rapprochement bon={rapprochement} onClose={() => setRapprochement(null)} onDone={(texte) => { setRapprochement(null); setMessage({ tone: "ok", text: texte }); void mutate(); }} />}
    </div>
  );
}

function Rapprochement({ bon, onClose, onDone }: { bon: BonCarburant; onClose: () => void; onDone: (texte: string) => void }) {
  const { data, error, mutate } = useApi<PieceStation[]>(`/transport/fuel-vouchers/invoices?partner_id=${bon.station.id}`);
  const [piece, setPiece] = useState("");
  const [montant, setMontant] = useState(String(bon.amount));
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  async function rapprocher() {
    setBusy(true);
    setErreur(null);
    try {
      const res = await apiSend<BonCarburant & { reconciliation: PieceStation["reconciliation"] }>("POST", `/transport/fuel-vouchers/${bon.id}/reconcile`, { invoice_id: Number(piece), actual_amount: lireNombre(montant) });
      const ecart = res.reconciliation.gap;
      onDone(`Bon ${bon.name} rapproché. Facture : ${fmtGNF(res.reconciliation.invoice_amount)} hors taxes pour ${res.reconciliation.vouchers} bon(s) de ${fmtGNF(res.reconciliation.vouchers_amount)}${ecart ? `, écart ${fmtGNF(ecart)}` : ", sans écart"}.`);
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Rapprocher le bon ${bon.name}`} onClose={() => !busy && onClose()} footer={<Button variant="primary" loading={busy} disabled={!piece || nombreIllisible(montant)} onClick={() => void rapprocher()}>Rapprocher</Button>}>
      {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
        <div className="space-y-3">
          {erreur && <Notice tone="danger">{erreur}</Notice>}
          <p className="text-[13px] text-muted">{bon.station.name} · {fmtInt(bon.quantity)} L · bon de {fmtGNF(bon.amount)}. La pièce d'achat de la station est saisie dans Finance, Achats et dépenses.</p>
          <Field label="Facture de la station"><Select value={piece} onChange={(e) => setPiece(e.target.value)} placeholder={data.length ? "Choisir…" : "Aucune pièce d'achat de cette station"} options={data.map((p) => ({ value: p.id, label: `${p.name ?? "Brouillon"}${p.ref ? ` (${p.ref})` : ""}, ${fmtDate(p.date)}, ${fmtGNF(p.amount_untaxed)} HT, ${p.reconciliation.vouchers} bon(s) déjà rapproché(s)` }))} /></Field>
          <ChampNombre label="Montant facturé pour ce bon (GNF)" value={montant} onChange={(e) => setMontant(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}
