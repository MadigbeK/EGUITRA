"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search } from "@/components/icons";
import { ApiError, apiGet, apiSend, useAutorise } from "@/lib/api-client";
import type { Paged, Partner } from "@/lib/finance-types";
import { cx } from "@/components/ui";
import { CREATION_TIERS } from "./communPieces";

/**
 * Recherche d'un tiers avec création rapide. creation=false : choix seul (filtre d'un rapport). Une
 * recherche en échec le dit, avec « Réessayer », au lieu de proposer de créer un tiers qui existe peut-être.
 */
export function PartnerPicker({
  value,
  onChange,
  kind,
  placeholder = "Rechercher un tiers…",
  creation: creationDemandee = true,
}: {
  value: { id: number; name: string } | null;
  onChange: (p: { id: number; name: string } | null) => void;
  kind: "customer" | "supplier";
  placeholder?: string;
  creation?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Partner[]>([]);
  const [open, setOpen] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [cherche, setCherche] = useState(0);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // « Créer » : POST /finance/partners (finance, métiers, cabinet, achats) ; la direction choisit seulement.
  const autorise = useAutorise(CREATION_TIERS);
  const creation = creationDemandee && autorise;

  useEffect(() => {
    if (!open) return;
    let actuelle = true;
    const t = setTimeout(async () => {
      try {
        const data = await apiGet<Paged<Partner>>(`/finance/partners?limit=20&search=${encodeURIComponent(query)}`);
        // Une réponse lente d'une frappe précédente ne remplace pas celle de la dernière.
        if (!actuelle) return;
        setItems(data.items);
        setEchec(null);
      } catch (e) {
        if (!actuelle) return;
        setItems([]);
        setEchec(e instanceof ApiError ? e.message : "Recherche impossible : vérifiez la connexion.");
      }
    }, 200);
    return () => {
      actuelle = false;
      clearTimeout(t);
    };
  }, [query, open, cherche]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  /** Création rapide : en chargement pendant l'appel (un second clic créait un doublon), l'échec affiché. */
  async function create() {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true);
    setEchec(null);
    try {
      const partner = await apiSend<Partner>("POST", "/finance/partners", {
        name,
        customer: kind === "customer",
        supplier: kind === "supplier",
      });
      onChange({ id: partner.id, name: partner.name });
      setOpen(false);
    } catch (e) {
      setEchec(e instanceof ApiError ? `Création impossible : ${e.message}` : "Création impossible : vérifiez la connexion, puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={box}>
      <div className="flex min-h-9 items-center gap-2 rounded-lg border border-line-strong bg-panel px-3 py-1.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
        <Search className="h-4 w-4 text-muted" />
        <input
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted/75"
          placeholder={placeholder}
          value={open ? query : value?.name ?? ""}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-[0_18px_50px_-12px_rgb(20_47_41/0.4)]">
          {echec && (
            <div role="alert" className="flex items-start justify-between gap-2 px-3 py-2 text-xs text-danger">
              <span>{echec}</span>
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setCherche((n) => n + 1)}>
                Réessayer
              </button>
            </div>
          )}
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange({ id: p.id, name: p.name });
                setOpen(false);
              }}
              className={cx("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-panel-2", value?.id === p.id && "text-accent")}
            >
              <span className="truncate">{p.name}</span>
              <span className="text-[11px] text-muted">{p.city ?? ""}</span>
            </button>
          ))}
          {creation && !echec && query.trim() && (
            <button type="button" onClick={() => void create()} disabled={busy} aria-busy={busy || undefined} className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-accent hover:bg-panel-2 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer « {query.trim()} »
            </button>
          )}
          {!items.length && !query.trim() && !echec && <div className="px-3 py-2 text-xs text-muted">Tapez un nom pour chercher.</div>}
        </div>
      )}
    </div>
  );
}
