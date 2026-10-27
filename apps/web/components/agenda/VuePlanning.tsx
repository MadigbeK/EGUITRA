"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "@/components/icons";
import { ErrorBox, Input, Loading, cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { heure, instantDe, jourLong, lireInstant, minutesDe, rangJour, versApi, type AgendaMe, type LignePlanning, type Personne } from "@/lib/agenda";
import { decalerJours } from "@/lib/format";

const DEBUT = 7;
const FIN = 20;
const CLE = "nimova.agenda.planning";
const TEINTES: Record<string, string> = { busy: "bg-accent text-white", tentative: "bg-accent-doux text-accent ring-1 ring-inset ring-accent/40", oof: "bg-warn-doux text-warn", absence: "bg-warn-doux text-warn" };

function lire(): { personnes: Personne[]; ressources: number[] } {
  try {
    const v = JSON.parse(window.localStorage.getItem(CLE) ?? "") as { personnes: Personne[]; ressources: number[] };
    if (Array.isArray(v.personnes) && Array.isArray(v.ressources)) return v;
  } catch {
    /* préférence absente ou illisible : valeurs par défaut */
  }
  return { personnes: [], ressources: [] };
}

/**
 * Planning d'équipe, en lecture seule : une ligne par personne ou ressource, les heures en colonnes (7 h à
 * 20 h). Le titre n'apparaît que pour qui lit l'agenda de la personne ; sinon « Occupé », « Absent du
 * bureau » ou « Congé ». La liste des lignes se garde sur le poste.
 */
export function VuePlanning({ me, jour }: { me: AgendaMe; jour: string }) {
  const [choix, setChoix] = useState<{ personnes: Personne[]; ressources: number[] }>({ personnes: [], ressources: [] });
  const [pret, setPret] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    setChoix(lire());
    setPret(true);
  }, []);
  useEffect(() => {
    if (!pret) return;
    try {
      window.localStorage.setItem(CLE, JSON.stringify(choix));
    } catch {
      /* stockage refusé : le choix vaut pour la page */
    }
  }, [choix, pret]);

  const ressources = me.calendars.filter((c) => c.kind === "resource");
  const ids = [me.user.id, ...choix.personnes.map((p) => p.id)];
  const debut = instantDe(jour);
  const fin = instantDe(decalerJours(jour, 1));
  const chemin = pret ? `/agenda/planning?start=${versApi(debut)}&end=${versApi(fin)}&user_ids=${ids.join(",")}&resource_ids=${choix.ressources.join(",")}` : null;
  const { data, error, mutate } = useApi<{ rows: LignePlanning[] }>(chemin);
  const recherche = useApi<Personne[]>(q.trim().length >= 2 ? `/agenda/users?q=${encodeURIComponent(q.trim())}&limit=8` : null);
  const heures = useMemo(() => Array.from({ length: FIN - DEBUT }, (_, i) => DEBUT + i), []);
  const largeur = (FIN - DEBUT) * 60;

  function bloc(o: { start: string; stop: string }) {
    const s = lireInstant(o.start).getTime() <= debut.getTime() ? 0 : minutesDe(lireInstant(o.start));
    const e = lireInstant(o.stop).getTime() >= fin.getTime() ? 24 * 60 : minutesDe(lireInstant(o.stop));
    const a = Math.max(s, DEBUT * 60) - DEBUT * 60;
    const b = Math.min(e, FIN * 60) - DEBUT * 60;
    return b > a ? { left: `${(a / largeur) * 100}%`, width: `${((b - a) / largeur) * 100}%` } : null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-line bg-panel p-3">
        <div className="relative w-full max-w-xs">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ajouter un collègue…" aria-label="Ajouter un collègue au planning" />
          {recherche.data && recherche.data.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-line bg-panel p-1 shadow-[var(--ombre-flottante)]">
              {recherche.data.filter((u) => !ids.includes(u.id)).map((u) => (
                <li key={u.id}>
                  <button type="button" className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-panel-2" onClick={() => { setChoix((c) => ({ ...c, personnes: [...c.personnes, { id: u.id, name: u.name }] })); setQ(""); }}>
                    {u.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {choix.personnes.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-panel-2 py-1 pl-2.5 pr-1 text-[12.5px]">
              {p.name}
              <button type="button" aria-label={`Retirer ${p.name} du planning`} onClick={() => setChoix((c) => ({ ...c, personnes: c.personnes.filter((x) => x.id !== p.id) }))} className="grid h-5 w-5 place-items-center rounded-full hover:bg-panel-3">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {ressources.map((r) => (
            <label key={r.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px]">
              <input type="checkbox" checked={choix.ressources.includes(r.id)} onChange={(e) => setChoix((c) => ({ ...c, ressources: e.target.checked ? [...c.ressources, r.id] : c.ressources.filter((x) => x !== r.id) }))} />
              {r.name}
            </label>
          ))}
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={() => void mutate()} />}
      {!data && !error && <Loading label="Chargement du planning…" />}
      {data && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <caption className="sr-only">Planning d&apos;équipe du {jourLong(jour, true)}</caption>
            <thead>
              <tr>
                <th scope="col" className="w-48 border-b border-line px-3 py-2 text-left font-semibold text-ink-2">{jourLong(jour)}</th>
                <th scope="col" className="border-b border-line p-0">
                  <div className="relative flex">
                    {heures.map((h) => (
                      <span key={h} className="flex-1 border-l border-line px-1 py-2 text-left text-[11px] font-medium tabular text-muted">{String(h).padStart(2, "0")}:00</span>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const plages = r.work_hours?.[String(rangJour(jour))] ?? null;
                return (
                  <tr key={`${r.kind}-${r.id}`}>
                    <th scope="row" className="border-b border-line px-3 py-2 text-left align-top font-medium text-ink">
                      {r.name}
                      {r.kind === "resource" && <span className="block text-[11px] font-normal text-muted">Ressource{r.capacity ? `, ${r.capacity} places` : ""}</span>}
                      {r.ooo && <span className="block text-[11px] font-normal text-warn">Absent du bureau{r.ooo.message ? ` : ${r.ooo.message}` : ""}</span>}
                      {!r.visible && <span className="block text-[11px] font-normal text-muted">Disponibilités non communiquées</span>}
                    </th>
                    <td className="relative h-12 border-b border-line p-0">
                      {plages &&
                        Array.from({ length: FIN - DEBUT }, (_, i) => DEBUT + i).map((h) => {
                          const dedans = plages.some(([a, b]) => Number(a.slice(0, 2)) <= h && h < Number(b.slice(0, 2)) + (Number(b.slice(3, 5)) > 0 ? 1 : 0));
                          return !dedans ? <span key={h} aria-hidden className="absolute inset-y-0 bg-panel-2" style={{ left: `${((h - DEBUT) / (FIN - DEBUT)) * 100}%`, width: `${100 / (FIN - DEBUT)}%` }} /> : null;
                        })}
                      {r.busy.map((b, i) => {
                        const pos = bloc(b);
                        return pos ? (
                          <span key={i} className={cx("absolute inset-y-1.5 truncate rounded-md px-1.5 text-[11px] font-medium leading-[30px]", TEINTES[b.kind] ?? TEINTES.busy)} style={pos} title={`${b.title ?? "Occupé"}, ${heure(b.start)} - ${heure(b.stop)}`}>
                            {b.title ?? "Occupé"}
                          </span>
                        ) : null;
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
