import type { Metadata } from "next";
import { headers } from "next/headers";
import { Monogramme, SIGNATURE } from "@/components/brand";
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
  if (app === "portail") return { title: { absolute: "Connexion · MB AxisPro Consulting" }, icons: { icon: "/icons/portail.svg" } };
  return { title: "Connexion" };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const app = await appOf(params);
  const next = safeNext(params.next) ?? APPS[app].home;
  const message = (params.error && MESSAGES[params.error]) || (params.message && MESSAGES[params.message]) || null;

  return (
    <div data-app={app} className="min-h-screen bg-panel text-ink lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,13fr)]">
      {app === "portail" ? <CouvertureCabinet /> : <CouvertureNimova />}
      <main className="flex items-center justify-center px-5 pb-12 pt-10 sm:px-10 lg:min-h-screen lg:py-16">
        <div className="w-full max-w-[380px]">
          <LoginForm app={app} next={next} message={message} />
          <p className="mt-12 text-[12px] leading-relaxed text-muted">Accès réservé. Connexions journalisées, double authentification obligatoire.</p>
        </div>
      </main>
    </div>
  );
}

/**
 * Couverture : celle de la note de cadrage du DG (fond forêt, bande verticale, carré vert d'eau
 * portant le monogramme), avec le nom, la mention et la signature de NIMOVA.
 */
function CouvertureNimova() {
  const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "Africa/Conakry" }).format(new Date());
  return (
    <aside className="sur-dos relative overflow-hidden bg-foret text-creme lg:flex lg:min-h-screen lg:flex-col">
      <div aria-hidden className="absolute inset-y-0 right-[13%] hidden w-[72px] bg-pin lg:block" />
      <div aria-hidden className="absolute right-[calc(13%-44px)] top-[11%] hidden h-40 w-40 place-items-center rounded-[34px] bg-menthe lg:grid">
        <Monogramme className="h-[104px] w-[104px]" />
      </div>
      <div className="relative flex flex-col gap-8 px-6 py-8 sm:px-10 lg:flex-1 lg:justify-end lg:gap-14 lg:px-14 lg:py-14">
        <p className="hidden text-[13px] text-creme/60 lg:absolute lg:left-14 lg:top-14 lg:block">Conakry, {today}</p>
        <Monogramme className="h-11 w-11 lg:hidden" />
        <div className="max-w-[440px]">
          <p className="font-display text-[44px] font-semibold leading-none tracking-[0.06em] sm:text-[56px] lg:text-[76px]">NIMOVA</p>
          <p className="mt-3 text-[17px] font-medium text-menthe lg:text-[20px]">Système intégré de gestion</p>
          <div aria-hidden className="mt-6 h-[3px] w-14 bg-or lg:mt-8" />
          <p className="mt-6 max-w-[28ch] text-[17px] leading-snug text-creme/85 lg:mt-8 lg:text-[20px]">{SIGNATURE}</p>
        </div>
        <p className="hidden text-[13px] text-creme/60 lg:block">EGUITRA GROUP et MB AxisPro Consulting</p>
      </div>
    </aside>
  );
}

/** Couverture du portail : la marque du cabinet, en bleu nuit. */
function CouvertureCabinet() {
  return (
    <aside className="sur-dos relative overflow-hidden bg-nuit text-creme lg:flex lg:min-h-screen lg:flex-col">
      <div aria-hidden className="absolute inset-y-0 right-[13%] hidden w-[72px] bg-[#2e4560] lg:block" />
      <div className="relative flex flex-col gap-8 px-6 py-8 sm:px-10 lg:flex-1 lg:justify-end lg:px-14 lg:py-14">
        <div className="max-w-[440px]">
          <p className="font-display text-[44px] font-semibold leading-none sm:text-[56px] lg:text-[68px]">MB AxisPro</p>
          <p className="mt-2 text-[17px] font-medium tracking-[0.04em] text-[#c9d6e3] lg:text-[20px]">Consulting</p>
          <div aria-hidden className="mt-6 h-[3px] w-14 bg-or lg:mt-8" />
          <p className="mt-6 max-w-[30ch] text-[17px] leading-snug text-creme/85 lg:mt-8 lg:text-[20px]">
            Portail des porteurs de projets : votre dossier, vos pièces et vos échanges avec le cabinet.
          </p>
        </div>
      </div>
    </aside>
  );
}
