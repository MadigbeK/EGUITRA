"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, Etat, Field, Input, Notice, Select } from "@/components/ui";
import { apiSend, useApi, useAutorise } from "@/lib/api-client";
import { fmtInt } from "@/lib/format";
import { NombreSurPlace, TexteSurPlace } from "../commun";
import type { Engin } from "./types";

interface Unite extends Engin { kind: "tractor" | "trailer"; brand: string | null; capacity_liters: number; note: string | null; active: boolean; vehicle: { id: number; name: string } | null }
interface Ensemble { id: number; name: string; tractor: Engin | null; trailer: Engin | null; fuel_consumption: number | null; active: boolean }

const SAISIE = ["admin", "finance", "exploitation"] as const;

/**
 * Tracteurs et remorques : numéro de parc et immatriculation de chaque engin, rattachement à un ensemble routier
 * (une remorque rattachée à un autre ensemble quitte le précédent), consommation de l'ensemble (budget de voyage).
 */
export function Engins() {
  const { data: engins, error, mutate } = useApi<Unite[]>("/transport/units");
  const { data: ensembles, mutate: majEnsembles } = useApi<Ensemble[]>("/transport/vehicles");
  const saisie = useAutorise([...SAISIE]);
  const [f, setF] = useState<Record<string, string>>({ kind: "trailer" });
  const [erreur, setErreur] = useState<string | null>(null);
  async function envoyer(methode: "POST" | "PATCH", chemin: string, corps: unknown) {
    setErreur(null);
    try {
      await apiSend(methode, chemin, corps);
      void mutate();
      void majEnsembles();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }
  const tracteurs = (engins ?? []).filter((e) => e.kind === "tractor" && e.active);
  const remorques = (engins ?? []).filter((e) => e.kind === "trailer" && e.active);
  return (
    <div className="space-y-4">
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      <Card title="Ensembles : tracteur, remorque et consommation" padded={false}>
        {!ensembles ? <Etat /> : (
          <DataTable
            rows={ensembles.filter((v) => v.active)}
            rowKey={(v) => v.id}
            empty="Aucun ensemble."
            columns={[
              { key: "name", label: "Ensemble", render: (v) => v.name },
              { key: "tractor", label: "Tracteur", render: (v) => (
                <Select aria-label={`Tracteur de ${v.name}`} disabled={!saisie} value={v.tractor?.id ?? ""} placeholder="–" onChange={(e) => void envoyer("PATCH", `/transport/vehicles/${v.id}`, { tractor_id: e.target.value ? Number(e.target.value) : null })} options={tracteurs.map((t) => ({ value: t.id, label: t.name }))} />
              ) },
              { key: "trailer", label: "Remorque", render: (v) => (
                <Select aria-label={`Remorque de ${v.name}`} disabled={!saisie} value={v.trailer?.id ?? ""} placeholder="–" onChange={(e) => void envoyer("PATCH", `/transport/vehicles/${v.id}`, { trailer_id: e.target.value ? Number(e.target.value) : null })} options={remorques.map((t) => ({ value: t.id, label: `${t.name}${t.vehicle && t.vehicle.id !== v.id ? ` (sur ${t.vehicle.name})` : ""}` }))} />
              ) },
              { key: "conso", label: "Consommation (L/100 km)", align: "right", render: (v) => <NombreSurPlace label={`Consommation de ${v.name}`} disabled={!saisie} value={v.fuel_consumption} nullable onCommit={(n) => void envoyer("PATCH", `/transport/vehicles/${v.id}`, { fuel_consumption: n ?? 0 })} /> },
            ]}
          />
        )}
      </Card>
      <Card title="Tracteurs et remorques" padded={false}>
        {!engins ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable
            rows={engins}
            rowKey={(u) => u.id}
            empty="Aucun engin."
            columns={[
              { key: "kind", label: "Engin", render: (u) => (u.kind === "tractor" ? "Tracteur" : "Remorque") },
              { key: "fleet", label: "N° de parc", render: (u) => <TexteSurPlace label={`N° de parc de ${u.fleet_number}`} disabled={!saisie} value={u.fleet_number} onCommit={(t) => void envoyer("PATCH", `/transport/units/${u.id}`, { fleet_number: t })} /> },
              { key: "plate", label: "Immatriculation", render: (u) => <TexteSurPlace label={`Immatriculation de ${u.fleet_number}`} disabled={!saisie} value={u.plate ?? ""} onCommit={(t) => void envoyer("PATCH", `/transport/units/${u.id}`, { plate: t })} /> },
              { key: "capacity", label: "Capacité (L)", align: "right", render: (u) => (u.kind === "trailer" ? <NombreSurPlace label={`Capacité de ${u.fleet_number}`} disabled={!saisie} value={u.capacity_liters || null} nullable onCommit={(n) => void envoyer("PATCH", `/transport/units/${u.id}`, { capacity_liters: n ?? 0 })} /> : "–") },
              { key: "vehicle", label: "Ensemble", render: (u) => u.vehicle?.name ?? <span className="text-muted">libre</span> },
              { key: "active", label: "En service", render: (u) => <input type="checkbox" aria-label={`En service, ${u.fleet_number}`} disabled={!saisie} checked={u.active} onChange={(e) => void envoyer("PATCH", `/transport/units/${u.id}`, { active: e.target.checked })} /> },
            ]}
          />
        )}
        {saisie && (
          <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-5">
            <Field label="Engin"><Select value={f.kind ?? "trailer"} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: "tractor", label: "Tracteur" }, { value: "trailer", label: "Remorque" }]} /></Field>
            <Field label="N° de parc"><Input value={f.fleet_number ?? ""} onChange={(e) => setF({ ...f, fleet_number: e.target.value })} /></Field>
            <Field label="Immatriculation"><Input value={f.plate ?? ""} onChange={(e) => setF({ ...f, plate: e.target.value })} /></Field>
            <Field label="Capacité (L)"><Input inputMode="numeric" value={f.capacity_liters ?? ""} onChange={(e) => setF({ ...f, capacity_liters: e.target.value })} /></Field>
            <div className="flex items-end"><Button size="sm" disabled={!f.fleet_number?.trim()} onClick={() => void envoyer("POST", "/transport/units", { ...f, capacity_liters: Number(f.capacity_liters) || 0 }).then(() => setF({ kind: f.kind ?? "trailer" }))}><Plus className="h-4 w-4" /> Ajouter</Button></div>
          </div>
        )}
        <p className="p-3 text-[12.5px] text-muted">Total : {fmtInt(tracteurs.length)} tracteur(s), {fmtInt(remorques.length)} remorque(s) en service.</p>
      </Card>
    </div>
  );
}
