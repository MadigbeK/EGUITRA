"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Monogramme } from "@/components/brand";
import { Button, Field, Notice, Select } from "@/components/ui";
import { fmtDate } from "@/lib/format";

/**
 * Page publique du lien de dépôt (sans compte) : le promoteur envoie ses pièces, fichier par fichier. Tout passe par
 * /api/depot, qui relaie au noyau. Rien de la plateforme n'est lisible d'ici : ni score, ni autre pièce du dossier.
 */
interface Depose {
  name: string;
  category: string | null;
  date: string;
}

interface PageDepot {
  project: string;
  reference: string;
  company: string;
  expires_at: string;
  formats: string[];
  max_file_mb: number;
  categories: Array<{ letter: string; name: string }>;
  deposited: Depose[];
}

const SANS_REPONSE = "Le service ne répond pas. Réessayez dans un instant.";

function extensions(formats: string[]): string {
  return formats.flatMap((f) => (f === "JPG" ? [".jpg", ".jpeg"] : [`.${f.toLowerCase()}`])).join(",");
}

async function lire<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.message === "string" && data.message ? data.message : SANS_REPONSE);
  return data as T;
}

function Cadre({ children }: { children: ReactNode }) {
  return (
    <div data-app="axispro" className="min-h-screen bg-bg text-ink">
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 inline-flex items-center gap-3">
          <Monogramme tuile={false} className="h-10 w-10" />
          <span className="leading-none">
            <span className="block font-display text-[19px] font-bold tracking-[0.02em]">MB AxisPro Consulting</span>
            <span className="mt-1 block text-[12.5px] font-semibold text-accent">Dépôt de pièces</span>
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}

export function DepotPublic({ jeton }: { jeton: string }) {
  const [page, setPage] = useState<PageDepot | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [categorie, setCategorie] = useState("");
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [retours, setRetours] = useState<Array<{ fichier: string; ok: boolean; texte: string }>>([]);

  const charger = useCallback(async () => {
    try {
      setPage(await lire<PageDepot>(await fetch(`/api/depot/${jeton}`, { cache: "no-store", credentials: "omit" })));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : SANS_REPONSE);
    }
  }, [jeton]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function deposer(fichiers: File[]) {
    if (!page) return;
    const maximum = page.max_file_mb * 1024 * 1024;
    setRetours([]);
    // Un fichier à la fois : l'échec de l'un n'empêche pas les autres, et chacun dit son résultat.
    for (const fichier of fichiers) {
      setEnvoi(fichier.name);
      if (fichier.size > maximum) {
        setRetours((r) => [...r, { fichier: fichier.name, ok: false, texte: `plus de ${page.max_file_mb} Mo, compressez le fichier` }]);
        continue;
      }
      const form = new FormData();
      form.append("file", fichier);
      if (categorie) form.append("category", categorie);
      try {
        const reponse = await lire<{ deposited: Depose[] }>(await fetch(`/api/depot/${jeton}`, { method: "POST", body: form, credentials: "omit" }));
        setPage((p) => (p ? { ...p, deposited: reponse.deposited } : p));
        setRetours((r) => [...r, { fichier: fichier.name, ok: true, texte: "reçu" }]);
      } catch (e) {
        const message = e instanceof Error ? e.message : SANS_REPONSE;
        setRetours((r) => [...r, { fichier: fichier.name, ok: false, texte: message.replace(`${fichier.name} : `, "") }]);
      }
    }
    setEnvoi(null);
  }

  if (erreur && !page) {
    return (
      <Cadre>
        <div className="space-y-3">
          <Notice tone="danger">{erreur}</Notice>
          <Button onClick={() => void charger()}>Réessayer</Button>
        </div>
      </Cadre>
    );
  }
  if (!page) {
    return (
      <Cadre>
        <p className="text-muted">Chargement…</p>
      </Cadre>
    );
  }

  return (
    <Cadre>
      <h1 className="font-display text-2xl font-bold">{page.project}</h1>
      <p className="mt-1 text-[14px] text-muted">
        {page.reference} · lien valable jusqu&apos;au {fmtDate(page.expires_at)}
      </p>
      <p className="mt-4 text-[15px] text-ink-2">
        Déposez ici les pièces demandées par {page.company}. Aucun compte n&apos;est nécessaire. L&apos;équipe vérifie chaque pièce après réception.
      </p>
      <div className="mt-6 space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
        <Field label="Catégorie de la pièce" hint="Facultatif : l'équipe la classera si vous ne savez pas.">
          <Select
            value={categorie}
            disabled={envoi !== null}
            onChange={(e) => setCategorie(e.target.value)}
            options={[{ value: "", label: "Je ne sais pas" }, ...page.categories.map((c) => ({ value: c.letter, label: `${c.letter}. ${c.name}` }))]}
          />
        </Field>
        <label className={`inline-flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-white ${envoi === null ? "cursor-pointer" : "pointer-events-none opacity-60"}`}>
          {envoi === null ? "Choisir des fichiers" : `Envoi de ${envoi}…`}
          <input
            type="file"
            multiple
            accept={extensions(page.formats)}
            className="sr-only"
            disabled={envoi !== null}
            aria-label="Choisir les fichiers à déposer"
            onChange={(e) => {
              const fichiers = [...(e.target.files ?? [])];
              e.target.value = "";
              if (fichiers.length) void deposer(fichiers);
            }}
          />
        </label>
        <p className="text-[13px] text-muted">
          Formats acceptés : {page.formats.join(", ")} · {page.max_file_mb} Mo au plus par fichier.
        </p>
        {retours.length > 0 && (
          <ul className="space-y-1 text-[14px]" aria-live="polite">
            {retours.map((r, i) => (
              <li key={`${r.fichier}-${i}`} className={r.ok ? "text-ink-2" : "font-semibold text-danger"}>
                {r.fichier} : {r.texte}
              </li>
            ))}
          </ul>
        )}
      </div>
      {page.deposited.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[15px] font-semibold">Pièces reçues par ce lien · {page.deposited.length}</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
            {page.deposited.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 text-[14px]">
                <span className="min-w-0 break-all">{p.name}</span>
                <span className="whitespace-nowrap text-[13px] text-muted">{fmtDate(p.date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Cadre>
  );
}
