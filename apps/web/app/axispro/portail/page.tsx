"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Calendar, Clock, ListChecks, Mail, Sparkles, Users, type Icon } from "@/components/icons";
import { OngletsPortail } from "@/components/portail/cabinet/OngletsPortail";
import { pluriel } from "@/components/portail/cabinet/outils";
import { quand } from "@/components/portail/commun";
import { Card, Empty, ErrorBox, IconTile, Kpi, PageHeader, Squelette, type Teinte, type Tone } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { fmtFixe, fmtInt } from "@/lib/format";
import type { Synthese } from "@/lib/portail-types";

const A_FAIRE: Record<Synthese["to_do"][number]["kind"], { icon: Icon; teinte: Teinte; label: string }> = {
  meeting: { icon: Clock, teinte: "azur", label: "Rendez-vous" },
  message: { icon: Mail, teinte: "ambre", label: "Message" },
  action: { icon: ListChecks, teinte: "jade", label: "Compte rendu" },
};

/** NPS signé : « +33 », « −12 », « 0 ». */
function signe(n: number) {
  return n > 0 ? `+${fmtInt(n)}` : n < 0 ? `−${fmtInt(Math.abs(n))}` : "0";
}

function toneSatisfaction(moyenne: number | null): Tone {
  if (moyenne === null) return "neutral";
  return moyenne >= 4 ? "ok" : moyenne >= 3 ? "warn" : "danger";
}

export default function PortailSynthesePage() {
  const { data, error, mutate } = useApi<Synthese>("/axispro/portail/synthese", { refreshInterval: 60_000 });

  return (
    <div>
      <PageHeader
        title="Portail des porteurs"
        subtitle="L'activité des porteurs de projets sur leur portail : échanges, rendez-vous, contenus publiés et satisfaction. Ce qui attend MB AxisPro Consulting est listé ci-dessous."
      />
      <OngletsPortail />
      {error && (
        <div className="mb-5">
          <ErrorBox titre={data ? "Rechargement impossible : les chiffres affichés peuvent dater." : undefined} error={error} onRetry={() => void mutate()} />
        </div>
      )}
      {!data ? (
        !error && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Squelette key={i} className="h-[128px]" />
            ))}
          </div>
        )
      ) : (
        <Contenu s={data} />
      )}
    </div>
  );
}

function Contenu({ s }: { s: Synthese }) {
  const moyenne = s.feedback.average;
  return (
    <div className="space-y-6">
      <section aria-label="Chiffres clés" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Porteurs inscrits"
          value={fmtInt(s.porteurs.total)}
          tone={s.porteurs.never > 0 ? "warn" : "neutral"}
          hint={`${pluriel(s.porteurs.active_30d, "actif", "actifs")} sur 30 jours, ${pluriel(s.porteurs.never, "jamais connecté", "jamais connectés")}`}
        />
        <Kpi
          label="Messages non lus"
          value={fmtInt(s.messages.unread)}
          tone={s.messages.waiting > 0 ? "warn" : "neutral"}
          hint={s.messages.waiting ? `${pluriel(s.messages.waiting, "conversation", "conversations")} en attente de réponse` : "Aucune conversation en attente"}
        />
        <Kpi
          label="Rendez-vous demandés"
          value={fmtInt(s.meetings.requested)}
          tone={s.meetings.requested > 0 ? "warn" : "neutral"}
          hint={`${pluriel(s.meetings.upcoming, "rendez-vous confirmé", "rendez-vous confirmés")} à venir`}
        />
        <Kpi
          label="Comptes rendus à valider"
          value={fmtInt(s.actions_submitted)}
          tone={s.actions_submitted > 0 ? "warn" : "neutral"}
          hint="Actions déclarées faites par les porteurs"
        />
        <Kpi
          label="Événements à venir"
          value={fmtInt(s.events.upcoming)}
          hint={pluriel(s.events.registrations, "inscription confirmée", "inscriptions confirmées")}
        />
        <Kpi
          label="Satisfaction des porteurs"
          value={moyenne === null ? "–" : `${fmtFixe(moyenne, 1)} / 5`}
          tone={toneSatisfaction(moyenne)}
          hint={s.feedback.count ? `NPS ${s.feedback.nps === null ? "non calculé" : signe(s.feedback.nps)}, sur ${pluriel(s.feedback.count, "avis", "avis")}` : "Aucun avis reçu"}
        />
        <Kpi
          label="Contenus publiés"
          value={fmtInt(s.articles.published)}
          tone={s.articles.drafts > 0 ? "warn" : "neutral"}
          hint={`${pluriel(s.articles.views, "lecture")}${s.articles.drafts ? `, ${pluriel(s.articles.drafts, "brouillon")} à relire` : ""}`}
        />
        <Kpi
          label="Accusés de lecture en attente"
          value={fmtInt(s.announcements.ack_pending)}
          tone={s.announcements.ack_pending > 0 ? "warn" : "neutral"}
          hint={`Porteurs visés sans accusé, sur ${pluriel(s.announcements.published, "communication publiée", "communications publiées")}`}
        />
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card title="À traiter" className="xl:col-span-8" padded={false} actions={<span className="text-[12.5px] text-muted">{pluriel(s.to_do.length, "élément", "éléments")}</span>}>
          {s.to_do.length === 0 ? (
            <Empty title="Rien à traiter pour l'instant." hint="Les demandes de rendez-vous, les messages en attente de réponse et les comptes rendus des porteurs apparaîtront ici." />
          ) : (
            <ul className="divide-y divide-line">
              {s.to_do.map((t, i) => {
                const k = A_FAIRE[t.kind];
                return (
                  <li key={`${t.kind}-${i}`}>
                    <Link href={t.link} className="group flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-accent-doux/40 focus-visible:bg-accent-doux/40">
                      <IconTile icon={k.icon} teinte={k.teinte} className="h-9 w-9" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{t.title}</span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {k.label}
                          {t.detail ? `, ${t.detail}` : ""}
                        </span>
                      </span>
                      {t.date && <span className="hidden whitespace-nowrap text-[12.5px] text-muted sm:block">{quand(t.date)}</span>}
                      <ArrowRight aria-hidden className="h-4 w-4 flex-none text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Accès rapides" className="xl:col-span-4" padded={false}>
          <ul className="divide-y divide-line">
            <Raccourci href="/axispro/portail/messages" icon={Mail} teinte="ambre" titre="Répondre aux porteurs" detail={s.messages.waiting ? `${pluriel(s.messages.waiting, "conversation", "conversations")} en attente` : "Messagerie de tous les dossiers"} />
            <Raccourci href="/axispro/portail/communications" icon={Sparkles} teinte="or" titre="Écrire une communication" detail={s.announcements.ack_pending ? `${pluriel(s.announcements.ack_pending, "accusé", "accusés")} de lecture en attente` : "Information, opportunité, alerte"} />
            <Raccourci href="/axispro/portail/ressources" icon={BookOpen} teinte="lagon" titre="Centre de ressources" detail={s.articles.drafts ? `${pluriel(s.articles.drafts, "brouillon", "brouillons")} à relire avant publication` : "Guides, fiches, modèles"} />
            <Raccourci href="/axispro/portail/evenements" icon={Users} teinte="jade" titre="Événements et formations" detail={`${pluriel(s.events.upcoming, "événement", "événements")} à venir`} />
            <Raccourci href="/axispro/portail/rendez-vous" icon={Calendar} teinte="azur" titre="Rendez-vous" detail={s.meetings.requested ? `${pluriel(s.meetings.requested, "demande", "demandes")} à traiter` : "Planifier un rendez-vous"} />
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Raccourci({ href, icon, teinte, titre, detail }: { href: string; icon: Icon; teinte: Teinte; titre: string; detail: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3.5 px-6 py-3 transition-colors hover:bg-panel-2">
        <IconTile icon={icon} teinte={teinte} className="h-9 w-9" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{titre}</span>
          <span className="block truncate text-[12.5px] text-muted">{detail}</span>
        </span>
        <ArrowRight aria-hidden className="h-4 w-4 flex-none text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
      </Link>
    </li>
  );
}

