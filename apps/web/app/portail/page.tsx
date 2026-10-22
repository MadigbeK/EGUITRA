"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Calculator, Clock, FileUp, HandCoins, Mail, Sparkles } from "@/components/icons";
import { Anneau, Badge, Card, Empty, ErrorBox, Etapes, FEUILLE, Loading, cx, type Tone } from "@/components/ui";
import { KIND_ICON, dateLongue, quand } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { useApi } from "@/lib/api-client";
import { fmtShort } from "@/lib/format";
import type { NextStep, Tableau } from "@/lib/portail-types";

const URGENCE: Record<NextStep["urgency"], { tone: Tone; label: string; trait: string }> = {
  high: { tone: "danger", label: "Prioritaire", trait: "bg-danger" },
  normal: { tone: "accent", label: "À faire", trait: "bg-accent-vif" },
  low: { tone: "neutral", label: "Quand vous pouvez", trait: "bg-line-strong" },
};

const DECISION_TONE: Record<string, Tone> = { go: "ok", conditional: "ok", hold: "warn", no_go: "danger", postponed: "warn" };

function salutation() {
  const h = new Date().getHours();
  return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}

export default function AccueilPortail() {
  const { espace, dossier, me } = usePortail();
  const { data, error, mutate } = useApi<Tableau>(dossier ? `/portail/dossiers/${dossier.id}/tableau` : null);
  if (espace && !espace.dossiers.length) {
    return (
      <Card>
        <Empty title="Aucun dossier n'est encore ouvert à votre nom." hint="Votre consultant MB AxisPro vous informera dès son ouverture." />
      </Card>
    );
  }
  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Préparation de votre espace…" />;
  const d = data.dossier;
  const p = data.preparation;
  const prenom = me.name.split(" ")[0];
  const raccourcis = [
    { href: "/portail/pieces", label: "Déposer une pièce", icon: FileUp },
    { href: "/portail/messages", label: "Écrire au cabinet", icon: Mail },
    { href: "/portail/rendez-vous", label: "Demander un rendez-vous", icon: Clock },
    { href: "/portail/outils", label: "Simuler un prêt", icon: Calculator },
  ];

  return (
    <div className="space-y-6">
      {/* Bandeau : le projet, son étape, sa préparation */}
      <section className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(125deg,#16304e_0%,#1f4a7a_48%,#137c86_100%)] p-6 text-white shadow-[0_30px_60px_-36px_rgb(16_40_70/0.7)] sm:p-8">
        <svg aria-hidden viewBox="0 0 400 400" className="pointer-events-none absolute -right-24 -top-28 h-[420px] w-[420px] opacity-[0.13]">
          {[60, 100, 140, 180].map((r) => <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="white" strokeWidth="1.2" />)}
          <path d="M40 300 C 140 220, 260 300, 360 140" fill="none" stroke="white" strokeWidth="2" />
        </svg>
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-white/70">{salutation()} {prenom},</div>
            <h1 className="mt-1 font-display text-[28px] font-bold leading-tight sm:text-[34px]">{d.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/75">
              <span className="rounded-full bg-white/12 px-2.5 py-1 font-semibold text-white">{d.reference}</span>
              {d.sector && <span>{d.sector}</span>}
              {d.location && <span>· {d.location}</span>}
              {d.state !== "open" && <span className="rounded-full bg-amber-300/25 px-2.5 py-1 font-semibold text-amber-50">{d.state === "closed" ? "Dossier clos" : "Dossier suspendu"}</span>}
            </div>
            {d.decision_label && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/12 px-3 py-2 text-[13.5px]">
                <Badge tone={DECISION_TONE[d.decision ?? ""] ?? "neutral"}>{d.decision_label}</Badge>
                <span className="text-white/85">Dernière décision du comité</span>
              </div>
            )}
            <div className="mt-6 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10 [&_*]:!text-white/90">
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] !text-white/60">Parcours du dossier</div>
              <Etapes steps={d.gates.map((g) => ({ key: g.code, label: g.name, state: g.current ? "current" : g.reached ? "done" : "todo" }))} />
            </div>
          </div>
          <div className="flex items-center gap-5 lg:flex-col lg:gap-3">
            <Anneau value={p.score} taille={150} epaisseur={12} couleur="#7fd3ff" centre={`${p.score} %`} sous="préparation" clair />
            <div className="space-y-1 text-[12.5px] text-white/75 lg:text-center">
              <div><b className="text-white">{p.pieces.validated + p.pieces.received}</b> pièce{p.pieces.validated + p.pieces.received > 1 ? "s" : ""} sur {p.pieces.due} attendue{p.pieces.due > 1 ? "s" : ""}</div>
              <div><b className="text-white">{p.actions.done}</b> action{p.actions.done > 1 ? "s" : ""} validée{p.actions.done > 1 ? "s" : ""} sur {p.actions.total}</div>
              <div>Étape <b className="text-white">{p.gates.reached}</b> sur {p.gates.total}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Raccourcis */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {raccourcis.map((r) => {
          const I = r.icon;
          return (
            <Link key={r.href} href={r.href} className={cx(FEUILLE, "group flex items-center gap-3 px-4 py-3.5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:ring-1 hover:ring-accent-vif/40")}>
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent-doux text-accent transition-colors group-hover:bg-accent group-hover:text-white"><I className="h-5 w-5" /></span>
              <span className="text-[13.5px] font-semibold leading-snug text-ink">{r.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        {/* Prochaines étapes */}
        <Card title="Vos prochaines étapes" className="xl:col-span-7" actions={<Link href="/portail/actions" className="text-[13px] font-semibold text-accent hover:underline">Plan d'actions</Link>}>
          {data.next_steps.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-ok-doux px-4 py-4 text-sm text-ink">
              <Sparkles className="h-5 w-5 text-ok" /> Rien ne vous attend pour l'instant : votre dossier est entre les mains du cabinet.
            </div>
          ) : (
            <ul className="space-y-2">
              {data.next_steps.map((s, i) => {
                const I = KIND_ICON[s.kind];
                const u = URGENCE[s.urgency];
                return (
                  <li key={`${s.kind}-${i}`}>
                    <Link href={s.link} className="group relative flex items-start gap-3 overflow-hidden rounded-xl border border-line bg-panel px-4 py-3 transition-colors hover:border-line-strong hover:bg-panel-2/60">
                      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", u.trait)} />
                      <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-panel-2 text-accent"><I className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold leading-snug text-ink">{s.title}</span>
                        {s.detail && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-muted">{s.detail}</span>}
                      </span>
                      <span className="flex flex-none flex-col items-end gap-1">
                        <Badge tone={u.tone}>{u.label}</Badge>
                        {s.due && <span className="text-[12px] text-muted">{quand(s.due)}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* À venir */}
        <Card title="À venir" className="xl:col-span-5" actions={<Link href="/portail/agenda" className="text-[13px] font-semibold text-accent hover:underline">Agenda</Link>}>
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-muted">Aucun rendez-vous ni échéance prévus. <Link href="/portail/rendez-vous" className="font-semibold text-accent">Demander un rendez-vous</Link></p>
          ) : (
            <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[23px] before:top-2 before:w-px before:bg-line">
              {data.upcoming.map((u, i) => {
                const date = new Date(u.date);
                return (
                  <li key={i}>
                    <Link href={u.link} className="relative flex items-center gap-3 rounded-xl p-1 hover:bg-panel-2">
                      <span className="z-[1] grid h-12 w-12 flex-none place-items-center rounded-xl border border-line bg-panel text-center leading-none shadow-[var(--ombre-feuille)]">
                        <span>
                          <span className="block font-display text-[17px] font-bold text-ink">{date.getDate()}</span>
                          <span className="block text-[10.5px] font-semibold uppercase text-accent">{date.toLocaleDateString("fr-FR", { month: "short" })}</span>
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">{u.title}</span>
                        <span className="block text-[12px] text-muted">
                          {u.kind === "meeting" ? "Rendez-vous" : u.kind === "event" ? (u.registered ? "Événement, vous êtes inscrit" : "Événement du cabinet") : "Échéance d'action"}
                          {u.kind !== "action" && `, ${dateLongue(u.date)}`}
                        </span>
                      </span>
                      <span className="text-[12px] font-medium text-muted">{quand(u.date)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
          <Link href="/portail/projet" className="mt-4 flex items-center gap-3 rounded-xl bg-panel-2 px-4 py-3 hover:bg-panel-3">
            <HandCoins className="h-5 w-5 text-accent" />
            <span className="flex-1 text-[13px] text-ink-2">
              {data.fundings.count ? (
                <>
                  <b className="text-ink">{data.fundings.count}</b> piste{data.fundings.count > 1 ? "s" : ""} de financement, <b className="text-ink">{fmtShort(data.fundings.requested)} {data.fundings.currency}</b> sollicités
                  {data.fundings.granted > 0 && <>, <b className="text-ok">{fmtShort(data.fundings.granted)}</b> accordés</>}
                </>
              ) : (
                "Le cabinet vous présentera ici les financements recherchés."
              )}
            </span>
            <ArrowRight className="h-4 w-4 text-muted" />
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        {/* Fil du projet */}
        <Card title="Fil du projet" className="xl:col-span-5" actions={<Link href="/portail/projet" className="text-[13px] font-semibold text-accent hover:underline">Tout voir</Link>}>
          <ol className="space-y-4">
            {data.timeline.map((t, i) => {
              const I = KIND_ICON[t.kind];
              return (
                <li key={i} className="flex gap-3">
                  <span className="relative flex flex-col items-center">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-doux text-accent"><I className="h-4 w-4" /></span>
                    {i < data.timeline.length - 1 && <span aria-hidden className="mt-1 w-px flex-1 bg-line" />}
                  </span>
                  <span className="min-w-0 pb-1">
                    <span className="block text-[13.5px] font-medium leading-snug text-ink">{t.title}</span>
                    <span className="block text-[12px] text-muted">{quand(t.date)}{t.detail ? `, ${t.detail}` : ""}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-6 xl:col-span-7">
          {/* Actualités */}
          <Card title="Actualités du cabinet" actions={<Link href="/portail/actualites" className="text-[13px] font-semibold text-accent hover:underline">Toutes</Link>}>
            {data.announcements.length === 0 ? (
              <p className="text-sm text-muted">Pas de nouvelle communication.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.announcements.map((a) => (
                  <li key={a.id}>
                    <Link href={`/portail/actualites/${a.id}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      {!a.read && <span aria-hidden className="mt-2 h-2 w-2 flex-none rounded-full bg-accent-vif" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-ink">{a.title}</span>
                          <Badge tone={a.kind === "opportunity" ? "ok" : a.kind === "alert" || a.kind === "important" ? "warn" : "neutral"}>{a.kind_label}</Badge>
                          {a.require_ack && !a.acknowledged && <Badge tone="danger">À confirmer</Badge>}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{a.excerpt}</span>
                      </span>
                      <span className="flex-none text-[12px] text-muted">{quand(a.published_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Conseils */}
          <Card title={`Conseils pour l'étape ${d.current_gate?.name ?? "en cours"}`} actions={<Link href="/portail/ressources" className="text-[13px] font-semibold text-accent hover:underline">Centre de ressources</Link>}>
            {data.articles.length === 0 ? (
              <p className="text-sm text-muted">Le cabinet publiera bientôt des conseils ici.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {data.articles.map((a) => (
                  <Link key={a.id} href={`/portail/ressources/${a.id}`} className="group flex flex-col rounded-xl border border-line p-3.5 transition-[transform,border-color] hover:-translate-y-0.5 hover:border-accent-vif/40">
                    <span className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-accent">
                      {a.kind_label}
                      {a.recommended && <span className="rounded-full bg-accent-doux px-1.5 py-px normal-case tracking-normal">pour vous</span>}
                    </span>
                    <span className="mt-1.5 line-clamp-3 text-[14px] font-semibold leading-snug text-ink">{a.title}</span>
                    <span className="mt-auto flex items-center gap-1 pt-3 text-[12px] text-muted">
                      {a.reading_minutes > 0 && `${a.reading_minutes} min de lecture`}
                      <ArrowUpRight className="ml-auto h-4 w-4 text-muted transition-colors group-hover:text-accent" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
