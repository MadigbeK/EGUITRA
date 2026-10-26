"use client";

import type { ReactNode } from "react";
import {
  Calendar, Clock, Coins, Gauge as IconeCapacite, HandCoins, Layers, Mail, MapPin, Smartphone, Users, type Icon,
} from "@/components/icons";
import { Badge, Card, ErrorBox, Etapes, Kpi, Loading, cx, type Tone } from "@/components/ui";
import { EnTete, TexteRiche } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { CarteFinancement } from "@/components/portail/projet/Financements";
import { FilProjet } from "@/components/portail/projet/FilProjet";
import { Avatar, LienBouton, PasDeDossier, jour, erreurLisible } from "@/components/portail/projet/outils";
import { useApi } from "@/lib/api-client";
import { INSECABLE, fmtGNF, fmtPct, fmtShort } from "@/lib/format";
import type { DossierRef, Projet } from "@/lib/portail-types";

const ETAT_DOSSIER: Record<DossierRef["state"], { tone: Tone; label: string }> = {
  open: { tone: "ok", label: "Accompagnement en cours" },
  on_hold: { tone: "warn", label: "Dossier suspendu" },
  closed: { tone: "neutral", label: "Dossier clos" },
};

const DECISION_TONE: Record<string, Tone> = { go: "ok", conditional: "ok", hold: "warn", no_go: "danger", postponed: "warn" };

function Ligne({ icon: I, label, children }: { icon: Icon; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span aria-hidden className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-panel-2 text-accent">
        <I className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[12px] font-medium text-muted">{label}</dt>
        <dd className="mt-0.5 break-words text-[14px] font-medium leading-snug text-ink">{children}</dd>
      </div>
    </div>
  );
}

export default function MonProjet() {
  const { espace, dossier } = usePortail();
  const { data, error, mutate } = useApi<Projet>(dossier ? `/portail/dossiers/${dossier.id}/projet` : null);
  if (espace && !espace.dossiers.length) return <PasDeDossier />;
  if (error) return <ErrorBox error={erreurLisible(error)} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement de votre projet…" />;

  const d = data.dossier;
  const devise = d.currency.name || d.currency.symbol || "GNF";
  const etat = ETAT_DOSSIER[d.state];
  // Résumé du noyau, le même qu'à l'accueil : pistes actives seulement, dans la devise des financements.
  const resume = data.fundings_summary;
  const deviseFinancements = resume.currency || devise;
  const sollicite = resume.requested;
  const accorde = resume.granted;
  const couverture = accorde > 0 && d.financing_need > 0 && deviseFinancements === devise ? Math.min(100, Math.round((accorde / d.financing_need) * 100)) : null;
  const part = d.investment > 0 && d.financing_need > 0 ? Math.round((d.financing_need / d.investment) * 100) : null;
  const ouvertes = data.fundings.filter((f) => f.state !== "rejected" && f.state !== "withdrawn");
  const closes = data.fundings.filter((f) => f.state === "rejected" || f.state === "withdrawn");
  const lieu = [d.sector, d.location].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <EnTete
        surtitre={`Mon projet · ${d.reference}`}
        titre={d.name}
        texte={lieu || undefined}
        actions={
          <>
            <LienBouton href="/portail/messages">
              <Mail className="h-4 w-4" />
              Écrire au cabinet
            </LienBouton>
            <LienBouton href="/portail/rendez-vous" variant="primary">
              <Clock className="h-4 w-4" />
              Demander un rendez-vous
            </LienBouton>
          </>
        }
      />

      {/* Parcours du dossier */}
      <Card
        title="Parcours du dossier"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={etat.tone} vivant={d.state === "open"}>{etat.label}</Badge>
            {d.decision_label && <Badge tone={DECISION_TONE[d.decision ?? ""] ?? "neutral"}>Comité : {d.decision_label}</Badge>}
          </div>
        }
      >
        {d.gates.length ? (
          <>
            <Etapes steps={d.gates.map((g) => ({ key: g.code, label: g.name, state: g.current ? "current" : g.reached ? "done" : "todo", title: g.code }))} />
            {d.current_gate && (
              <p className="mt-5 text-[13.5px] text-muted">
                Votre dossier est à l'étape <span className="font-semibold text-ink">{d.current_gate.name}</span>. Votre consultant vous indique dans le plan d'actions ce qu'il faut réunir pour franchir la suivante.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Le cabinet précisera bientôt les étapes de votre parcours.</p>
        )}
      </Card>

      {/* Chiffres clés */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <Kpi label="Investissement prévu" value={d.investment ? `${fmtShort(d.investment)}${INSECABLE}${devise}` : "À préciser"} hint={d.investment ? fmtGNF(d.investment, devise) : undefined} />
        <Kpi
          label="Besoin de financement"
          value={d.financing_need ? `${fmtShort(d.financing_need)}${INSECABLE}${devise}` : "À préciser"}
          hint={part !== null ? `${fmtPct(part, 0)} de l'investissement` : undefined}
        />
        <Kpi label="Financements sollicités" value={`${fmtShort(sollicite)}${INSECABLE}${deviseFinancements}`} hint={`${resume.count} piste${resume.count > 1 ? "s" : ""} en cours`} />
        <Kpi
          label="Financements accordés"
          value={`${fmtShort(accorde)}${INSECABLE}${deviseFinancements}`}
          tone={accorde > 0 ? "ok" : "neutral"}
          hint={accorde <= 0 ? "En attente des décisions" : couverture !== null ? `${fmtPct(couverture, 0)} du besoin couvert` : "Accordés par les financeurs"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        {/* Fiche du projet */}
        <Card title="Fiche du projet" className="xl:col-span-7">
          {d.description ? (
            <div className="mb-6 rounded-2xl bg-panel-2/70 p-4">
              <TexteRiche source={d.description} compact />
            </div>
          ) : (
            <p className="mb-6 text-sm text-muted">La présentation du projet sera complétée avec votre consultant.</p>
          )}
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Ligne icon={Users} label="Promoteur">{d.promoter || "À préciser"}</Ligne>
            <Ligne icon={Layers} label="Secteur">{d.sector ?? "À préciser"}</Ligne>
            <Ligne icon={MapPin} label="Localisation">{d.location ?? "À préciser"}</Ligne>
            <Ligne icon={IconeCapacite} label="Capacité">{d.capacity ?? "À préciser"}</Ligne>
            <Ligne icon={Calendar} label="Démarrage prévu">{d.date_start ? jour(d.date_start) : "À préciser"}</Ligne>
            <Ligne icon={Coins} label="Investissement">{d.investment ? fmtGNF(d.investment, devise) : "À préciser"}</Ligne>
            <Ligne icon={HandCoins} label="Besoin de financement">
              {d.financing_need ? fmtGNF(d.financing_need, devise) : "À préciser"}
              {part !== null && <span className="block text-[12px] font-normal text-muted">soit {fmtPct(part, 0)} de l'investissement</span>}
            </Ligne>
          </dl>
        </Card>

        {/* Équipe du cabinet */}
        <Card title="Votre équipe MB AxisPro Consulting" className="xl:col-span-5">
          {data.team.length === 0 ? (
            <p className="text-sm text-muted">Le cabinet désignera bientôt votre consultant. En attendant, vous pouvez écrire au cabinet depuis la messagerie.</p>
          ) : (
            <ul className="space-y-3">
              {data.team.map((p, i) => (
                <li key={`${p.id}-${p.role}`} className={cx("rounded-2xl border p-4", i === 0 ? "border-accent-vif/30 bg-accent-doux/40" : "border-line")}>
                  <div className="flex items-center gap-3">
                    <Avatar nom={p.name} plein={i === 0} taille={44} />
                    <div className="min-w-0">
                      <div className="truncate text-[14.5px] font-semibold text-ink">{p.name}</div>
                      <div className="truncate text-[12.5px] text-muted">{p.role}</div>
                    </div>
                  </div>
                  {(p.phone || p.email) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {p.phone && (
                        <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="inline-flex min-w-0 items-center gap-2 rounded-lg bg-panel px-3 py-1.5 text-[13px] font-medium text-ink ring-1 ring-line hover:ring-line-strong" aria-label={`Appeler ${p.name} au ${p.phone}`}>
                          <Smartphone className="h-4 w-4 flex-none text-accent" />
                          <span className="truncate">{p.phone}</span>
                        </a>
                      )}
                      {p.email && (
                        <a href={`mailto:${p.email}`} className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-panel px-3 py-1.5 text-[13px] font-medium text-ink ring-1 ring-line hover:ring-line-strong" aria-label={`Écrire un courriel à ${p.name}`}>
                          <Mail className="h-4 w-4 flex-none text-accent" />
                          <span className="truncate">{p.email}</span>
                        </a>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Financements recherchés */}
      <Card
        title="Financements recherchés"
        actions={
          data.fundings.length > 0 && (
            <span className="text-[13px] text-muted">
              {ouvertes.length} piste{ouvertes.length > 1 ? "s" : ""} active{ouvertes.length > 1 ? "s" : ""}
              {closes.length > 0 && `, ${closes.length} close${closes.length > 1 ? "s" : ""}`}
            </span>
          )
        }
      >
        {data.fundings.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl bg-panel-2 px-4 py-4 text-sm text-ink-2">
            <HandCoins className="mt-0.5 h-5 w-5 flex-none text-accent" />
            <span>Le cabinet vous présentera ici les banques, fonds et programmes sollicités pour votre projet, avec l'avancement de chaque demande.</span>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...ouvertes, ...closes].map((f) => (
              <CarteFinancement key={f.id} f={f} devise={devise} />
            ))}
          </div>
        )}
      </Card>

      {/* Fil complet */}
      <Card title="Fil du projet" actions={<span className="text-[13px] text-muted">{data.timeline.length} événement{data.timeline.length > 1 ? "s" : ""}</span>}>
        <FilProjet items={data.timeline} />
      </Card>
    </div>
  );
}
