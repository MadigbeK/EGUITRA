"use client";

import { useState } from "react";
import { Download } from "lucide-react";

/* ════════════════════════════════════════════════════════════════
   ExportButton — télécharge un CSV depuis une route API Next.js.
   Le clic appelle /api/admin/export/[type] qui proxy vers FastAPI
   et retourne le fichier CSV UTF-8 BOM (compatible Excel).
   ════════════════════════════════════════════════════════════════ */

interface Props {
  exportPath: string;   // ex: "/api/admin/export/clients"
  label?: string;
  qs?: string;          // ex: "q=pharma"
}

export function ExportButton({ exportPath, label = "Exporter CSV", qs }: Props) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const url = qs ? `${exportPath}?${qs}` : exportPath;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const urlObj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      a.href = urlObj;
      a.download = match?.[1] ?? "export.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(urlObj);
    } catch (e) {
      console.error("Export failed", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-sm border border-[#1d3a28] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#7fa78d] transition-colors hover:border-[#f5d90a] hover:text-[#f5d90a] disabled:opacity-50"
    >
      <Download className="h-3 w-3" />
      {loading ? "Export..." : label}
    </button>
  );
}
