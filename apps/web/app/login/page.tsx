import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { LogoSociete, MarqueCabinet, Monogramme, SIGNATURE, moduleOf } from "@/components/brand";
import { FileText, FolderOpen, Mail } from "@/components/icons";
import { APPS, appFromHost, isAppCode, isEspaceCode, type AppCode } from "@/lib/config";
import { LoginForm } from "./LoginForm";

const MESSAGES: Record<string, string> = {
  app_forbidden: "Votre profil ne donne pas accès à cette application.",
  password_changed: "Mot de passe modifié. Reconnectez-vous avec le nouveau mot de passe.",
};

type Params = Record<string, string | undefined>;

/**
 * Page de retour après connexion : uniquement un chemin de ce site. Les formes que les navigateurs
 * interprètent comme une autre origine (« //hôte », « /\hôte », caractères de contrôle) sont refusées.
 */
function safeNext(value: string | undefined): string | null {
  if (!value || !/^\/(?![\/\\])/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "http://interne.invalid");
    return url.origin === "http://interne.invalid" ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

async function appOf(params: Params): Promise<AppCode> {
  return isAppCode(params.app) ? params.app : appFromHost((await headers()).get("host"));
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const app = await appOf(await searchParams);
  // Le portail est celui du cabinet : ni le nom ni le monogramme de la marque interne.
  if (app === "portail") return { title: { absolute: "Connexion · MB AxisPro Consulting" }, description: "Portail des porteurs de projets de MB AxisPro Consulting : dossier, pièces et échanges avec le cabinet.", icons: { icon: "/icons/portail.svg" } };
  return { title: "Connexion" };
}

export async function generateViewport({ searchParams }: { searchParams: Promise<Params> }): Promise<Viewport> {
  return { themeColor: (await appOf(await searchParams)) === "portail" ? "#0e1a24" : "#142f29" };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const app = await appOf(params);
  // Finance, AxisPro et Analyse s'ouvrent sur l'accueil NIMOVA, comme l'accueil d'Odoo.
  const next = safeNext(params.next) ?? (isEspaceCode(app) ? "/accueil" : APPS[app].home);
  const message = (params.error && MESSAGES[params.error]) || (params.message && MESSAGES[params.message]) || null;
  const portail = app === "portail";

  return (
    <div data-app={app} className="min-h-screen bg-panel text-ink lg:grid lg:grid-cols-[minmax(0,10fr)_minmax(0,13fr)]">
      <main className="relative flex min-h-[560px] flex-col px-6 pb-8 pt-8 sm:px-12 lg:order-1 lg:min-h-screen lg:px-16 lg:py-12">
        <div className="n-entree" style={{ "--i": 0 } as CSSProperties}>
          {portail ? (
            <MarqueCabinet className="h-10" />
          ) : (
            <span className="inline-flex items-center gap-3">
              <Monogramme tuile={false} className="h-11 w-11" />
              <span className="leading-none">
                <span className="block font-display text-[21px] font-bold tracking-[0.06em] text-ink">NIMOVA</span>
                <span className="mt-1 block text-[12.5px] font-semibold text-accent">{moduleOf(app)}</span>
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-1 items-center py-10">
          <div className="n-entree w-full max-w-[400px]" style={{ "--i": 1 } as CSSProperties}>
            <LoginForm app={app} next={next} message={message} />
          </div>
        </div>
        <div className="n-entree space-y-4" style={{ "--i": 3 } as CSSProperties}>
          {!portail && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <LogoSociete entite="groupe" variante="complet" className="h-9" />
              <span aria-hidden className="h-7 w-px bg-line" />
              <LogoSociete entite="cabinet" variante="complet" className="h-7" />
            </div>
          )}
          <p className="text-[12px] leading-relaxed text-muted">Accès réservé. Connexions journalisées, double authentification obligatoire.</p>
        </div>
      </main>
      {portail ? <ScenePortail /> : <SceneNimova />}
    </div>
  );
}

/**
 * Scène de la marque NIMOVA : une équipe en salle de réunion (photo Pexels 9301288, licence
 * gratuite), assombrie pour la lecture ; le grand N du pli se trace par-dessus, le nom et la
 * signature entrent. La photo est servie en WebP à la taille de l'écran, `public/scenes/`.
 */
function SceneNimova() {
  const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "Africa/Conakry" }).format(new Date());
  return (
    <aside className="sur-dos relative order-first overflow-hidden bg-foret text-white lg:order-2 lg:min-h-screen">
      <picture aria-hidden className="pointer-events-none absolute inset-0">
        <source type="image/webp" media="(min-width: 1024px)" srcSet="/scenes/connexion-1400.webp 1400w, /scenes/connexion-2200.webp 2200w" sizes="58vw" />
        <source type="image/webp" srcSet="/scenes/connexion-mobile-900.webp 900w, /scenes/connexion-mobile-1600.webp 1600w" sizes="100vw" />
        {/* eslint-disable-next-line @next/next/no-img-element -- image décorative déjà optimisée, servie telle quelle */}
        <img src="/scenes/connexion-1400.jpg" alt="" fetchPriority="high" decoding="async" className="scene-photo h-full w-full object-cover object-[50%_40%]" />
      </picture>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(13_34_29/0.82)_0%,rgb(13_34_29/0.35)_42%,rgb(13_34_29/0.55)_70%,rgb(13_34_29/0.9)_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(13_34_29/0.75)_0%,rgb(13_34_29/0.2)_60%,transparent_100%)]" />
      {/* Le N du pli, en grand, tracé au chargement */}
      <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-24 -top-10 hidden h-[118%] lg:block" focusable="false">
        {/* Le pli de la marque, tracé au trait : montants, diagonale d'or, et les deux plis du ruban. */}
        <path d="M100 80h120v440H100ZM420 80h120v440H420Z" fill="none" stroke="#a5e6c2" strokeOpacity="0.5" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "100ms" } as CSSProperties} />
        <path d="M100 80h120l320 440H420Z" fill="none" stroke="#d3aa5b" strokeOpacity="0.7" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "300ms" } as CSSProperties} />
        <path d="M220 80v165M420 355v165" fill="none" stroke="#d3aa5b" strokeOpacity="0.5" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "700ms" } as CSSProperties} />
      </svg>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-[16%] hidden w-[72px] bg-[#22634c]/45 lg:block" />

      <div className="relative z-10 flex h-full flex-col justify-between gap-10 px-6 py-8 sm:px-12 lg:px-14 lg:py-12">
        <p className="n-entree hidden text-[13px] font-medium capitalize text-menthe/70 lg:block" style={{ "--i": 1 } as CSSProperties}>
          Conakry, {today}
        </p>

        <div className="relative">
          <div className="n-entree max-w-[460px]" style={{ "--i": 2 } as CSSProperties}>
            <p className="font-display text-[48px] font-bold leading-none tracking-[0.04em] sm:text-[64px] lg:text-[84px]">NIMOVA</p>
            <p className="mt-3 text-[17px] font-semibold text-menthe lg:text-[20px]">Système intégré de gestion</p>
            <div aria-hidden className="n-pousser-x mt-6 h-[3px] w-16 rounded-full bg-or" style={{ "--i": 6 } as CSSProperties} />
            <p className="mt-6 max-w-[26ch] text-[18px] leading-snug text-white/85 lg:text-[21px]">{SIGNATURE}</p>
          </div>
        </div>

        <div className="n-entree hidden items-center gap-6 lg:flex" style={{ "--i": 4 } as CSSProperties}>
          <LogoSociete entite="groupe" variante="complet" clair className="h-10 opacity-90" />
          <span aria-hidden className="h-8 w-px bg-white/20" />
          <LogoSociete entite="cabinet" variante="complet" clair className="h-8 opacity-90" />
        </div>
      </div>
    </aside>
  );
}

/**
 * Scène du portail : la marque du cabinet, son escalier qui monte marche après marche (le projet
 * qui progresse), et ce que le porteur trouve dans son espace.
 */
function ScenePortail() {
  return (
    <aside className="sur-dos relative order-first overflow-hidden bg-[linear-gradient(150deg,#1b3047_0%,#0e1a24_55%,#081118_100%)] text-white lg:order-2 lg:min-h-screen">
      <svg aria-hidden viewBox="0 0 400 400" className="pointer-events-none absolute -bottom-10 -right-10 hidden h-[78%] lg:block" focusable="false">
        <circle cx="210" cy="190" r="170" fill="none" stroke="#2d82dc" strokeOpacity="0.35" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "200ms" } as CSSProperties} />
        {[0, 1, 2, 3].map((k) => (
          <rect key={k} x={70 + k * 52} y={290 - k * 46} width={150} height={16} rx={4} fill="#ffffff" fillOpacity={0.12 + k * 0.08} className="n-pousser-x" style={{ "--i": k + 3 } as CSSProperties} />
        ))}
        <circle cx="300" cy="80" r="16" fill="#2d82dc" className="n-apparaitre" style={{ animationDelay: "900ms" }} />
        <circle cx="352" cy="140" r="9" fill="#ffffff" fillOpacity="0.6" className="n-apparaitre" style={{ animationDelay: "1100ms" }} />
        <circle cx="236" cy="56" r="6" fill="#d3aa5b" className="n-apparaitre" style={{ animationDelay: "1300ms" }} />
      </svg>
      <div className="relative z-10 flex h-full flex-col justify-between gap-10 px-6 py-8 sm:px-12 lg:px-14 lg:py-12">
        <div className="n-entree" style={{ "--i": 1 } as CSSProperties}>
          <MarqueCabinet clair className="h-11 lg:h-14" />
        </div>
        <div className="n-entree max-w-[460px]" style={{ "--i": 2 } as CSSProperties}>
          <p className="font-display text-[34px] font-bold leading-[1.08] sm:text-[44px] lg:text-[52px]">Portail des porteurs de projets</p>
          <div aria-hidden className="n-pousser-x mt-6 h-[3px] w-16 rounded-full bg-[#2d82dc]" style={{ "--i": 6 } as CSSProperties} />
          <ul className="mt-7 space-y-3 text-[16px] text-white/85">
            {[
              [FolderOpen, "Votre dossier et l'avancement de son évaluation"],
              [FileText, "Les pièces à déposer et celles déjà reçues"],
              [Mail, "Vos échanges avec le cabinet"],
            ].map(([I, texte], k) => {
              const Icone = I as typeof FolderOpen;
              return (
                <li key={k} className="n-entree flex items-center gap-3" style={{ "--i": k + 3 } as CSSProperties}>
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-white/10 text-[#8cc2f5]">
                    <Icone className="h-[18px] w-[18px]" />
                  </span>
                  {texte as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="hidden text-[13px] text-white/55 lg:block">MB AxisPro Consulting, cabinet d&apos;accompagnement des porteurs de projets</p>
      </div>
    </aside>
  );
}
