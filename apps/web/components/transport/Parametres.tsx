"use client";

import { useState } from "react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Notice } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { Message, Product } from "./types";

/** Paramétrage du transport : produits transportés. */
export function Parametres() {
  return (
    <div className="space-y-6">
      <Produits />
    </div>
  );
}

/** Produits transportés : le code est la clé des saisies de Rotations, il ne change plus une fois créé. */
function Produits() {
  const { data, mutate } = useApi<Product[]>("/transport/products");
  const [f, setF] = useState({ name: "", code: "" });
  const [message, setMessage] = useState<Message>(null);
  async function send(method: "POST" | "PATCH", path: string, body: Record<string, unknown>, ok: string) {
    setMessage(null);
    try {
      await apiSend(method, path, body);
      setMessage({ tone: "ok", text: ok });
      void mutate();
      return true;
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
      return false;
    }
  }
  return (
    <Card title="Produits transportés" padded={false}>
      {message && <div className="p-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {!data ? <Loading /> : (
        <DataTable rows={data} rowKey={(p) => p.id} empty="Aucun produit." columns={[
          { key: "name", label: "Produit", render: (p) => <Input className="w-48" defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && void send("PATCH", `/transport/products/${p.id}`, { name: e.target.value.trim() }, "Produit renommé.")} /> },
          { key: "code", label: "Code", render: (p) => <span className="font-mono text-xs">{p.code}</span> },
          { key: "shared", label: "Portée", render: (p) => (p.shared ? <Badge>Commun</Badge> : <Badge tone="accent">Société</Badge>) },
          { key: "active", label: "Actif", render: (p) => <input type="checkbox" checked={p.active} onChange={(e) => void send("PATCH", `/transport/products/${p.id}`, { active: e.target.checked }, e.target.checked ? "Produit réactivé." : "Produit retiré des listes de saisie.")} /> },
        ]} />
      )}
      <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
        <Field label="Produit"><Input value={f.name} placeholder="Gasoil basse teneur en soufre" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code" hint="Minuscules, sans espace ; il ne change plus ensuite."><Input className="w-40 font-mono" value={f.code} placeholder="gasoil-bts" onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/\s/g, "") })} /></Field>
        <Button variant="primary" disabled={!f.name.trim() || !f.code} onClick={() => void send("POST", "/transport/products", { name: f.name.trim(), code: f.code }, "Produit ajouté.").then((ok) => ok && setF({ name: "", code: "" }))}>Ajouter le produit</Button>
      </div>
    </Card>
  );
}
