"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Monogramme } from "@/components/brand";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import { jourLong, lireInstant, versApi } from "@/lib/agenda";

/**
 * Pages publiques de la prise de rendez-vous (sans compte) : choix d'un créneau, demande, puis confirmation
 * par le lien reçu par courriel. Tout passe par /api/rendez-vous, qui relaie au noyau avec l'adresse IP du
 * visiteur ; aucune donnée de la plateforme n'est lisible d'ici hormis le type de rendez-vous publié.
 */

interface TypePublic {
  name: string;
  owner: string;
  description: string | null;
  duration: number;
  location: string | null;
  online: boolean;
  questions: string[];
  tz: string;
  min_notice_hours: number;
  max_days: number;
  domains_restricted: boolean;
  start: string;
  next_start: string;
  slots: Array<{ start: string; stop: string }>;
}

type Erreur = { message: string; statut: number };

async function appeler<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/rendez-vous/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.message === "string" && data.message ? data.message : res.status === 404 ? "Page introuvable." : "Le service ne répond pas. Réessayez dans un instant.";
    throw { message, statut: res.status } satisfies Erreur;
  }
  return data as T;
}

function lireErreur(e: unknown): string {
  return e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "Le service ne répond pas. Réessayez dans un instant.";
}

/** Jour et heure d'un instant dans le fuseau du rendez-vous. */
function dansFuseau(d: Date, tz: string): { jour: string; heure: string } {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}` };
}

function libelleFuseau(tz: string): string {
  return tz === "Africa/Conakry" ? "heure de Conakry" : `fuseau ${tz}`;
}

function Cadre({ children }: { children: ReactNode }) {
  return (
    <div data-app="agenda" className="min-h-screen bg-bg text-ink">
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 inline-flex items-center gap-3">
          <Monogramme tuile={false} className="h-10 w-10" />
          <span className="leading-none">
            <span className="block font-display text-[19px] font-bold tracking-[0.06em]">NIMOVA</span>
            <span className="mt-1 block text-[12.5px] font-semibold text-accent">Prise de rendez-vous</span>
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}

export function PriseRendezVous({ cle }: { cle: string }) {
  const [debut, setDebut] = useState<string | null>(null);
  const [type, setType] = useState<TypePublic | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [choix, setChoix] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [courriel, setCourriel] = useState("");
  const [reponses, setReponses] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState<{ email: string; expires_at: string } | null>(null);

  const charger = useCallback(async (start: string | null) => {
    setChargement(true);
    setErreur(null);
    try {
      const data = await appeler<TypePublic>(`${encodeURIComponent(cle)}${start ? `?start=${start}` : ""}`);
      setType(data);
      setChoix(null);
    } catch (e) {
      setErreur(lireErreur(e));
    } finally {
      setChargement(false);
    }
  }, [cle]);

  useEffect(() => {
    void charger(debut);
  }, [charger, debut]);

  const parJour = useMemo(() => {
    const groupes = new Map<string, Array<{ start: string; heure: string }>>();
    if (!type) return groupes;
    for (const s of type.slots) {
      const { jour, heure } = dansFuseau(lireInstant(s.start), type.tz);
      const liste = groupes.get(jour) ?? [];
      liste.push({ start: s.start, heure });
      groupes.set(jour, liste);
    }
    return groupes;
  }, [type]);

  const aujourdHui = type ? dansFuseau(new Date(), type.tz).jour : null;

  async function demander(e: FormEvent) {
    e.preventDefault();
    if (!choix || !type) return;
    setEnvoi(true);
    setRefus(null);
    try {
      const res = await appeler<{ email: string; expires_at: string }>(`${encodeURIComponent(cle)}/reserver`, {
        start: versApi(lireInstant(choix)),
        name: nom,
        email: courriel,
        answers: type.questions.map((_, i) => reponses[i] ?? ""),
      });
      setEnvoye(res);
    } catch (err) {
      setRefus(lireErreur(err));
      if (err && typeof err === "object" && "statut" in err && err.statut === 409) void charger(debut);
    } finally {
      setEnvoi(false);
    }
  }

  if (erreur && !type) {
    return (
      <Cadre>
        <h1 className="font-display text-2xl font-bold">Prise de rendez-vous</h1>
        <p className="mt-3 text-muted">{erreur}</p>
      </Cadre>
    );
  }
  if (!type) {
    return (
      <Cadre>
        <p className="text-muted" role="status">Chargement des créneaux…</p>
      </Cadre>
    );
  }
  if (envoye) {
    return (
      <Cadre>
        <h1 className="font-display text-2xl font-bold">Vérifiez votre messagerie</h1>
        <p className="mt-3 max-w-prose">
          Un courriel vient d&apos;être envoyé à {envoye.email}. Ouvrez le lien qu&apos;il contient dans les 30 minutes pour confirmer votre rendez-vous
          « {type.name} » avec {type.owner}. Sans confirmation, le créneau est libéré.
        </p>
      </Cadre>
    );
  }

  const choisi = choix ? dansFuseau(lireInstant(choix), type.tz) : null;
  return (
    <Cadre>
      <h1 className="font-display text-2xl font-bold">{type.name}</h1>
      <p className="mt-1 text-muted">
        Avec {type.owner} · {type.duration} minutes{type.location ? ` · ${type.location}` : ""}{type.online ? " · en visioconférence" : ""}
      </p>
      {type.description && <p className="mt-3 max-w-prose whitespace-pre-line">{type.description}</p>}
      {type.domains_restricted && <p className="mt-3 text-[13px] text-muted">Réservé aux adresses électroniques de certaines organisations.</p>}

      <section aria-labelledby="titre-creneaux" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titre-creneaux" className="text-lg font-semibold">Choisissez un créneau ({libelleFuseau(type.tz)})</h2>
          <div className="flex gap-2">
            <Button size="sm" disabled={chargement || !aujourdHui || type.start <= aujourdHui} onClick={() => setDebut(null)}>Revenir au début</Button>
            <Button size="sm" disabled={chargement} onClick={() => setDebut(type.next_start)}>Semaine suivante</Button>
          </div>
        </div>
        {erreur && <div className="mt-3"><Notice tone="danger">{erreur}</Notice></div>}
        {parJour.size === 0 ? (
          <p className="mt-4 text-muted">Aucun créneau libre sur ces sept jours{chargement ? "" : " : essayez la semaine suivante"}.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {[...parJour.entries()].map(([jour, liste]) => (
              <div key={jour}>
                <h3 className="mb-2 text-[13.5px] font-semibold capitalize">{jourLong(jour, true)}</h3>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={jourLong(jour, true)}>
                  {liste.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      role="radio"
                      aria-checked={choix === s.start}
                      onClick={() => setChoix(s.start)}
                      className={`rounded-xl border px-3 py-2 text-[14px] font-medium tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${choix === s.start ? "border-accent bg-accent text-white" : "border-line bg-panel hover:border-accent"}`}
                    >
                      {s.heure}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {choix && choisi && (
        <form onSubmit={(e) => void demander(e)} className="mt-8 max-w-md space-y-4" aria-labelledby="titre-coordonnees">
          <h2 id="titre-coordonnees" className="text-lg font-semibold">
            {jourLong(choisi.jour, true)} à {choisi.heure}
          </h2>
          <Field label="Votre nom">
            <Input required minLength={2} maxLength={120} autoComplete="name" value={nom} onChange={(e) => setNom(e.target.value)} />
          </Field>
          <Field label="Votre adresse électronique" hint="Le lien de confirmation y sera envoyé.">
            <Input required type="email" maxLength={254} autoComplete="email" value={courriel} onChange={(e) => setCourriel(e.target.value)} />
          </Field>
          {type.questions.map((q, i) => (
            <Field key={i} label={q}>
              <Textarea rows={3} maxLength={500} value={reponses[i] ?? ""} onChange={(e) => setReponses((r) => { const x = [...r]; x[i] = e.target.value; return x; })} />
            </Field>
          ))}
          {refus && <Notice tone="danger">{refus}</Notice>}
          <Button type="submit" variant="primary" loading={envoi}>Demander ce rendez-vous</Button>
        </form>
      )}
    </Cadre>
  );
}

/**
 * Confirmation par le lien du courriel. Rien n'est confirmé à l'ouverture de la page : les messageries
 * ouvrent souvent les liens d'elles-mêmes pour les analyser ; seul le bouton confirme.
 */
export function ConfirmationRendezVous({ jeton }: { jeton: string }) {
  const [etat, setEtat] = useState<"attente" | "envoi" | "fait" | "refus">("attente");
  const [message, setMessage] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ start: string; stop: string; type: string; owner: string; tz: string } | null>(null);

  async function confirmer() {
    setEtat("envoi");
    try {
      setResultat(await appeler<{ start: string; stop: string; type: string; owner: string; tz: string }>("confirmer", { token: jeton }));
      setEtat("fait");
    } catch (e) {
      setMessage(lireErreur(e));
      setEtat("refus");
    }
  }

  if (etat === "fait" && resultat) {
    const a = dansFuseau(lireInstant(resultat.start), resultat.tz);
    const b = dansFuseau(lireInstant(resultat.stop), resultat.tz);
    return (
      <Cadre>
        <h1 className="font-display text-2xl font-bold">Rendez-vous confirmé</h1>
        <p className="mt-3 max-w-prose">
          « {resultat.type} » avec {resultat.owner}, le {jourLong(a.jour, true)} de {a.heure} à {b.heure} ({libelleFuseau(resultat.tz)}). Une invitation vous a été envoyée par courriel.
        </p>
      </Cadre>
    );
  }
  return (
    <Cadre>
      <h1 className="font-display text-2xl font-bold">Confirmer votre rendez-vous</h1>
      <p className="mt-3 max-w-prose">Cliquez sur le bouton pour confirmer la demande de rendez-vous faite avec cette adresse électronique.</p>
      {etat === "refus" && message && <div className="mt-4 max-w-md"><Notice tone="danger">{message}</Notice></div>}
      <div className="mt-6">
        <Button variant="primary" loading={etat === "envoi"} disabled={etat === "refus"} onClick={() => void confirmer()}>Confirmer le rendez-vous</Button>
      </div>
    </Cadre>
  );
}
