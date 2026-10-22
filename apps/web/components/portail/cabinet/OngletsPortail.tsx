"use client";

/**
 * Onglets des outils du cabinet pour le portail des porteurs. Les compteurs (messages non lus,
 * rendez-vous demandés, contenus à relire) viennent de la synthèse, partagée par tous les écrans.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import type { Synthese } from "@/lib/portail-types";

const RACINE = "/axispro/portail";

type Onglet = { href: string; label: string; compte?: (s: Synthese) => number; titre?: string };

const ONGLETS: Onglet[] = [
  { href: RACINE, label: "Synthèse" },
  { href: `${RACINE}/messages`, label: "Messages", compte: (s) => s.messages.unread, titre: "messages non lus" },
  { href: `${RACINE}/communications`, label: "Communications" },
  { href: `${RACINE}/ressources`, label: "Ressources", compte: (s) => s.articles.drafts, titre: "brouillons à relire" },
  { href: `${RACINE}/evenements`, label: "Événements" },
  { href: `${RACINE}/rendez-vous`, label: "Rendez-vous", compte: (s) => s.meetings.requested, titre: "demandes en attente" },
  { href: `${RACINE}/porteurs`, label: "Porteurs et avis" },
];

export function OngletsPortail() {
  const pathname = usePathname() ?? "";
  const { data } = useApi<Synthese>("/axispro/portail/synthese", { refreshInterval: 60_000 });
  return (
    <nav aria-label="Outils du portail des porteurs" className="no-print -mx-1 mb-6 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-x-6 border-b border-line">
        {ONGLETS.map((o) => {
          const actif = o.href === RACINE ? pathname === RACINE || pathname === `${RACINE}/` : pathname === o.href || pathname.startsWith(`${o.href}/`);
          const n = data && o.compte ? o.compte(data) : 0;
          return (
            <li key={o.href}>
              <Link
                href={o.href}
                aria-current={actif ? "page" : undefined}
                className={cx(
                  "relative inline-flex items-center gap-1.5 whitespace-nowrap py-3 text-sm font-semibold transition-colors",
                  actif ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                {o.label}
                {n > 0 && (
                  <span className={cx("rounded-full px-1.5 py-px text-[11.5px] font-semibold tabular", actif ? "bg-accent-doux text-accent" : "bg-warn-doux text-warn")}>
                    {n}
                    <span className="sr-only"> {o.titre}</span>
                  </span>
                )}
                {actif && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent-vif" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
