"use client";

/**
 * Onglets de Ventes et d'Achats et dépenses (Finance) : les factures clients et fournisseurs de toujours, puis
 * les offres, les commandes, le catalogue et le tableau de bord des achats et des ventes. Chaque onglet
 * n'apparaît qu'aux profils que ses routes acceptent.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { ACHATS_COMPLET, ACHATS_PIECE, ACHATS_TOUS, VENTES_LECTURE } from "@/lib/commerce-types";
import type { Me, Profile } from "@/lib/types";

type Onglet = { href: string; label: string; profils: Profile[] };

const ONGLETS: Record<"ventes" | "achats", { racine: string; titre: string; onglets: Onglet[] }> = {
  ventes: {
    racine: "/finance/ventes",
    titre: "Ventes",
    onglets: [
      { href: "/finance/ventes", label: "Factures", profils: VENTES_LECTURE },
      { href: "/finance/ventes/offres", label: "Offres", profils: VENTES_LECTURE },
      { href: "/finance/ventes/commandes", label: "Commandes", profils: VENTES_LECTURE },
      { href: "/finance/ventes/catalogue", label: "Catalogue", profils: VENTES_LECTURE },
      { href: "/finance/ventes/tableau", label: "Tableau de bord", profils: VENTES_LECTURE },
    ],
  },
  achats: {
    racine: "/finance/achats",
    titre: "Achats et dépenses",
    onglets: [
      { href: "/finance/achats", label: "Factures fournisseurs", profils: [...VENTES_LECTURE, "achats"] },
      { href: "/finance/achats/commandes", label: "Bons de commande", profils: ACHATS_TOUS },
      { href: "/finance/achats/catalogue", label: "Catalogue", profils: ACHATS_PIECE },
      { href: "/finance/achats/tableau", label: "Tableau de bord", profils: ACHATS_COMPLET },
    ],
  },
};

export function OngletsCommerce({ espace }: { espace: "ventes" | "achats" }) {
  const pathname = usePathname() ?? "";
  const { data: me } = useApi<Me>("/auth/me");
  const { racine, titre, onglets } = ONGLETS[espace];
  const visibles = onglets.filter((o) => me?.profiles.some((p) => o.profils.includes(p)));
  // Un seul onglet ouvert au compte (profil métier : ses bons de commande) : pas de barre d'onglets.
  if (visibles.length < 2) return null;
  return (
    <nav aria-label={`Rubriques de ${titre}`} className="no-print -mx-1 mb-5 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-x-6 border-b border-line">
        {visibles.map((o) => {
          const actif = o.href === racine ? pathname === racine || pathname === `${racine}/` : pathname === o.href || pathname.startsWith(`${o.href}/`);
          return (
            <li key={o.href}>
              <Link
                href={o.href}
                aria-current={actif ? "page" : undefined}
                className={cx("relative inline-flex items-center whitespace-nowrap py-3 text-sm font-semibold transition-colors", actif ? "text-ink" : "text-muted hover:text-ink")}
              >
                {o.label}
                {actif && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent-vif" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
