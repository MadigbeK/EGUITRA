"use client";

import { Card, Notice } from "@/components/ui";
import { fmtGNF, fmtShort } from "@/lib/format";
import { ChampMontant, ChampNombre, Ligne } from "./champs";
import { ANNEE_JOURS, calculerBfr, type ParamsBfr } from "./calculs";

const COULEURS = { stocks: "#df8f17", creances: "#2d82dc", fournisseurs: "#12956a", bfr: "#e25f35" };

function Barre({ titre, parts, echelle }: { titre: string; parts: Array<{ label: string; valeur: number; couleur: string }>; echelle: number }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{titre}</div>
      <div className="flex h-9 w-full gap-[3px] overflow-hidden rounded-xl bg-panel-2">
        {parts
          .filter((x) => x.valeur > 0)
          .map((x) => (
            <div
              key={x.label}
              className="n-pousser-x flex min-w-0 items-center overflow-hidden px-2 text-[11.5px] font-semibold text-white"
              style={{ width: `${(x.valeur / echelle) * 100}%`, background: x.couleur }}
              title={`${x.label} : ${fmtGNF(x.valeur)}`}
            >
              <span className="truncate">{fmtShort(x.valeur)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

export function SimulateurBfr({ params, onChange }: { params: ParamsBfr; onChange: (p: ParamsBfr) => void }) {
  const maj = (champ: Partial<ParamsBfr>) => onChange({ ...params, ...champ });
  const b = calculerBfr(params);
  const besoins = b.stocks + b.creances;
  const echelle = Math.max(besoins, b.fournisseurs, 1);
  const leviers = [
    { titre: "Encaisser vos clients 15 jours plus tôt", gain: (params.ca * Math.min(15, params.delaiClients)) / ANNEE_JOURS, conseil: "Acompte à la commande, facture remise à la livraison, relance le jour de l'échéance, paiement mobile accepté." },
    { titre: "Garder 10 jours de stock en moins", gain: (params.achats * Math.min(10, params.stock)) / ANNEE_JOURS, conseil: "Commandes plus fréquentes et plus petites, suivi des articles qui dorment, achats calés sur les ventes." },
    { titre: "Obtenir 15 jours de plus de vos fournisseurs", gain: (params.achats * 15) / ANNEE_JOURS, conseil: "À négocier contre la régularité de vos commandes ou un engagement de volume." },
  ].filter((l) => l.gain > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card title="Votre cycle d'exploitation">
        <div className="space-y-4">
          <ChampMontant label="Chiffre d'affaires annuel" value={params.ca} onChange={(ca) => maj({ ca })} />
          <ChampMontant label="Achats annuels" value={params.achats} onChange={(achats) => maj({ achats })} aide="Marchandises et matières premières achetées dans l'année." />
          <div className="grid grid-cols-2 gap-3">
            <ChampNombre label="Délai clients" unite="jours" max={360} value={params.delaiClients} onChange={(delaiClients) => maj({ delaiClients })} />
            <ChampNombre label="Délai fournisseurs" unite="jours" max={360} value={params.delaiFournisseurs} onChange={(delaiFournisseurs) => maj({ delaiFournisseurs })} />
          </div>
          <ChampNombre label="Stock moyen" unite="jours d'achats" max={360} value={params.stock} onChange={(stock) => maj({ stock })} aide="Combien de jours d'achats dorment en moyenne en magasin." />
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        <section aria-label="Besoin en fonds de roulement" className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(125deg,#16304e_0%,#1f4a7a_55%,#137c86_100%)] p-6 text-white shadow-[0_30px_60px_-36px_rgb(16_40_70/0.7)] sm:p-7">
          <div className="text-[13px] font-medium text-white/70">{b.bfr >= 0 ? "Besoin en fonds de roulement" : "Ressource en fonds de roulement"}</div>
          <div aria-live="polite" className="mt-1 font-display text-[34px] font-bold leading-none tabular sm:text-[42px]">
            {fmtGNF(Math.abs(b.bfr))}
          </div>
          <div className="mt-2 text-[13.5px] text-white/80">
            {b.joursCa === null ? "Renseignez le chiffre d'affaires." : `soit ${Math.round(Math.abs(b.joursCa))} jours de chiffre d'affaires ${b.bfr >= 0 ? "à financer en permanence" : "financés par vos fournisseurs"}.`}
          </div>
        </section>

        {b.bfr < 0 ? (
          <Notice tone="ok">Vos fournisseurs financent votre cycle : vous encaissez avant de payer. Veillez à garder ce rythme quand l'activité grandit.</Notice>
        ) : (
          b.bfr > 0 && <Notice tone="accent">Ce montant doit être financé dès le démarrage, par vos apports ou un crédit de fonctionnement. Il grandit avec le chiffre d'affaires : prévoyez-le dans votre plan de financement.</Notice>
        )}

        <Card title="Ce que le cycle immobilise, et qui le finance">
          <div className="space-y-4">
            <Barre
              titre="Argent immobilisé"
              echelle={echelle}
              parts={[
                { label: "Stocks", valeur: b.stocks, couleur: COULEURS.stocks },
                { label: "Créances clients", valeur: b.creances, couleur: COULEURS.creances },
              ]}
            />
            <Barre
              titre="Financement"
              echelle={echelle}
              parts={[
                { label: "Crédit fournisseurs", valeur: b.fournisseurs, couleur: COULEURS.fournisseurs },
                { label: "Besoin à financer", valeur: Math.max(0, b.bfr), couleur: COULEURS.bfr },
              ]}
            />
          </div>
          <dl className="mt-4">
            <Ligne label={<span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: COULEURS.stocks }} />Stocks ({params.stock} jours d'achats)</span>} valeur={fmtGNF(b.stocks)} />
            <Ligne label={<span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: COULEURS.creances }} />Créances clients ({params.delaiClients} jours de CA)</span>} valeur={fmtGNF(b.creances)} />
            <Ligne label={<span className="inline-flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: COULEURS.fournisseurs }} />Dettes fournisseurs ({params.delaiFournisseurs} jours d'achats)</span>} valeur={`− ${fmtGNF(b.fournisseurs)}`} />
            <Ligne label="Besoin en fonds de roulement" valeur={fmtGNF(b.bfr)} fort ton={b.bfr > 0 ? "warn" : "ok"} />
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">Calcul sur une année de {ANNEE_JOURS} jours, montants hors taxes, activité régulière sur l'année.</p>
        </Card>

        {leviers.length > 0 && b.bfr > 0 && (
          <Card title="Leviers pour le réduire">
            <ul className="space-y-3">
              {leviers.map((l) => (
                <li key={l.titre} className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-2xl border border-line px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-ink">{l.titre}</div>
                    <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{l.conseil}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11.5px] text-muted">libère environ</div>
                    <div className="text-[15px] font-bold tabular text-ok-texte">{fmtGNF(l.gain)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
