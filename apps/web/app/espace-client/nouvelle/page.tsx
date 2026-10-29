"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, Etat, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { apiSend, messageErreur, useApi } from "@/lib/api-client";
import type { FicheClient, MoiClient } from "@/lib/service-client";

/** Nouvelle demande : la société concernée (si le compte en suit deux), la catégorie, le type, l'objet et le détail. */
export default function NouvelleDemandePage() {
  const router = useRouter();
  const { data, error, mutate } = useApi<MoiClient>("/espace-client/me");
  const [societe, setSociete] = useState("");
  const [f, setF] = useState({ category_id: "", kind: "", subject: "", description: "" });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    if (data && !societe && data.companies[0]) setSociete(String(data.companies[0].id));
  }, [data, societe]);

  async function deposer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const fiche = await apiSend<FicheClient>("POST", "/espace-client/tickets", {
        company_id: Number(societe), subject: f.subject, description: f.description,
        category_id: f.category_id ? Number(f.category_id) : null, kind: f.kind || null,
      });
      router.push(`/espace-client/demandes/${fiche.id}`);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  return (
    <div>
      <PageHeader title="Nouvelle demande" subtitle="Décrivez votre demande ou votre réclamation : elle reçoit aussitôt un numéro, et le service client vous répond ici." />
      <Etat data={data} error={error} onRetry={() => void mutate()}>
        {(moi) => {
          const choisie = moi.companies.find((c) => String(c.id) === societe) ?? moi.companies[0];
          return (
            <Card>
              <div className="grid gap-4 sm:grid-cols-2">
                {moi.companies.length > 1 && (
                  <Field label="Service concerné" className="sm:col-span-2">
                    <Select value={societe} onChange={(e) => setSociete(e.target.value)} options={moi.companies.map((c) => ({ value: c.id, label: c.name }))} />
                  </Field>
                )}
                <Field label="Catégorie">
                  <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} options={[{ value: "", label: "Je ne sais pas" }, ...(choisie?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
                </Field>
                <Field label="Type">
                  <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: "", label: "Selon la catégorie" }, ...moi.kinds.map((k) => ({ value: k.code, label: k.label }))]} />
                </Field>
                <Field label="Objet" className="sm:col-span-2">
                  <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} />
                </Field>
                <Field label="Description" className="sm:col-span-2" hint="Numéro de facture, de bon de livraison, date, quantités : tout ce qui aide à traiter votre demande. Vous pourrez joindre des pièces ensuite.">
                  <Textarea rows={7} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} />
                </Field>
              </div>
              {erreur && <p className="mt-3 text-[13px] font-semibold text-danger">{erreur}</p>}
              <div className="mt-5 flex justify-end">
                <Button variant="primary" loading={envoi} disabled={!f.subject.trim() || !f.description.trim() || !societe} onClick={deposer}>
                  Déposer la demande
                </Button>
              </div>
            </Card>
          );
        }}
      </Etat>
    </div>
  );
}
