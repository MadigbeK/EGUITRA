import type { Metadata } from "next";
import { PageErreur } from "@/components/PageErreur";
import { APPS, ESPACES, isAppCode, type AppCode } from "@/lib/config";
import { serverApi } from "@/lib/server-api";
import type { Me } from "@/lib/types";

export const metadata: Metadata = { title: { absolute: "Accès refusé · NIMOVA" } };

/** Ordre de préférence de l'application vers laquelle on renvoie un compte refusé ailleurs. */
const PREFERENCE: AppCode[] = [...ESPACES, "portail", "mobile"];

/**
 * Application ou écran que le profil du compte n'ouvre pas : on dit lequel, on ramène à une
 * application que le compte peut ouvrir, et rien du contenu refusé n'est chargé ni montré.
 */
export default async function AccesRefuse({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { app } = await searchParams;
  // Le profil se lit sous une application sans société imposée : il répond quel que soit le compte.
  const me = await serverApi<Me>("/auth/me", "finance");
  const ouverte = PREFERENCE.find((a) => me.apps.includes(a));
  const nom = isAppCode(app) ? APPS[app].name : "cet écran";
  return (
    <PageErreur
      code="403"
      titre="Accès non ouvert à votre profil"
      texte={`Votre profil ne donne pas accès à ${nom}. Si votre travail le demande, l'administrateur de la plateforme peut vous ouvrir ce profil.`}
      retour={ouverte ? { href: APPS[ouverte].home, label: `Aller à ${APPS[ouverte].name.replace("NIMOVA · ", "")}` } : { href: "/login", label: "Revenir à la connexion" }}
    />
  );
}
