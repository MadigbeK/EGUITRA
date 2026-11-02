"use client";

/**
 * Signature manuscrite scannée des approbateurs (facultative), imprimée à côté de leur nom dans le circuit
 * d'approbation du bon de commande, en face d'une approbation réellement donnée par leur compte. L'approbation
 * elle-même est la signature électronique simple : compte authentifié, date et heure, empreinte du bon.
 * Chacun dépose la sienne ; l'administration dépose ou retire celle d'un approbateur.
 */

import { useEffect, useState } from "react";
import { Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, FileButton, Notice } from "@/components/ui";
import { apiSend, apiUpload, useApi, useAutorise } from "@/lib/api-client";
import { SIGNATURE_APPROBATEUR, SIGNATURES_ADMIN, type SignatureApprobateur } from "@/lib/commerce-types";
import { useEnvoi } from "@/lib/envoi";
import { fmtDateTime } from "@/lib/format";

const FORMATS = ".png,.jpg,.jpeg";
const LIMITE = 500 * 1024;

/** Aperçu de l'image, lue par la passerelle avec l'en-tête de l'application (une balise img seule ne l'envoie pas). */
function Apercu({ path, version }: { path: string; version: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let actuel = true;
    let objet: string | null = null;
    fetch(`/api/odoo${path}`, { headers: { "X-Eguitra-App": "finance" } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
      if (!actuel) return;
      objet = URL.createObjectURL(blob);
      setUrl(objet);
    }).catch(() => setUrl(null));
    return () => {
      actuel = false;
      if (objet) URL.revokeObjectURL(objet);
    };
  }, [path, version]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="Signature déposée" className="max-h-16 max-w-[220px] rounded border border-line bg-white p-1" /> : null;
}

export function MaSignature() {
  const autorise = useAutorise(SIGNATURE_APPROBATEUR);
  const admin = useAutorise(SIGNATURES_ADMIN);
  const { data, mutate } = useApi<SignatureApprobateur>(autorise ? "/commerce/signature" : null);
  const envoi = useEnvoi();
  if (!autorise) return null;
  function deposer(file: File, path: string, apres: () => void) {
    if (file.size > LIMITE) {
      envoi.setMessage({ tone: "danger", text: "Image trop lourde : 500 Ko au plus." });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    void envoi.run("signature", () => apiUpload(path, form), "Signature déposée.").then((ok) => ok && apres());
  }
  return (
    <div className="space-y-4">
      <Card title="Ma signature manuscrite (facultative)">
        <div className="space-y-3 text-sm">
          {envoi.message && <Notice tone={envoi.message.tone}>{envoi.message.text}</Notice>}
          <p className="text-ink-2">Votre approbation dans la corbeille vaut signature électronique simple : elle est donnée par votre compte, datée à la minute et liée à l&apos;empreinte du bon. L&apos;image de votre signature manuscrite (PNG ou JPEG, 500 Ko au plus, fond blanc de préférence) est seulement imprimée à côté de votre nom sur les bons que vous approuvez.</p>
          <div className="flex flex-wrap items-center gap-3">
            {data?.has_signature ? <Apercu path="/commerce/signature/image" version={data.updated_at ?? ""} /> : <Badge>Aucune signature déposée</Badge>}
            <FileButton small label={data?.has_signature ? "Remplacer" : "Déposer ma signature"} accept={FORMATS} onFile={(f) => deposer(f, "/commerce/signature", () => void mutate())} />
            {data?.has_signature && (
              <Button size="sm" variant="ghost" loading={envoi.busy === "retirer"} onClick={() => void envoi.run("retirer", () => apiSend("DELETE", "/commerce/signature"), "Signature retirée.").then((ok) => { if (ok) void mutate(); })}>
                <Trash2 className="h-4 w-4" /> Retirer
              </Button>
            )}
          </div>
          {data?.updated_at && <p className="text-[12px] text-muted">Déposée le {fmtDateTime(data.updated_at)}{data.updated_by ? ` par ${data.updated_by.name}` : ""}.</p>}
        </div>
      </Card>
      {admin && <SignaturesApprobateurs />}
    </div>
  );
}

function SignaturesApprobateurs() {
  const { data, mutate } = useApi<SignatureApprobateur[]>("/commerce/signatures");
  const envoi = useEnvoi();
  return (
    <Card title="Signatures des approbateurs (administration)" padded={false}>
      {envoi.message && <div className="px-4 pb-2"><Notice tone={envoi.message.tone}>{envoi.message.text}</Notice></div>}
      <DataTable dense rows={data ?? []} rowKey={(s) => s.user.id} empty="Aucun approbateur dans la société." columns={[
        { key: "user", label: "Approbateur", render: (s) => <div>{s.user.name}{s.function && <div className="text-[11.5px] text-muted">{s.function}</div>}</div> },
        { key: "has_signature", label: "Signature", render: (s) => (s.has_signature ? <Apercu path={`/commerce/signatures/${s.user.id}/image`} version={s.updated_at ?? ""} /> : <Badge>Aucune</Badge>) },
        { key: "updated_at", label: "Déposée", render: (s) => (s.updated_at ? `${fmtDateTime(s.updated_at)}${s.updated_by ? ` par ${s.updated_by.name}` : ""}` : "–") },
        { key: "actions", label: "", render: (s) => (
          <div className="flex gap-1">
            <FileButton small label="Déposer" accept={FORMATS} onFile={(file) => {
              const form = new FormData();
              form.append("file", file);
              void envoi.run(`s${s.user.id}`, () => apiUpload(`/commerce/signatures/${s.user.id}`, form), `Signature de ${s.user.name} déposée.`).then((ok) => { if (ok) void mutate(); });
            }} />
            {s.has_signature && <Button size="sm" variant="ghost" aria-label={`Retirer la signature de ${s.user.name}`} onClick={() => void envoi.run(`r${s.user.id}`, () => apiSend("DELETE", `/commerce/signatures/${s.user.id}`), "Signature retirée.").then((ok) => { if (ok) void mutate(); })}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ) },
      ]} />
    </Card>
  );
}
