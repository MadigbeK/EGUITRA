"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "@/components/icons";
import { apiGet, apiSend, useAutorise } from "@/lib/api-client";
import type { Paged, Partner } from "@/lib/finance-types";
import { cx } from "@/components/ui";
import { CREATION_TIERS } from "./communPieces";

/** Recherche d'un tiers avec création rapide. */
export function PartnerPicker({
  value,
  onChange,
  kind,
  placeholder = "Rechercher un tiers…",
}: {
  value: { id: number; name: string } | null;
  onChange: (p: { id: number; name: string } | null) => void;
  kind: "customer" | "supplier";
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Partner[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // « Créer » : POST /finance/partners (finance, métiers, cabinet, achats) ; la direction choisit seulement.
  const creation = useAutorise(CREATION_TIERS);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const data = await apiGet<Paged<Partner>>(`/finance/partners?limit=20&search=${encodeURIComponent(query)}`).catch(() => null);
      setItems(data?.items ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function create() {
    const name = query.trim();
    if (!name) return;
    const partner = await apiSend<Partner>("POST", "/finance/partners", {
      name,
      customer: kind === "customer",
      supplier: kind === "supplier",
    });
    onChange({ id: partner.id, name: partner.name });
    setOpen(false);
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
          {creation && query.trim() && (
            <button type="button" onClick={create} className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-sm text-accent hover:bg-panel-2">
              <Plus className="h-4 w-4" /> Créer « {query.trim()} »
            </button>
          )}
          {!items.length && !query.trim() && <div className="px-3 py-2 text-xs text-muted">Tapez un nom pour chercher.</div>}
        </div>
      )}
    </div>
  );
}
