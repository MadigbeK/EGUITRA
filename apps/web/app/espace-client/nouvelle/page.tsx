"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Paperclip, X } from "@/components/icons";
import { Button, Card, Etat, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { apiSend, apiUpload, messageErreur, useApi } from "@/lib/api-client";
import { PIECES_ACCEPTEES, type FicheClient, type MoiClient } from "@/lib/service-client";

/** Pièces jointes au dépôt : cinq au plus, comme une réponse. */
const PIECES_MAX = 5;

/**
 * Nouvelle demande : la société concernée (si le compte en suit deux), la catégorie, l'objet, le détail
 * et, dès le dépôt, les pièces utiles. Le type se déduit de la catégorie (le noyau retient celui de la
 * catégorie, sinon « demande ») : il reste précisable, replié. Les pièces partent juste après la création,
 * comme une réponse avec pièces jointes (routes existantes) ; en cas d'échec, la demande est bien déposée
 * et sa page invite à les joindre à nouveau.
 */
export default function NouvelleDemandePage() {
  const router = useRouter();
  const { data, error, mutate } = useApi<MoiClient>("/espace-client/me");
  const [societe, setSociete] = useState("");
  const [f, setF] = useState({ category_id: "", kind: "", subject: "", description: "" });
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    if (data && !societe && data.companies[0]) setSociete(String(data.companies[0].id));
  }, [data, societe]);

  function ajouter(liste: FileList | null) {
    const nouveaux = Array.from(liste ?? []);
    setFichiers((avant) => [...avant, ...nouveaux.filter((n) => !avant.some((a) => a.name === n.name && a.size === n.size))].slice(0, PIECES_MAX));
  }

  async function deposer() {
    setEnvoi(true);
    setErreur(null);
    let fiche: FicheClient;
    try {
      fiche = await apiSend<FicheClient>("POST", "/espace-client/tickets", {
        company_id: Number(societe), subject: f.subject, description: f.description,
        category_id: f.category_id ? Number(f.category_id) : null, kind: f.kind || null,
      });
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
      return;
    }
    if (fichiers.length) {
      try {
        const form = new FormData();
        form.set("body", "");
        for (const fichier of fichiers) form.append("files", fichier);
        await apiUpload<FicheClient>(`/espace-client/tickets/${fiche.id}/messages`, form);
      } catch {
        // La demande est déposée : sa page dit que les pièces sont à joindre de nouveau.
        router.push(`/espace-client/demandes/${fiche.id}?pieces=echec`);
        return;
      }
    }
    router.push(`/espace-client/demandes/${fiche.id}`);
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
                <Field label="Catégorie" className="sm:col-span-2" hint="Elle oriente votre demande vers le bon service.">
                  <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} options={[{ value: "", label: "Je ne sais pas" }, ...(choisie?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
                </Field>
                <Field label="Objet" className="sm:col-span-2">
                  <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} />
                </Field>
                <Field label="Description" className="sm:col-span-2" hint="Numéro de facture, de bon de livraison, date, quantités : tout ce qui aide à traiter votre demande.">
                  <Textarea rows={7} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} />
                </Field>
                <div className="sm:col-span-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-accent focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-vif">
                    <Paperclip className="h-4 w-4" /> Joindre des pièces (facultatif) : PDF, photo, Word ou Excel, 10 Mo au plus, {PIECES_MAX} au plus
                    <input
                      type="file"
                      multiple
                      accept={PIECES_ACCEPTEES}
                      className="sr-only"
                      disabled={fichiers.length >= PIECES_MAX}
                      onChange={(e) => {
                        ajouter(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {fichiers.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {fichiers.map((fichier) => (
                        <li key={`${fichier.name}-${fichier.size}`} className="flex items-center gap-2 rounded-lg bg-panel-2 px-3 py-1.5 text-[13px]">
                          <Paperclip className="h-3.5 w-3.5 flex-none text-muted" />
                          <span className="min-w-0 flex-1 truncate">{fichier.name}</span>
                          <button type="button" aria-label={`Retirer ${fichier.name}`} className="text-muted hover:text-danger" onClick={() => setFichiers((l) => l.filter((x) => x !== fichier))}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Type : déduit de la catégorie par le noyau ; précisable au besoin. */}
                <details className="group sm:col-span-2">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Préciser le type de demande (facultatif)
                  </summary>
                  <Field label="Type" className="mt-3 sm:max-w-xs">
                    <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: "", label: "Selon la catégorie" }, ...moi.kinds.map((k) => ({ value: k.code, label: k.label }))]} />
                  </Field>
                </details>
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
