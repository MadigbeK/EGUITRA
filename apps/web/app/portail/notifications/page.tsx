"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bell, CheckCheck, ChevronRight } from "@/components/icons";
import { Button, Card, Empty, ErrorBox, FEUILLE, Loading, Segmented, cx } from "@/components/ui";
import { EnTete, KIND_ICON, heure, lienNotification } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { cleDate, depuisCle, jourLocal, majuscule, pluriel } from "@/components/portail/cabinet-porteur/briques";
import { apiSend, useApi } from "@/lib/api-client";
import type { NotificationRow, Notifications } from "@/lib/portail-types";

type Filtre = "toutes" | "non-lues";

function titreJour(cle: string): string {
  const auj = new Date();
  const hier = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate() - 1);
  if (cle === cleDate(auj)) return "Aujourd'hui";
  if (cle === cleDate(hier)) return "Hier";
  const d = depuisCle(cle);
  return majuscule(d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() !== auj.getFullYear() ? "numeric" : undefined }));
}

/** Toutes les notifications du porteur, par jour ; un clic les marque lues et ouvre leur page. */
export default function NotificationsPage() {
  const router = useRouter();
  const { rafraichir } = usePortail();
  const { data, error, mutate } = useApi<Notifications>("/portail/notifications");
  const [filtre, setFiltre] = useState<Filtre>("toutes");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);

  const groupes = useMemo(() => {
    const liste = (data?.items ?? []).filter((n) => filtre === "toutes" || !n.read);
    const out: Array<{ cle: string; items: NotificationRow[] }> = [];
    for (const n of liste) {
      const cle = jourLocal(n.date);
      const dernier = out[out.length - 1];
      if (dernier?.cle === cle) dernier.items.push(n);
      else out.push({ cle, items: [n] });
    }
    return out;
  }, [data, filtre]);

  async function marquer(ids?: number[]) {
    if (!data) return;
    const vise = ids ? new Set(ids) : null;
    const items = data.items.map((n) => (!vise || vise.has(n.id) ? { ...n, read: true } : n));
    // Affichage immédiat, puis le compte exact renvoyé par l'API.
    void mutate({ unread: items.filter((n) => !n.read).length, items }, false);
    try {
      const r = await apiSend<{ unread: number }>("POST", "/portail/notifications/lues", ids ? { ids } : {});
      void mutate((d) => (d ? { ...d, unread: r.unread } : d), false);
      rafraichir();
    } catch (e) {
      setErreur(e);
      void mutate();
    }
  }

  async function toutLire() {
    setEnvoi(true);
    setErreur(null);
    await marquer();
    setEnvoi(false);
  }

  function ouvrir(n: NotificationRow) {
    if (!n.read) void marquer([n.id]);
    const lien = lienNotification(n);
    if (lien) router.push(lien);
  }

  if (error) return <ErrorBox error={error} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement de vos notifications…" />;

  const nonLues = data.items.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      <EnTete
        titre="Notifications"
        texte={nonLues ? `${pluriel(nonLues, "notification non lue", "notifications non lues")}.` : "Vous êtes à jour."}
        actions={
          <Button onClick={() => void toutLire()} loading={envoi} disabled={nonLues === 0}>
            <CheckCheck className="h-4 w-4" /> Tout marquer comme lu
          </Button>
        }
      />

      <Segmented<Filtre>
        label="Filtrer les notifications"
        value={filtre}
        onChange={setFiltre}
        options={[
          { key: "toutes", label: `Toutes (${data.items.length})` },
          { key: "non-lues", label: `Non lues (${nonLues})` },
        ]}
      />

      {erreur !== null && <ErrorBox error={erreur} />}

      {groupes.length === 0 ? (
        <Card>
          {filtre === "non-lues" && data.items.length > 0 ? (
            <Empty title="Tout est lu." hint="Les prochaines nouvelles de votre dossier apparaîtront ici." />
          ) : (
            <Empty title="Aucune notification." hint="Vous serez prévenu ici des messages de votre consultant, des pièces validées, des rendez-vous et des actualités du cabinet." />
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          {groupes.map((g) => (
            <section key={g.cle} aria-labelledby={`jour-${g.cle}`}>
              <h2 id={`jour-${g.cle}`} className="mb-2 px-1 text-[12.5px] font-bold uppercase tracking-[0.1em] text-muted">{titreJour(g.cle)}</h2>
              <ul className={cx(FEUILLE, "divide-y divide-line overflow-hidden")}>
                {g.items.map((n) => {
                  const I = KIND_ICON[n.kind] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => ouvrir(n)}
                        className={cx("group flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-panel-2 sm:px-5", !n.read && "bg-accent-doux/40")}
                      >
                        <span aria-hidden className={cx("mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full", n.read ? "bg-panel-2 text-muted" : "bg-accent-doux text-accent")}>
                          <I className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cx("block text-[14px] leading-snug", n.read ? "text-ink-2" : "font-semibold text-ink")}>
                            {!n.read && <span className="sr-only">Non lue : </span>}
                            {n.title}
                          </span>
                          {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted">{n.body}</span>}
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                            <span className="tabular">{heure(n.date)}</span>
                            {n.dossier && <span className="rounded-full bg-panel-3 px-2 py-px font-semibold text-ink-2">{n.dossier.reference}</span>}
                          </span>
                        </span>
                        {!n.read && <span aria-hidden className="mt-2 h-2.5 w-2.5 flex-none rounded-full bg-accent-vif" />}
                        {n.link && <ChevronRight className="mt-2 h-4 w-4 flex-none text-muted transition-transform group-hover:translate-x-0.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="px-1 text-[12px] text-muted">Les notifications sont conservées six mois.</p>
        </div>
      )}
    </div>
  );
}
