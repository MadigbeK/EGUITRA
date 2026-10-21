"use client";

import { Printer } from "@/components/icons";
import { Button, Card, PageHeader } from "@/components/ui";
import { Markdown, sections } from "@/components/Markdown";
import { GUIDES } from "@/lib/guides";

/** Guide intégré de la finance : où saisir quoi, règles, rythme de travail, écrans (source : docs/guides/guide-finance.md). */
export default function GuidePage() {
  const source = GUIDES.finance ?? "";
  const toc = sections(source);
  return (
    <div>
      <PageHeader
        title="Guide de la finance"
        subtitle="Règles comptables et instructions de saisie : où saisir quoi, les règles à ne jamais enfreindre, le rythme de travail, chaque écran."
        actions={
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <Card>
          <Markdown source={source} sansTitre />
        </Card>
        <nav aria-label="Sommaire du guide" className="no-print order-first lg:order-none">
          <div className="sticky top-24 rounded-2xl border border-line bg-panel p-4 shadow-[var(--ombre-carte)]">
            <div className="mb-2 text-[12px] font-semibold text-muted">Sommaire</div>
            <ul className="space-y-1">
              {toc.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-lg px-2 py-1 text-[13px] text-ink-2 hover:bg-panel-2 hover:text-ink">
                    {s.title.replace(/\s*\(.*\)$/, "")}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </div>
  );
}
