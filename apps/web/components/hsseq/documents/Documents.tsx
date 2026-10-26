"use client";

/**
 * Documents et urgences de NIMOVA · HSSEQ (lot 3, §3 et §9.4) : documents à lire du compte et leur
 * accusé, procédures versionnées et leur lecture, alertes flash et retours d'expérience anonymisés,
 * plans d'intervention d'urgence et exercices, annuaire de crise. Onglet, filtres et fiche ouverte
 * portés par l'adresse (`vue`, puis les paramètres propres à chaque onglet) : un lien partage la fiche
 * d'une procédure, d'une alerte, d'un plan ou d'un exercice. Procédures et alertes ne sont pas ouvertes
 * au chef de parc ; l'auditeur lit ce qui relève de ses sites, sans aucune commande ni nom de lecteur,
 * et n'a pas de document à lire (aucun document ne vise son profil).
 */

import { useState } from "react";
import { Download } from "@/components/icons";
import { Button, Card, Empty, Loading, Tabs } from "@/components/ui";
import { aujourdhui, useAdresse } from "@/components/hsseq/actions/outils";
import { apiDownload, useApi } from "@/lib/api-client";
import { Alertes } from "./Alertes";
import { Annuaire } from "./Annuaire";
import { messageDocument, useDroits } from "./libelles";
import { MesDocuments } from "./MesDocuments";
import { Procedures } from "./Procedures";
import type { MyDocuments } from "./types";
import { Urgences } from "./Urgences";

type Vue = "a-lire" | "procedures" | "alertes" | "urgences" | "annuaire";

/** Paramètres propres à un onglet, retirés de l'adresse quand on change d'onglet. */
const PARAMETRES_VUE = ["nonlus", "statut", "domaine", "q", "procedure", "nature", "alerte", "liste", "site", "scenario", "archives", "annee", "plan", "exercice", "retires"];

export function Documents() {
  const { lire, ecrire } = useAdresse();
  const droits = useDroits();
  // Documents à lire du compte : le nombre de l'onglet (même clé que MesDocuments, lue une fois).
  const { data: mes } = useApi<MyDocuments>(droits.aLire ? "/hsseq/my/documents" : null);

  if (!droits.pret) return <Loading label="Lecture de vos droits…" />;

  const vues: Array<{ key: Vue; label: string; count?: number }> = [
    ...(droits.aLire ? [{ key: "a-lire" as const, label: "À lire", count: mes?.unread_count }] : []),
    ...(droits.documents
      ? [
          { key: "procedures" as const, label: "Procédures" },
          { key: "alertes" as const, label: "Alertes et retours d'expérience" },
        ]
      : []),
    ...(droits.urgences
      ? [
          { key: "urgences" as const, label: "Plans d'urgence et exercices" },
          { key: "annuaire" as const, label: "Annuaire de crise" },
        ]
      : []),
  ];
  const premiere = vues[0]?.key;
  if (!premiere) {
    return (
      <Card>
        <Empty title="Documents et urgences ne sont pas ouverts à votre profil" hint="Les procédures et les alertes qui vous visent se lisent depuis votre espace." />
      </Card>
    );
  }
  const vue: Vue = vues.find((v) => v.key === lire("vue"))?.key ?? premiere;
  const changerVue = (v: Vue) => ecrire({ vue: v === premiere ? null : v, ...Object.fromEntries(PARAMETRES_VUE.map((p) => [p, null])) });
  const props = { lire, ecrire, droits };

  return (
    <div>
      <Tabs value={vue} onChange={changerVue} tabs={vues} />
      {vue === "a-lire" ? (
        <MesDocuments nonLus={lire("nonlus") === "1"} onNonLus={(v) => ecrire({ nonlus: v ? "1" : null })} />
      ) : vue === "procedures" ? (
        <Procedures {...props} />
      ) : vue === "alertes" ? (
        <Alertes {...props} />
      ) : vue === "urgences" ? (
        <Urgences {...props} />
      ) : (
        <Annuaire {...props} />
      )}
    </div>
  );
}

/**
 * Commande de l'en-tête : export Excel des registres (GET /hsseq/documents/export.xlsx), bornés comme
 * les listes du compte : procédures et alertes pour qui les lit, plans, exercices et annuaire de crise
 * de ses sites.
 */
export function CommandesDocuments() {
  const droits = useDroits();
  const [export_, setExport] = useState<{ envoi: boolean; erreur: string | null }>({ envoi: false, erreur: null });
  if (!droits.urgences) return null;

  async function telecharger() {
    setExport({ envoi: true, erreur: null });
    try {
      await apiDownload("/hsseq/documents/export.xlsx", `documents_urgences_hsseq_${aujourdhui().replaceAll("-", "")}.xlsx`);
      setExport({ envoi: false, erreur: null });
    } catch (e) {
      setExport({ envoi: false, erreur: messageDocument(e, "L'export n'a pas abouti.") });
    }
  }

  return (
    <>
      <Button loading={export_.envoi} onClick={() => void telecharger()} title={droits.documents ? "Procédures, alertes, plans d'intervention, exercices et annuaire de crise" : "Plans d'intervention, exercices et annuaire de crise"}>
        <Download className="h-4 w-4" /> Exporter les registres
      </Button>
      {export_.erreur && (
        <p role="alert" className="m-0 w-full text-[12.5px] font-medium text-danger sm:text-right">
          {export_.erreur}
        </p>
      )}
    </>
  );
}
