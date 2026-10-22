"use client";

import { Printer } from "@/components/icons";
import { Button, Card, FEUILLE, PageHeader } from "@/components/ui";
import { Markdown, sections } from "@/components/Markdown";

/** Guide intégré à Finance (source Markdown de docs/guides, recopiée par docs/guides/web.js) : texte et sommaire. */
export function GuideIntegre({ source, title, subtitle }: { source: string; title: string; subtitle: string }) {
  const toc = sections(source);
  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
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
          <div className={`sticky top-24 p-4 ${FEUILLE}`}>
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
