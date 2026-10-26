"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { ArrowUpRight, X } from "@/components/icons";
import { cx } from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import type { AppCode } from "@/lib/config";
import { CLE_NON_LUS, RELECTURE_NON_LUS_MS, discussionOuverte, lireDiscret, surMiseAJour, surOuverture, type Cible, type NonLus } from "@/lib/discussions";
import type { Me } from "@/lib/types";
import { IconeDiscussion } from "./IconeDiscussion";
import { Messagerie, type Vue } from "./Messagerie";

/**
 * Discussion interne dans l'en-tête de la coque : une icône avec le nombre de messages non lus (relu
 * toutes les 30 secondes, onglet visible), qui ouvre un panneau latéral (plein écran sur le téléphone).
 * Le bouton « Discussion » des fiches l'ouvre sur la conversation de la fiche (ouvrirDiscussion).
 * Absente du portail des porteurs, de Rotations et d'une session au mot de passe provisoire.
 *
 * Le panneau est rendu à la fin du document (portail React) : au-dessus des fiches ouvertes en
 * fenêtre, sous les fenêtres d'alerte (« Êtes-vous toujours là ? ») et de reconnexion.
 */
export function Discussions({ app, me }: { app: AppCode; me: Me }) {
  if (app === "portail" || app === "mobile" || !discussionOuverte(me)) return null;
  return <DiscussionsActives app={app} />;
}

function vueDe(cible: Cible): Vue {
  if ("conversation" in cible) return { ecran: "fil", id: cible.conversation };
  if ("objet" in cible) return { ecran: "fiche", model: cible.objet.model, id: cible.objet.id };
  if ("nouvelle" in cible) return { ecran: "nouvelle" };
  return { ecran: "liste" };
}

const lireNonLus = (cle: string) => lireDiscret<NonLus>(cle);

function DiscussionsActives({ app }: { app: AppCode }) {
  const pathname = usePathname();
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState<Vue>({ ecran: "liste" });
  const [arret, setArret] = useState(false);
  const [annonce, setAnnonce] = useState("");
  const bouton = useRef<HTMLButtonElement>(null);
  const declencheur = useRef<HTMLElement | null>(null);
  const precedent = useRef<number | null>(null);
  const { data, mutate } = useSWR<NonLus, ApiError>(CLE_NON_LUS, lireNonLus, {
    refreshInterval: arret ? 0 : RELECTURE_NON_LUS_MS,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    onError: (e) => {
      // Session expirée ou compte refusé : plus de relecture (le prochain geste proposera de se reconnecter).
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setArret(true);
    },
  });
  const nonLus = data?.unread ?? 0;

  // Un message arrivé pendant que le panneau est fermé est annoncé, une fois, aux lecteurs d'écran.
  useEffect(() => {
    if (data === undefined) return;
    if (precedent.current !== null && data.unread > precedent.current && !ouvert) {
      setAnnonce(data.unread > 1 ? `Discussion : ${data.unread} messages non lus.` : "Discussion : un message non lu.");
    }
    precedent.current = data.unread;
  }, [data, ouvert]);

  useEffect(() => surMiseAJour(() => void mutate()), [mutate]);

  const ouvrir = useCallback((cible: Cible) => {
    if (!document.querySelector("[data-panneau-discussion]")) declencheur.current = document.activeElement instanceof HTMLElement ? document.activeElement : bouton.current;
    setVue(vueDe(cible));
    setOuvert(true);
  }, []);
  useEffect(() => surOuverture(ouvrir), [ouvrir]);

  const fermer = useCallback(() => {
    setOuvert(false);
    const retour = declencheur.current;
    declencheur.current = null;
    window.setTimeout(() => (retour?.isConnected ? retour : bouton.current)?.focus(), 0);
  }, []);

  // Changement d'écran (lien « Fiche », plein écran) : le panneau se referme.
  const chemin = useRef(pathname);
  useEffect(() => {
    if (chemin.current !== pathname) setOuvert(false);
    chemin.current = pathname;
  }, [pathname]);

  const libelle = nonLus > 0 ? `Discussion, ${nonLus > 1 ? `${nonLus} messages non lus` : "un message non lu"}` : "Discussion";
  return (
    <>
      <button
        ref={bouton}
        type="button"
        onClick={() => ouvrir({})}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label={libelle}
        title="Discussion"
        className="relative grid h-10 w-10 flex-none place-items-center rounded-xl text-ink-2 transition-colors hover:bg-panel/80 hover:text-ink"
      >
        <IconeDiscussion className="h-[20px] w-[20px]" />
        {nonLus > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent-vif px-1 text-center text-[10.5px] font-bold leading-[18px] tabular text-white shadow-[0_0_0_2px_var(--bg)]">
            {nonLus > 99 ? "99+" : nonLus}
          </span>
        )}
      </button>
      <p aria-live="polite" className="sr-only">
        {annonce}
      </p>
      {ouvert && <Panneau app={app} vue={vue} onVue={setVue} onFermer={fermer} />}
    </>
  );
}

/** Thème de la coque (application, société, mode nuit), recopié sur le panneau rendu hors d'elle. */
function themeDeLaCoque(app: AppCode) {
  const coque = document.querySelector<HTMLElement>("[data-societe-id]");
  return {
    app: coque?.dataset.app ?? app,
    societe: coque?.dataset.societe,
    theme: coque?.closest<HTMLElement>("[data-theme]")?.dataset.theme,
  };
}

function Panneau({ app, vue, onVue, onFermer }: { app: AppCode; vue: Vue; onVue: (v: Vue) => void; onFermer: () => void }) {
  const boite = useRef<HTMLDivElement>(null);
  const titreId = useId();
  const [theme] = useState(() => themeDeLaCoque(app));

  // Ouverture : le panneau glisse depuis la droite (sauf mouvement réduit), le focus entre dans la vue.
  useEffect(() => {
    const el = boite.current;
    if (!el) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.animate([{ transform: "translateX(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
    (el.querySelector<HTMLElement>("[data-titre-vue]") ?? el).focus();
  }, []);

  function touche(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Une fiche ouverte en fenêtre sous le panneau ne se ferme pas avec lui.
      e.stopPropagation();
      onFermer();
      return;
    }
    if (e.key !== "Tab" || !boite.current) return;
    e.stopPropagation();
    const cibles = [...boite.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null || x === document.activeElement);
    const debut = cibles[0];
    const fin = cibles[cibles.length - 1];
    if (!debut || !fin) return;
    if (e.shiftKey && (document.activeElement === debut || !boite.current.contains(document.activeElement) || document.activeElement === boite.current)) {
      e.preventDefault();
      fin.focus();
    } else if (!e.shiftKey && document.activeElement === fin) {
      e.preventDefault();
      debut.focus();
    }
  }

  const pleinEcran = vue.ecran === "fil" || vue.ecran === "membres" ? `/discussions?c=${vue.id}` : "/discussions";
  return createPortal(
    <div data-app={theme.app} data-societe={theme.societe} data-theme={theme.theme} data-panneau-discussion="" className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="n-apparaitre absolute inset-0 bg-foret/30" onClick={onFermer} />
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titreId}
        tabIndex={-1}
        onKeyDown={touche}
        className="relative flex h-full w-full flex-col bg-panel text-ink shadow-[var(--ombre-flottante)] outline-none sm:w-[420px] sm:max-w-[calc(100vw-48px)]"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <IconeDiscussion className="h-5 w-5 flex-none text-accent" />
          <h2 id={titreId} className="min-w-0 flex-1 truncate font-display text-[17px] font-bold text-ink">
            Discussion
          </h2>
          <Link href={pleinEcran} className="hidden items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-accent hover:bg-accent-doux md:inline-flex" title="Ouvrir la discussion en pleine page">
            Pleine page <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <button type="button" onClick={onFermer} className={cx("grid h-9 w-9 flex-none place-items-center rounded-xl text-muted transition-colors hover:bg-panel-3 hover:text-ink")} aria-label="Fermer la discussion">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Messagerie mode="panneau" vue={vue} onVue={onVue} />
      </div>
    </div>,
    document.body,
  );
}
