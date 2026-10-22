"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, BookOpen } from "@/components/icons";
import { Tabs } from "@/components/ui";
import { EnTete } from "@/components/portail/commun";
import { SimulateurBfr } from "@/components/portail/cabinet-porteur/SimulateurBfr";
import { SimulateurDscr } from "@/components/portail/cabinet-porteur/SimulateurDscr";
import { SimulateurPret } from "@/components/portail/cabinet-porteur/SimulateurPret";
import { SimulateurSeuil } from "@/components/portail/cabinet-porteur/SimulateurSeuil";
import { simulerPret, type ParamsBfr, type ParamsDscr, type ParamsPret, type ParamsSeuil } from "@/components/portail/cabinet-porteur/calculs";

type Outil = "pret" | "dscr" | "seuil" | "bfr";

const OUTILS: Record<Outil, { onglet: string; titre: string; texte: string; conseil: string }> = {
  pret: {
    onglet: "Prêt",
    titre: "Simulateur de prêt",
    texte: "Échéance, coût du crédit et tableau d'amortissement d'un prêt à échéances constantes, avec ou sans différé. Un ordre de grandeur : seule l'offre de la banque fait foi.",
    conseil: "/portail/ressources?q=pret",
  },
  dscr: {
    onglet: "Capacité de remboursement",
    titre: "Capacité de remboursement (DSCR)",
    texte: "Le DSCR rapporte les flux que dégage l'activité aux remboursements de l'année. C'est le premier chiffre qu'un banquier regarde : en dessous de 1, l'activité ne paie pas sa dette.",
    conseil: "/portail/ressources?q=remboursement",
  },
  seuil: {
    onglet: "Seuil de rentabilité",
    titre: "Seuil de rentabilité",
    texte: "Le chiffre d'affaires à partir duquel l'activité couvre toutes ses charges, et le moment de l'année où il est atteint.",
    conseil: "/portail/ressources?q=rentabilite",
  },
  bfr: {
    onglet: "Fonds de roulement",
    titre: "Besoin en fonds de roulement",
    texte: "L'argent immobilisé entre le paiement des fournisseurs et l'encaissement des clients. Souvent oublié des plans de financement, il manque au démarrage.",
    conseil: "/portail/ressources?q=fonds%20de%20roulement",
  },
};

function moisProchain(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Simulateurs financiers calculés dans le navigateur ; rien n'est envoyé au cabinet. */
export default function Outils() {
  const params = useSearchParams();
  const [outil, setOutil] = useState<Outil>(() => {
    const voulu = params.get("outil");
    return voulu && voulu in OUTILS ? (voulu as Outil) : "pret";
  });
  const [pret, setPret] = useState<ParamsPret>(() => ({ montant: 250_000_000, taux: 18, duree: 36, differe: 6, typeDiffere: "partiel", debut: moisProchain() }));
  const [dscr, setDscr] = useState<ParamsDscr>({ ebe: 180_000_000, impots: 25_000_000, renouvellement: 15_000_000, service: 120_000_000, source: "pret" });
  const [seuil, setSeuil] = useState<ParamsSeuil>({ ca: 600_000_000, mode: "pct", cvPct: 55, cvMontant: 330_000_000, cf: 180_000_000 });
  const [bfr, setBfr] = useState<ParamsBfr>({ ca: 600_000_000, achats: 330_000_000, delaiClients: 30, delaiFournisseurs: 15, stock: 45 });
  const resultatPret = useMemo(() => simulerPret(pret), [pret]);
  const o = OUTILS[outil];

  return (
    <div className="space-y-6">
      <EnTete
        surtitre="Outils"
        titre="Simulateurs"
        texte="Testez vos hypothèses avant d'en parler à votre consultant ou à votre banque. Les calculs se font sur votre appareil : rien n'est enregistré ni transmis."
      />

      <Tabs<Outil> value={outil} onChange={setOutil} tabs={(Object.keys(OUTILS) as Outil[]).map((k) => ({ key: k, label: OUTILS[k].onglet }))} />

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="font-display text-[21px] font-bold text-ink">{o.titre}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{o.texte}</p>
        </div>
        <Link href={o.conseil} className="inline-flex flex-none items-center gap-2 rounded-xl bg-accent-doux px-3.5 py-2 text-[13px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white">
          <BookOpen className="h-4 w-4" /> Lire le conseil <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {outil === "pret" && <SimulateurPret params={pret} onChange={setPret} resultat={resultatPret} />}
      {outil === "dscr" && <SimulateurDscr params={dscr} onChange={setDscr} pret={pret} resultatPret={resultatPret} />}
      {outil === "seuil" && <SimulateurSeuil params={seuil} onChange={setSeuil} />}
      {outil === "bfr" && <SimulateurBfr params={bfr} onChange={setBfr} />}

      <p className="text-[12px] leading-relaxed text-muted">
        Résultats indicatifs, à confirmer avec votre consultant MB AxisPro. Une question sur vos chiffres ?{" "}
        <Link href="/portail/messages" className="font-semibold text-accent hover:underline">Écrivez-lui</Link>.
      </p>
    </div>
  );
}
