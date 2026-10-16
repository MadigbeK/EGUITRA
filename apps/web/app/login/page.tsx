import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { LogoSociete, MarqueCabinet, Monogramme, SIGNATURE } from "@/components/brand";
import { Check, FileText, FolderOpen, Landmark, Mail, Truck } from "@/components/icons";
import { APPS, appFromHost, isAppCode, type AppCode } from "@/lib/config";
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
  const next = safeNext(params.next) ?? APPS[app].home;
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
              <Monogramme className="h-11 w-11 drop-shadow-[0_8px_14px_rgb(20_47_41/0.3)]" />
              <span className="leading-none">
                <span className="block font-display text-[21px] font-bold tracking-[0.06em] text-ink">NIMOVA</span>
                <span className="mt-1 block text-[12.5px] font-semibold text-accent">{app === "mobile" ? "Rotations" : app === "axispro" ? "AxisPro" : "Finance"}</span>
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
 * Scène de la marque NIMOVA : le grand N du monogramme se trace en fond, le nom et la signature
 * entrent, trois fragments des vrais écrans (trésorerie, rotations, évaluation des dossiers)
 * surgissent puis flottent doucement. Aucun chiffre : ce ne sont pas des données.
 */
function SceneNimova() {
  const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "Africa/Conakry" }).format(new Date());
  return (
    <aside className="sur-dos relative order-first overflow-hidden bg-[linear-gradient(150deg,#1d4a3b_0%,#142f29_46%,#0d221d_100%)] text-white lg:order-2 lg:min-h-screen">
      {/* Le N du monogramme, en grand, tracé au chargement */}
      <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-24 -top-10 hidden h-[118%] lg:block" focusable="false">
        <path d="M120 80h70l290 440h-70Z" fill="none" stroke="#d3aa5b" strokeOpacity="0.35" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "300ms" } as CSSProperties} />
        <path d="M120 80h70v440h-70ZM410 80h70v440h-70Z" fill="none" stroke="#a5e6c2" strokeOpacity="0.28" strokeWidth="2" pathLength={1} className="n-tracer" style={{ "--retard": "100ms" } as CSSProperties} />
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

          {/* Fragments des écrans */}
          <div aria-hidden className="pointer-events-none relative mt-12 hidden h-[300px] xl:block">
            <Fragment className="left-0 top-0 w-[268px]" i={4} flotte="0s">
              <EnteteFragment titre="Trésorerie" icone={<Landmark className="h-4 w-4" />} couleur="#12956a" fond="#e2f5ea" />
              <svg viewBox="0 0 240 70" className="mt-3 h-[70px] w-full" focusable="false">
                <defs>
                  <linearGradient id="fragment-aire" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#12956a" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#12956a" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0 52 C30 48 40 30 70 34 S120 54 150 36 S200 12 240 16 V70 H0 Z" fill="url(#fragment-aire)" className="n-apparaitre" style={{ animationDelay: "900ms", animationDuration: "900ms" }} />
                <path d="M0 52 C30 48 40 30 70 34 S120 54 150 36 S200 12 240 16" fill="none" stroke="#12956a" strokeWidth="2.5" strokeLinecap="round" pathLength={1} className="n-tracer" style={{ "--retard": "700ms" } as CSSProperties} />
                <circle cx="236" cy="17" r="4.5" fill="#12956a" stroke="#fff" strokeWidth="2" className="n-apparaitre" style={{ animationDelay: "1900ms" }} />
              </svg>
              <div className="mt-2 flex gap-1.5">
                {[62, 84, 48, 72].map((w, k) => (
                  <span key={k} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e9efeb]">
                    <span className="n-pousser-x block h-full rounded-full" style={{ width: `${w}%`, background: ["#12956a", "#2d82dc", "#df8f17", "#c4417a"][k], "--i": k + 8 } as CSSProperties} />
                  </span>
                ))}
              </div>
            </Fragment>

            <Fragment className="left-[236px] top-[118px] w-[252px]" i={5} flotte="-2s">
              <EnteteFragment titre="Rotations" icone={<Truck className="h-4 w-4" />} couleur="#b83e16" fond="#fdebe4" />
              <div className="relative mt-3 h-[74px]">
                <svg viewBox="0 0 220 74" className="absolute inset-0 h-full w-full" focusable="false">
                  <path d="M14 58 C60 58 70 18 120 22 S190 40 206 16" fill="none" stroke="#e1e8e3" strokeWidth="6" strokeLinecap="round" />
                  <path d="M14 58 C60 58 70 18 120 22 S190 40 206 16" fill="none" stroke="#e25f35" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" />
                  <circle cx="14" cy="58" r="6" fill="#fff" stroke="#e25f35" strokeWidth="3" />
                  <circle cx="206" cy="16" r="6" fill="#e25f35" />
                </svg>
                <span className="n-route absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full bg-[#e25f35] text-white shadow-[0_6px_14px_-4px_rgb(226_95_53/0.7)]" style={{ offsetPath: "path('M14 58 C60 58 70 18 120 22 S190 40 206 16')", animation: "n-route 5.5s cubic-bezier(0.45,0,0.55,1) infinite alternate" }}>
                  <Truck className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-1 flex justify-between text-[11.5px] font-semibold text-[#5c6e66]">
                <span>Dépôt</span>
                <span>Client</span>
              </div>
            </Fragment>

            <Fragment className="left-[30px] top-[196px] w-[214px]" i={6} flotte="-4s">
              <EnteteFragment titre="Dossiers AxisPro" icone={<FolderOpen className="h-4 w-4" />} couleur="#1a64bd" fond="#e6f0fc" />
              <div className="mt-3.5 flex items-center">
                {[0, 1, 2, 3].map((k) => (
                  <span key={k} className="flex flex-1 items-center last:flex-none">
                    <span
                      className={k < 2 ? "grid h-6 w-6 place-items-center rounded-full bg-[linear-gradient(135deg,#1f73d6,#134f97)] text-white" : k === 2 ? "n-pouls h-6 w-6 rounded-full bg-[#d3aa5b]" : "h-6 w-6 rounded-full border-2 border-[#c4cfc8] bg-white"}
                      style={k === 2 ? ({ "--pouls": "rgb(211 170 91 / 0.6)" } as CSSProperties) : undefined}
                    >
                      {k < 2 && <Check className="h-3.5 w-3.5" strokeWidth={2.6} />}
                    </span>
                    {k < 3 && (
                      <span className="mx-1 h-[3px] flex-1 overflow-hidden rounded-full bg-[#e1e8e3]">
                        {k < 2 && <span className="n-pousser-x block h-full w-full rounded-full bg-[#2d82dc]" style={{ "--i": k + 10 } as CSSProperties} />}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </Fragment>
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

/** Fragment d'écran : une carte blanche qui surgit puis flotte. */
function Fragment({ className, i, flotte, children }: { className: string; i: number; flotte: string; children: React.ReactNode }) {
  return (
    <div className={`absolute ${className}`}>
      <div className="n-entree" style={{ "--i": i } as CSSProperties}>
        <div className="n-flotter rounded-2xl bg-white p-4 text-[#10241f] shadow-[0_30px_60px_-24px_rgb(0_0_0/0.55),0_2px_8px_rgb(0_0_0/0.12)]" style={{ animationDelay: flotte }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function EnteteFragment({ titre, icone, couleur, fond }: { titre: string; icone: React.ReactNode; couleur: string; fond: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-semibold">{titre}</span>
      <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: fond, color: couleur }}>
        {icone}
      </span>
    </div>
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
