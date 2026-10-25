"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Monogramme } from "@/components/brand";
import { AlertTriangle, Check, CloudOff, Loader2, LogOut, Pencil, RefreshCw, Trash2, Truck, Wifi } from "@/components/icons";
import { Badge, Button, FEUILLE, Field, Input, Notice, Select, Textarea, classesBouton, cx, demanderConfirmation, tonEtat, useMouvementReduit } from "@/components/ui";
import { ApiError, DelaiDepasse, apiGet, apiSend } from "@/lib/api-client";
import { cache, claimCache, dernierEnvoi, forgetDevice, newUuid, queue, type QueuedRotation } from "@/lib/offline-store";
import { INSECABLE, fmtDate, fmtInt, fmtM3, fmtVolume, pluriel } from "@/lib/format";

interface Referentials {
  vehicles: Array<{ id: number; name: string; tractor_plate: string | false | null; capacity_liters: number; driver_id: number | null }>;
  drivers: Array<{ id: number; name: string }>;
  routes: Array<{ id: number; name: string; distance_km: number }>;
  clients: Array<{ id: number; name: string }>;
  products: Array<{ code: string; label: string }>;
  costs: Array<{ code: string; label: string }>;
  /** Mesures facultatives (litres, températures…) ; absentes des listes gardées par une version antérieure. */
  measures?: Array<{ code: string; label: string }>;
}

interface SentRotation {
  id: number;
  name: string | null;
  state: "draft" | "done" | "invoiced" | "cancelled";
  date_loading: string;
  vehicle: { name: string } | null;
  client: { name: string } | null;
  route: { name: string } | null;
  volume_loaded: number;
  volume_delivered: number;
  source: "office" | "mobile";
}

interface Form {
  uuid: string | null;
  /**
   * Correction d'une saisie en attente : sa version, celle de son premier envoi et sa date
   * d'enregistrement, relevées à l'ouverture de la correction (voir QueuedRotation).
   */
  revision?: number;
  envoyee?: number;
  created_at?: string;
  date_loading: string;
  vehicle_id: string;
  driver_id: string;
  partner_id: string;
  route_id: string;
  product: string;
  delivery_note: string;
  volume_loaded: string;
  volume_delivered: string;
  note: string;
  costs: Record<string, string>;
  measures: Record<string, string>;
}

type View = "saisie" | "attente" | "envoyees";

/** Mot de l'état d'une rotation envoyée ; son ton vient de la table commune des états (ETAT_TON). */
const STATE_LABEL: Record<SentRotation["state"], string> = {
  draft: "Reçue au bureau",
  done: "Validée",
  invoiced: "Facturée",
  cancelled: "Annulée",
};

/** Champs sans lesquels le bureau ne peut pas traiter la rotation, dans l'ordre de l'écran. */
const REQUIS = ["vehicle_id", "partner_id", "route_id", "volume_loaded"] as const;
type Requis = (typeof REQUIS)[number];
type Erreurs = Partial<Record<Requis, string>>;

/** Retour d'une action. `reseau` : il tient au réseau (icône du nuage barré). */
interface Retour {
  tone: "ok" | "warn" | "danger" | "neutral";
  text: string;
  reseau?: boolean;
}
type RetourBandeau = Retour & { tone: "ok" | "warn" | "danger" };

/** Bilan d'un envoi au bureau, pour dire où en est la saisie qu'on vient d'enregistrer. */
interface Bilan {
  created: number;
  errors: number;
  /** Corrections que le bureau n'a pas pu prendre (rotation déjà traitée ou retouchée au bureau). */
  recues: number;
  echec: { reseau: boolean; message: string } | null;
}

/** Réponse du bureau pour une saisie envoyée (POST /transport/sync). */
interface Resultat {
  client_uuid: string | null;
  status: "created" | "updated" | "exists" | "error";
  message?: string;
}

/** Correction que le bureau n'a pas pu porter sur la rotation reçue, faute de message du noyau. */
const MESSAGE_RECUE = "Déjà reçue au bureau, qui l'a traitée ou modifiée : la correction n'y est pas portée. Faites corriger la rotation au bureau, depuis sa fiche.";

/** La saisie a-t-elle été corrigée sur le téléphone après son premier envoi ? Elle repart alors marquée. */
const corrigee = (q: QueuedRotation) => q.envoyee !== undefined && (q.revision ?? 1) > q.envoyee;

/** Ce que reçoit le bureau : la saisie, son identifiant, et la marque d'une correction faite après l'envoi. */
const versEnvoi = (q: QueuedRotation) => ({ ...q.payload, client_uuid: q.client_uuid, ...(corrigee(q) ? { correction: true } : {}) });

/**
 * Ce que devient une saisie après la réponse du bureau. `actuelle` est relue au moment d'écrire : une
 * correction enregistrée pendant l'envoi (version plus récente que celle partie) est gardée telle quelle
 * et repartira, marquée correction ; une saisie supprimée entre-temps n'est pas recréée.
 */
function apresReponse(actuelle: QueuedRotation | undefined, partie: QueuedRotation, r: Resultat): QueuedRotation | "supprimer" | undefined {
  if (!actuelle || (actuelle.revision ?? 1) !== (partie.revision ?? 1)) return undefined;
  if (r.status === "created" || r.status === "updated") return "supprimer";
  // Déjà reçue : identique à ce qui est parti au premier envoi, rien à garder ; corrigée depuis, le bureau
  // n'a pas pu prendre la correction (rotation traitée ou retouchée au bureau).
  if (r.status === "exists") return corrigee(partie) ? { ...actuelle, status: "recue", message: r.message ?? MESSAGE_RECUE } : "supprimer";
  return { ...actuelle, status: "error", message: r.message ?? "Saisie refusée." };
}

/**
 * Délais de réponse du bureau : 8 s pour une liste (la dernière connue reste affichée), 20 s pour un
 * envoi de saisies (un envoi abandonné repart tel quel : le bureau reconnaît une saisie déjà reçue).
 */
const DELAI_LISTE = 8_000;
const DELAI_ENVOI = 20_000;

/** Au-delà, un échange réussi dit aussi un réseau faible. */
const ECHANGE_LENT = 5_000;

/**
 * Dernier échange réel avec le bureau. Le navigateur dit « en ligne » dès qu'il a une liaison ; c'est
 * l'échange qui dit si elle passe. ok : une réponse est arrivée (un refus du bureau compte).
 */
interface Echange {
  ok: boolean;
  lent: boolean;
}

/** Bouton d'enregistrement : au repos, pendant l'écriture sur le téléphone, puis 1,5 s de confirmation. */
type Phase = "repos" | "ecriture" | "enregistree";

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): Form => ({
  uuid: null, date_loading: today(), vehicle_id: "", driver_id: "", partner_id: "", route_id: "", product: "gasoil",
  delivery_note: "", volume_loaded: "", volume_delivered: "", note: "", costs: {}, measures: {},
});
const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;

/** Formulaire où rien n'est saisi : la date et le produit proposés d'office ne comptent pas. */
function formVide(f: Form): boolean {
  const vide = (v: string | undefined) => !(v ?? "").trim();
  return !f.uuid && !f.vehicle_id && !f.driver_id && !f.partner_id && !f.route_id && vide(f.delivery_note) && vide(f.volume_loaded)
    && vide(f.volume_delivered) && vide(f.note) && Object.values(f.costs ?? {}).every(vide) && Object.values(f.measures ?? {}).every(vide);
}

/** Contrôle avant enregistrement (mêmes règles qu'avant) : un message sous chaque champ manquant. */
function controler(f: Form): Erreurs {
  const e: Erreurs = {};
  if (!f.vehicle_id) e.vehicle_id = "Choisissez le camion";
  if (!f.partner_id) e.partner_id = "Choisissez le client";
  if (!f.route_id) e.route_id = "Choisissez la route";
  if (!num(f.volume_loaded) && !num(f.volume_delivered)) e.volume_loaded = "Indiquez le volume chargé";
  return e;
}

/**
 * Frais en GNF groupés par milliers pendant la frappe (« 1 500 000 ») : un zéro de trop se voit.
 * num() retire les espaces avant l'envoi ; une saisie qui n'est pas un entier reste telle quelle.
 */
function grouper(v: string): string {
  const brut = v.replace(/\s/g, "");
  return /^\d+$/.test(brut) ? fmtInt(Number(brut)) : v;
}

/** « aujourd'hui 14:32 », « hier 18:05 », sinon « le 20/10 à 09:15 ». */
function quand(d: Date): string {
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const veille = new Date();
  veille.setDate(veille.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return `aujourd'hui ${heure}`;
  if (d.toDateString() === veille.toDateString()) return `hier ${heure}`;
  return `le ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} à ${heure}`;
}

const NON_TEXTE = new Set(["date", "checkbox", "radio", "button", "submit", "file", "range", "color"]);

/** Vrai si l'élément ouvre le clavier du téléphone (champ de texte ou de nombre). */
function saisitTexte(el: Element | null): boolean {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NON_TEXTE.has(el.type));
}

/**
 * Clavier ouvert au téléphone : un champ de texte a le focus et la partie visible de la page a
 * rétréci. La barre d'action cesse alors d'être collée en bas : quand le clavier redimensionne la
 * vue (Android), elle cacherait le champ en cours.
 */
function useClavierOuvert(): boolean {
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !window.matchMedia("(pointer: coarse)").matches) return;
    let repos = vv.height;
    let image = 0;
    const mesurer = () => {
      const texte = saisitTexte(document.activeElement);
      if (!texte) repos = vv.height;
      setOuvert(texte && vv.height < repos - 120);
    };
    // Le focus change avant que le clavier ne s'ouvre ou ne se ferme : mesure à l'image suivante.
    const differer = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(mesurer);
    };
    vv.addEventListener("resize", mesurer);
    document.addEventListener("focusin", differer);
    document.addEventListener("focusout", differer);
    return () => {
      cancelAnimationFrame(image);
      vv.removeEventListener("resize", mesurer);
      document.removeEventListener("focusin", differer);
      document.removeEventListener("focusout", differer);
    };
  }, []);
  return ouvert;
}

/**
 * Lecture en plein soleil, sur un écran d'entrée de gamme : gris secondaire à 7,8:1, encre des
 * libellés à 13:1, filets de champ à 5,4:1 sur 1,5 px (jetons « terrain », posés sur la racine de
 * l'application).
 */
const TERRAIN = "[--muted:#44564f] [--ink-2:#22352e] [--line-champ:#5c6e66] [&_input]:border-[1.5px] [&_select]:border-[1.5px] [&_textarea]:border-[1.5px]";

/** Libellé de champ en 14 px semi-gras à l'encre, aide et erreur en 14 px (Field, au téléphone). */
const LIBELLE = "[&>span:first-child]:text-[14px] [&>span:first-child]:font-semibold [&>span:first-child]:text-ink [&>span:not(:first-child)]:text-[14px]";

/** Champ en erreur : bordure et halo danger, qui l'emportent sur le survol et le focus. */
const INVALIDE = "aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-danger/15";

/** Un champ atteint par le focus ne passe jamais sous la barre d'action collée en bas. */
const SOUS_BARRE = "scroll-mb-32";

const TON_RETOUR: Record<Retour["tone"], string> = {
  ok: "text-ok-texte",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-ink",
};

/** Bouton d'enregistrement pendant la confirmation : aplat favorable, coche. */
const BOUTON_FAIT = "inline-flex min-h-14 w-full flex-1 items-center justify-center gap-2 rounded-[10px] bg-ok px-4 text-[17px] font-semibold text-white transition-colors duration-150";

/** Point d'envoi en attente : il bat trois fois, puis reste allumé (un seul état vivant par écran). */
const POULS = { "--pouls": "rgb(165 230 194 / 0.7)", animationIterationCount: 3 } as CSSProperties;

function toPayload(f: Form): Record<string, unknown> {
  const p: Record<string, unknown> = {
    date_loading: f.date_loading, vehicle_id: Number(f.vehicle_id), partner_id: Number(f.partner_id),
    route_id: Number(f.route_id), product: f.product,
  };
  if (f.driver_id) p.driver_id = Number(f.driver_id);
  if (f.delivery_note.trim()) p.delivery_note = f.delivery_note.trim();
  if (f.volume_loaded) p.volume_loaded = num(f.volume_loaded);
  if (f.volume_delivered) p.volume_delivered = num(f.volume_delivered);
  if (f.note.trim()) p.note = f.note.trim();
  for (const [k, v] of Object.entries(f.costs)) if (v) p[k] = num(v);
  for (const [k, v] of Object.entries(f.measures ?? {})) if (v) p[k] = num(v);
  return p;
}

function fromPayload(item: QueuedRotation, refs: Referentials): Form {
  const p = item.payload;
  const s = (k: string) => (p[k] === undefined || p[k] === null ? "" : String(p[k]));
  const pick = (list: Array<{ code: string }>) => Object.fromEntries(list.map((c) => [c.code, s(c.code)]).filter(([, v]) => v));
  return {
    uuid: item.client_uuid, revision: item.revision ?? 1, envoyee: item.envoyee, created_at: item.created_at,
    date_loading: s("date_loading") || today(), vehicle_id: s("vehicle_id"), driver_id: s("driver_id"),
    partner_id: s("partner_id"), route_id: s("route_id"), product: s("product") || "gasoil", delivery_note: s("delivery_note"),
    volume_loaded: s("volume_loaded"), volume_delivered: s("volume_delivered"), note: s("note"),
    // Une saisie d'avant la mise à jour garde son ancien total des taxes (« specific_taxes ») : il
    // repart tel quel, le bureau le traite comme avant.
    costs: { ...pick(refs.costs), ...(p.specific_taxes ? { specific_taxes: s("specific_taxes") } : {}) },
    measures: pick(refs.measures ?? []),
  };
}

/** Ce que le téléphone garde des listes : de quoi saisir, sans tarifs (appareil exposé au parc). */
function keepReferentials(r: Referentials): Referentials {
  return {
    vehicles: r.vehicles.map(({ id, name, tractor_plate, capacity_liters, driver_id }) => ({ id, name, tractor_plate, capacity_liters, driver_id })),
    drivers: r.drivers.map(({ id, name }) => ({ id, name })),
    routes: r.routes.map(({ id, name, distance_km }) => ({ id, name, distance_km })),
    clients: r.clients.map(({ id, name }) => ({ id, name })),
    products: r.products.map(({ code, label }) => ({ code, label })),
    costs: r.costs.map(({ code, label }) => ({ code, label })),
    measures: (r.measures ?? []).map(({ code, label }) => ({ code, label })),
  };
}

/** Rotations envoyées : suivi de l'agent, sans chiffre d'affaires, coûts ni marge. */
function keepSent(r: SentRotation): SentRotation {
  const ref = (x: { name: string } | null) => (x ? { name: x.name } : null);
  return {
    id: r.id, name: r.name, state: r.state, date_loading: r.date_loading, vehicle: ref(r.vehicle), client: ref(r.client),
    route: ref(r.route), volume_loaded: r.volume_loaded, volume_delivered: r.volume_delivered, source: r.source,
  };
}

export function RotationsApp({ me }: { me: { id: number; name: string } }) {
  const [online, setOnline] = useState(true);
  const [view, setView] = useState<View>("saisie");
  const [refs, setRefs] = useState<Referentials | null | undefined>(undefined);
  const [items, setItems] = useState<QueuedRotation[]>([]);
  const [sent, setSent] = useState<SentRotation[] | null>(null);
  // Ni liste gardée ni réponse du bureau : « Envoyées » le dit au lieu d'attendre sans fin.
  const [sentIndisponible, setSentIndisponible] = useState(false);
  const [echange, setEchange] = useState<Echange | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [showCosts, setShowCosts] = useState(false);
  const [notice, setNotice] = useState<RetourBandeau | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [phase, setPhase] = useState<Phase>("repos");
  const [retour, setRetour] = useState<Retour | null>(null);
  const busy = useRef(false);
  // Saisie ouverte en correction : elle ne part pas avant que la correction soit enregistrée (sinon
  // l'ancienne version arriverait au bureau pendant la frappe).
  const enCorrection = useRef<string | null>(null);
  // Enregistrement pendant un envoi : un nouvel envoi suit celui en cours (dernière version de sync).
  const relance = useRef(false);
  const syncRef = useRef<(origine?: "auto" | "envoi" | "saisie") => Promise<Bilan | null>>(async () => null);
  // Verrou d'enregistrement : posé au premier toucher, avant toute attente. Un double toucher ne
  // met jamais deux rotations en file.
  const verrou = useRef(false);
  const vueRef = useRef<View>(view);
  const minuteRetour = useRef(0);
  const minutePhase = useRef(0);
  const minuteRemontee = useRef(0);
  const clavier = useClavierOuvert();
  const reduit = useMouvementReduit();

  const mine = items.filter((i) => i.user_id === me.id);
  // Corrections que le bureau n'a pas pu prendre : elles ne partent plus, l'agent les retire une fois
  // le bureau prévenu.
  const recues = mine.filter((i) => i.status === "recue");
  const others = items.length - mine.length;
  const faible = online && echange !== null && (!echange.ok || echange.lent);
  const echecRef = useRef(false);

  /** Appel au bureau qui note le dernier échange réel, pour la pastille (« Réseau faible »). */
  const echanger = useCallback(async <T,>(appel: () => Promise<T>): Promise<T> => {
    const debut = Date.now();
    const noter = (ok: boolean) => {
      echecRef.current = !ok;
      setEchange({ ok, lent: Date.now() - debut > ECHANGE_LENT });
    };
    try {
      const res = await appel();
      noter(true);
      return res;
    } catch (e) {
      // Une réponse du bureau (refus, session expirée) prouve que le réseau passe.
      noter(e instanceof ApiError);
      throw e;
    }
  }, []);

  useEffect(() => {
    vueRef.current = view;
  }, [view]);

  useEffect(() => {
    enCorrection.current = form.uuid;
  }, [form.uuid]);

  useEffect(() => () => {
    window.clearTimeout(minuteRetour.current);
    window.clearTimeout(minutePhase.current);
    window.clearTimeout(minuteRemontee.current);
  }, []);

  /** Ligne d'état de la barre d'action (role=status) : 4 s, ou jusqu'au message suivant si `duree` est nul. */
  const annoncer = useCallback((r: Retour | null, duree: number | null = 4000) => {
    window.clearTimeout(minuteRetour.current);
    setRetour(r);
    if (r && duree) minuteRetour.current = window.setTimeout(() => setRetour(null), duree);
  }, []);

  /** Retour d'un envoi : sous le pouce sur « Nouvelle », dans le bandeau du haut ailleurs. */
  const signaler = useCallback((r: RetourBandeau) => {
    if (vueRef.current === "saisie") annoncer(r);
    else setNotice(r);
  }, [annoncer]);

  const loadQueue = useCallback(async () => {
    const all = await queue.all().catch(() => [] as QueuedRotation[]);
    setItems(all.sort((a, b) => a.created_at.localeCompare(b.created_at)));
    return all;
  }, []);

  const loadRefs = useCallback(async () => {
    const cached = await cache.get<Referentials>("referentials").catch(() => undefined);
    if (cached) setRefs(cached);
    if (!navigator.onLine) {
      if (!cached) setRefs(null);
      return;
    }
    try {
      const fresh = keepReferentials(await echanger(() => apiGet<Referentials>("/transport/referentials", { timeout: DELAI_LISTE })));
      setRefs(fresh);
      await cache.set("referentials", fresh);
    } catch {
      if (!cached) setRefs(null);
    }
  }, [echanger]);

  const loadSent = useCallback(async () => {
    const cached = await cache.get<SentRotation[]>("sent").catch(() => undefined);
    if (cached) setSent(cached);
    if (!navigator.onLine) {
      if (!cached) setSentIndisponible(true);
      return;
    }
    try {
      const res = await echanger(() => apiGet<{ items: SentRotation[] }>("/transport/rotations?limit=30", { timeout: DELAI_LISTE }));
      const items = res.items.map(keepSent);
      setSent(items);
      setSentIndisponible(false);
      await cache.set("sent", items);
    } catch {
      // Hors réseau ou réseau trop lent : la dernière liste connue reste affichée.
      if (!cached) setSentIndisponible(true);
    }
  }, [echanger]);

  /**
   * Envoi des saisies en attente. `origine` dit qui le demande : « saisie » (l'enregistrement dit
   * lui-même son résultat dans la barre d'action), « envoi » (bouton de « À envoyer ») ou « auto »
   * (ouverture, retour du réseau, toutes les deux minutes). Une saisie ouverte en correction part une
   * fois la correction enregistrée.
   */
  const sync = useCallback(async (origine: "auto" | "envoi" | "saisie" = "auto"): Promise<Bilan | null> => {
    if (!navigator.onLine) return null;
    if (busy.current) {
      relance.current = true;
      return null;
    }
    const candidates = (await loadQueue()).filter((i) => i.user_id === me.id && i.client_uuid !== enCorrection.current && i.status !== "recue");
    if (!candidates.length) return null;
    busy.current = true;
    setSyncing(true);
    let created = 0;
    let errors = 0;
    let recues = 0;
    let echec: Bilan["echec"] = null;
    try {
      for (let i = 0; i < candidates.length; i += 50) {
        const batch: QueuedRotation[] = [];
        for (const c of candidates.slice(i, i + 50)) {
          if (c.client_uuid === enCorrection.current) continue;
          // Premier envoi : la version qui part est notée avant l'envoi, dans la transaction qui relit la
          // saisie (sa réponse peut se perdre ; une correction enregistrée entre-temps n'est jamais écrasée).
          const actuelle = await queue.transformer(c.client_uuid, (q) => (q && q.envoyee === undefined ? { ...q, envoyee: q.revision ?? 1 } : undefined)).catch(() => undefined);
          if (actuelle && actuelle.status !== "recue") batch.push(actuelle);
        }
        if (!batch.length) continue;
        const res = await echanger(() => apiSend<{ results: Resultat[] }>("POST", "/transport/sync", { rotations: batch.map(versEnvoi) }, { timeout: DELAI_ENVOI }));
        for (const r of res.results) {
          const partie = r.client_uuid ? batch.find((b) => b.client_uuid === r.client_uuid) : undefined;
          if (!partie) continue;
          // undefined : corrigée ou supprimée pendant l'envoi, gardée telle quelle (une correction repartira).
          let suite: ReturnType<typeof apresReponse> = undefined;
          await queue.transformer(partie.client_uuid, (q) => (suite = apresReponse(q, partie, r))).catch(() => {
            suite = undefined;
          });
          const issue = suite as ReturnType<typeof apresReponse>;
          if (issue === "supprimer") created += 1;
          else if (issue?.status === "recue") recues += 1;
          else if (issue?.status === "error") errors += 1;
        }
      }
      const envoi = new Date();
      setLastSync(envoi);
      void dernierEnvoi.set(envoi);
      if (errors || recues) {
        // Les refus du bureau gardent le bandeau du haut ; sur « Nouvelle », la barre le dit aussi.
        const texte = [
          errors ? `${pluriel(errors, "saisie refusée : corrigez-la", "saisies refusées : corrigez-les")} dans « À envoyer ».` : "",
          recues === 1 ? "1 correction n'a pas pu être portée : le bureau avait déjà traité ou modifié la rotation. Faites-la corriger au bureau (voir « À envoyer »)." : "",
          recues > 1 ? `${fmtInt(recues)} corrections n'ont pas pu être portées : le bureau avait déjà traité ou modifié ces rotations. Faites-les corriger au bureau (voir « À envoyer »).` : "",
        ].filter(Boolean).join(" ");
        setNotice({ tone: "danger", text: texte });
        if (origine === "auto" && vueRef.current === "saisie") annoncer({ tone: "danger", text: texte });
      } else if (created && origine !== "saisie") {
        signaler({ tone: "ok", text: `${pluriel(created, "rotation transmise", "rotations transmises")} au bureau.` });
      }
    } catch (e) {
      const reseau = !(e instanceof ApiError);
      const message = e instanceof ApiError ? e.message : e instanceof DelaiDepasse
        ? "Réseau faible : le bureau n'a pas répondu à temps. Les saisies repartiront seules."
        : "Réseau indisponible : les saisies partiront au retour du réseau.";
      echec = { reseau, message };
      if (origine !== "saisie") signaler({ tone: "warn", text: echec.message, reseau });
    } finally {
      busy.current = false;
      setSyncing(false);
      await loadQueue();
      void loadSent();
      // Une saisie enregistrée pendant cet envoi part aussitôt, sans attendre le prochain essai.
      if (relance.current) {
        relance.current = false;
        window.setTimeout(() => void syncRef.current("auto"), 0);
      }
    }
    return { created, errors, recues, echec };
  }, [loadQueue, loadSent, me.id, annoncer, signaler, echanger]);

  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void (async () => {
      await claimCache(me.id); // listes d'un autre compte effacées avant tout affichage
      setLastSync(await dernierEnvoi.get());
      void loadQueue();
      void loadRefs();
      void loadSent();
      void sync();
    })();
    const up = () => {
      setOnline(true);
      void loadRefs();
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // Toutes les deux minutes : envoi des saisies en attente ; sans rien à envoyer, après un échange
    // manqué, la liste « Envoyées » sert de nouvel essai pour savoir si le réseau est revenu.
    const timer = window.setInterval(() => {
      void sync().then((bilan) => {
        if (!bilan && echecRef.current) void loadSent();
      });
    }, 120_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [loadQueue, loadRefs, loadSent, sync, me.id]);

  /** Le champ fautif vient au milieu de l'écran et reçoit le focus. */
  function allerAuChamp(k: Requis) {
    const el = document.getElementById(`rotation-${k}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reduit ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }

  /** Une erreur disparaît dès que l'agent touche à son champ. */
  function corriger(k: Requis) {
    setErreurs((e) => {
      if (!e[k]) return e;
      const suite = { ...e };
      delete suite[k];
      return suite;
    });
  }

  async function save() {
    if (verrou.current) return;
    verrou.current = true;
    // Le verrou reste posé pendant la confirmation « Rotation enregistrée » (1,5 s), puis tombe.
    let garde = false;
    try {
      setNotice(null);
      const fautes = controler(form);
      setErreurs(fautes);
      const premier = REQUIS.find((k) => fautes[k]);
      if (premier) {
        const n = Object.keys(fautes).length;
        annoncer({ tone: "danger", text: n > 1 ? `${n} champs à compléter, signalés en rouge.` : `${fautes[premier]}.` });
        allerAuChamp(premier);
        return;
      }
      const vehicle = refs?.vehicles.find((v) => String(v.id) === form.vehicle_id);
      // Le bureau ne valide pas une rotation chargée au-delà de la capacité : l'agent est prévenu dès la saisie.
      if (vehicle?.capacity_liters && num(form.volume_loaded) * 1000 > vehicle.capacity_liters &&
        !(await demanderConfirmation(`Le volume chargé dépasse la capacité de ${vehicle.name} (${fmtM3(vehicle.capacity_liters / 1000)}) : le bureau devra le corriger avant validation.`, { titre: "Enregistrer au-delà de la capacité ?", action: "Enregistrer quand même" }))) {
        return;
      }
      const uuid = form.uuid ?? newUuid();
      const payload = toPayload(form);
      const maintenant = new Date().toISOString();
      // « ER-09, 36,50 m³ » : ce que l'agent reconnaît de la rotation qu'il vient de saisir.
      const resume = `${vehicle?.name ?? "Rotation"}, ${fmtM3(num(form.volume_loaded) || num(form.volume_delivered))}`;
      setPhase("ecriture");
      annoncer(null);
      try {
        // Correction : version suivante de la saisie relue dans la même transaction (une réponse d'envoi
        // ne s'intercale pas). Disparue de la file (envoyée et retirée pendant la correction), le bureau en
        // a reçu une version : la correction repart marquée et le noyau met à jour son brouillon.
        await queue.transformer(uuid, (q): QueuedRotation => ({
          client_uuid: uuid, user_id: me.id, created_at: q?.created_at ?? form.created_at ?? maintenant, status: "pending", payload,
          revision: form.uuid ? (q?.revision ?? form.revision ?? 1) + 1 : 1,
          envoyee: !form.uuid ? undefined : q ? q.envoyee : (form.envoyee ?? form.revision ?? 1),
        }));
      } catch {
        setPhase("repos");
        annoncer({ tone: "danger", text: "Enregistrement impossible sur ce téléphone : réessayez. Si cela recommence, prévenez le bureau." });
        return;
      }
      enCorrection.current = null;

      // Enregistrée sur le téléphone : le bouton le dit 1,5 s, le téléphone vibre, la page remonte.
      setForm({ ...blank(), date_loading: form.date_loading });
      setShowCosts(false);
      setErreurs({});
      setPhase("enregistree");
      garde = true;
      navigator.vibrate?.(40);
      window.clearTimeout(minutePhase.current);
      minutePhase.current = window.setTimeout(() => {
        setPhase("repos");
        verrou.current = false;
      }, 1500);
      window.clearTimeout(minuteRemontee.current);
      minuteRemontee.current = window.setTimeout(() => window.scrollTo({ top: 0, behavior: reduit ? "auto" : "smooth" }), 450);

      await loadQueue();
      if (!navigator.onLine) {
        annoncer({ tone: "warn", text: `${resume} : partira au retour du réseau.`, reseau: true });
        return;
      }
      annoncer({ tone: "neutral", text: `${resume} : envoi au bureau…` }, null);
      const bilan = await sync("saisie");
      const restant = await queue.get(uuid).catch(() => undefined);
      if (!restant) annoncer({ tone: "ok", text: `${resume} : envoyée au bureau.` });
      else if (restant.status === "error") annoncer({ tone: "danger", text: `${resume} : refusée par le bureau, à corriger dans « À envoyer ».` });
      else if (restant.status === "recue") annoncer({ tone: "danger", text: `${resume} : déjà traitée au bureau, la correction n'y est pas portée. Faites-la corriger au bureau.` });
      else if (!bilan) annoncer({ tone: "ok", text: `${resume} : enregistrée, partira avec le prochain envoi.` });
      else if (bilan.echec && !bilan.echec.reseau) annoncer({ tone: "warn", text: `${resume} : enregistrée sur le téléphone. ${bilan.echec.message}` });
      else annoncer({ tone: "warn", text: `${resume} : partira au retour du réseau.`, reseau: true });
    } finally {
      if (!garde) verrou.current = false;
    }
  }

  async function remove(item: QueuedRotation) {
    const question = item.status === "recue"
      ? "Retirer cette correction du téléphone ? La rotation reçue au bureau n'est pas touchée : prévenez le bureau pour qu'il la corrige."
      : "Supprimer cette saisie du téléphone ? Elle ne sera pas transmise.";
    if (!(await demanderConfirmation(question, { action: item.status === "recue" ? "Retirer" : "Supprimer", danger: true }))) return;
    await queue.remove(item.client_uuid).catch(() => undefined);
    // La correction ouverte de cette saisie n'a plus d'objet.
    if (form.uuid === item.client_uuid) {
      enCorrection.current = null;
      setForm(blank());
      setErreurs({});
    }
    await loadQueue();
  }

  /** Ouvre la correction d'une saisie en attente ; une autre saisie en cours n'est remplacée qu'avec accord. */
  async function ouvrirCorrection(item: QueuedRotation) {
    if (!refs) return;
    // Déjà ouverte : la correction en cours reste telle quelle.
    if (form.uuid === item.client_uuid) {
      ouvrir("saisie");
      return;
    }
    if (!formVide(form) && !(await demanderConfirmation("Une saisie est en cours sur « Nouvelle » : la remplacer par cette correction ? Ce qui n'a pas été enregistré sera perdu.", { titre: "Remplacer la saisie en cours ?", action: "Remplacer", danger: true }))) return;
    enCorrection.current = item.client_uuid;
    setForm(fromPayload(item, refs));
    setErreurs({});
    ouvrir("saisie");
  }

  async function logout() {
    // Toujours confirmée : l'icône est près de la pastille du réseau, et la déconnexion efface les listes.
    const question = aEnvoyer
      ? `${pluriel(aEnvoyer, "saisie n'a pas encore été transmise", "saisies n'ont pas encore été transmises")}. ${aEnvoyer > 1 ? "Elles restent sur ce téléphone et partiront" : "Elle reste sur ce téléphone et partira"} à votre prochaine connexion.`
      : "Les listes gardées sur ce téléphone seront effacées : il faudra du réseau pour vous reconnecter.";
    if (!(await demanderConfirmation(question, { titre: "Se déconnecter ?", action: "Se déconnecter" }))) return;
    // Sans réseau, la session ne peut pas être fermée au serveur : rien n'est effacé du téléphone.
    const res = navigator.onLine ? await fetch("/api/session/logout", { method: "POST" }).catch(() => null) : null;
    if (!res?.ok) {
      setNotice({ tone: "warn", text: "Déconnexion impossible sans réseau : réessayez au retour du réseau." });
      return;
    }
    await forgetDevice();
    window.location.href = "/login?app=mobile";
  }

  const label = (kind: "vehicles" | "clients" | "routes", id: unknown) => {
    const list: Array<{ id: number; name: string }> = refs?.[kind] ?? [];
    return list.find((x) => x.id === Number(id))?.name ?? "–";
  };

  /** Changer d'onglet ouvre la vue en haut de page. */
  function ouvrir(v: View) {
    if (v !== view) window.scrollTo({ top: 0 });
    setView(v);
  }

  const invalide = (k: Requis) => (erreurs[k] ? true : undefined);
  const champ = cx("min-h-12 text-base", SOUS_BARRE, INVALIDE);
  const champVolume = cx("min-h-14 font-compteur text-[28px] font-semibold tracking-wide", SOUS_BARRE, INVALIDE);
  // À envoyer : en attente ou refusées ; les corrections que le bureau n'a pas prises ne partent plus.
  const aEnvoyer = mine.length - recues.length;
  const views: Array<[View, string, number | null]> = [
    ["saisie", "Nouvelle", null],
    ["attente", "À envoyer", mine.length],
    ["envoyees", "Envoyées", null],
  ];

  const reseau = syncing ? "Envoi en cours" : !online ? "Hors réseau" : faible ? "Réseau faible" : "En ligne";
  const etiquettePastille = `${reseau}, ${aEnvoyer ? pluriel(aEnvoyer, "saisie à envoyer", "saisies à envoyer") : "rien à envoyer"}${lastSync ? `, dernier envoi ${quand(lastSync)}` : ""}. Ouvrir « À envoyer ».`;

  // Ligne d'état de la barre d'action, au repos : réseau, saisies en attente, dernier envoi.
  const etat: { icone: ReactNode; texte: string } = syncing
    ? { icone: <Loader2 className="h-4 w-4 animate-spin text-muted" />, texte: "Envoi au bureau…" }
    : !online
      ? { icone: <CloudOff className="h-4 w-4 text-warn" />, texte: aEnvoyer ? `Hors réseau, ${aEnvoyer} à envoyer` : "Hors réseau : la saisie attendra le réseau" }
      : faible
        ? { icone: <Wifi className="h-4 w-4 text-warn" />, texte: aEnvoyer ? `Réseau faible, ${aEnvoyer} à envoyer${lastSync ? `, dernier envoi : ${quand(lastSync)}` : ""}` : "Réseau faible : l'envoi peut tarder" }
      : aEnvoyer
        ? { icone: <RefreshCw className="h-4 w-4 text-warn" />, texte: `${aEnvoyer} à envoyer${lastSync ? `, dernier envoi : ${quand(lastSync)}` : ""}` }
        : lastSync
          ? { icone: <Check className="h-4 w-4 text-ok" />, texte: `Dernier envoi : ${quand(lastSync)}` }
          : { icone: <span className="m-1 block h-2 w-2 rounded-full bg-ok" />, texte: "En ligne : envoi dès l'enregistrement" };
  const IconeRetour = !retour ? null : retour.tone === "ok" ? Check : retour.tone === "neutral" ? Loader2 : retour.reseau ? CloudOff : AlertTriangle;

  return (
    <div className={cx("rotations-app mx-auto flex min-h-screen max-w-xl flex-col", TERRAIN)}>
      {/* Seule la rangée des onglets reste collée : l'en-tête remonte de la hauteur de la rangée d'identité. */}
      <header className="sur-dos sticky -top-17 z-10 bg-[linear-gradient(135deg,#c4471d_0%,#983210_60%,#142f29_140%)] text-white shadow-[0_10px_30px_-18px_rgb(152_50_16/0.8)]">
        <div className="flex h-17 items-center gap-2.5 px-4">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-white/15">
            <Monogramme tuile={false} clair className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="font-display text-[19px] font-bold">Rotations</h1>
            <div className="truncate text-[13px] text-white/95">{me.name}</div>
          </div>
          <span role="status" className="sr-only">{!online ? "Hors réseau : les saisies restent sur le téléphone." : faible ? "Réseau faible : l'envoi peut tarder." : "En ligne"}</span>
          {/* Pastille du réseau : l'état et le nombre de saisies en attente ; un toucher ouvre « À envoyer ». */}
          <button type="button" onClick={() => ouvrir("attente")} aria-label={etiquettePastille} className="grid min-h-12 flex-none place-items-center rounded-full">
            <span className={cx("inline-flex items-center gap-1.5 rounded-full py-1 pl-2.5 text-[13px] font-semibold", aEnvoyer ? "pr-1" : "pr-2.5", online && !faible ? "bg-white/15 text-white" : "bg-or text-foret")}>
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : !online ? <CloudOff className="h-3.5 w-3.5" /> : faible ? <Wifi className="h-3.5 w-3.5" /> : <span key={aEnvoyer} aria-hidden className={cx("h-2 w-2 rounded-full bg-menthe", aEnvoyer > 0 && "n-pouls")} style={aEnvoyer > 0 ? POULS : undefined} />}
              {syncing ? "Envoi…" : !online ? "Hors réseau" : faible ? "Réseau faible" : "En ligne"}
              {aEnvoyer > 0 && <span key={`n${aEnvoyer}`} className={cx("n-surgir grid h-5 min-w-5 place-items-center rounded-full px-1.5 font-compteur text-[12.5px] font-bold", online && !faible ? "bg-or text-foret" : "bg-foret text-white")}>{aEnvoyer}</span>}
            </span>
          </button>
          <button type="button" onClick={logout} aria-label="Se déconnecter" className="-mr-2 grid h-12 w-12 flex-none place-items-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="grid grid-cols-3 px-2 text-[15px]">
          {views.map(([key, text, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => ouvrir(key)}
              aria-current={view === key ? "page" : undefined}
              className={cx("flex min-h-12 items-center justify-center gap-2 border-b-[3px] font-semibold transition-colors", view === key ? "border-white text-white" : "border-transparent text-white/90")}
            >
              {text}
              {count ? <span className="n-surgir grid h-5 min-w-5 place-items-center rounded-full bg-or px-1.5 font-compteur text-[12.5px] font-bold text-foret">{count}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className={cx("flex-1 space-y-4 px-4 pt-5", view === "saisie" && refs ? "pb-0" : "pb-10")}>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {view === "saisie" && (
          refs === undefined ? <p role="status" className="py-10 text-center text-sm text-muted">Chargement des listes…</p> :
          refs === null ? <Notice tone="warn">Les listes (camions, clients, routes) ne sont pas encore sur ce téléphone. Ouvrez l&apos;application une première fois avec du réseau.</Notice> : (
            <div className="space-y-4">
              {form.uuid && <Notice tone="accent">Correction d&apos;une saisie en attente.</Notice>}
              <section className={cx(FEUILLE, "space-y-4 p-4")}>
                <Field label="Date de chargement" className={LIBELLE}><Input className={champ} type="date" value={form.date_loading} onChange={(e) => setForm({ ...form, date_loading: e.target.value })} /></Field>
                <Field label="Ensemble routier" error={erreurs.vehicle_id} className={LIBELLE}>
                  <Select id="rotation-vehicle_id" aria-invalid={invalide("vehicle_id")} className={champ} value={form.vehicle_id} placeholder="Choisir le camion" onChange={(e) => {
                    const v = refs.vehicles.find((x) => String(x.id) === e.target.value);
                    corriger("vehicle_id");
                    setForm({ ...form, vehicle_id: e.target.value, driver_id: v?.driver_id ? String(v.driver_id) : form.driver_id });
                  }} options={refs.vehicles.map((v) => ({ value: v.id, label: v.tractor_plate ? `${v.name}, ${v.tractor_plate}` : v.name }))} />
                </Field>
                <Field label="Chauffeur" className={LIBELLE}><Select className={champ} value={form.driver_id} placeholder="Chauffeur habituel" onChange={(e) => setForm({ ...form, driver_id: e.target.value })} options={refs.drivers.map((d) => ({ value: d.id, label: d.name }))} /></Field>
                <Field label="Client" error={erreurs.partner_id} className={LIBELLE}><Select id="rotation-partner_id" aria-invalid={invalide("partner_id")} className={champ} value={form.partner_id} placeholder="Choisir le client" onChange={(e) => { corriger("partner_id"); setForm({ ...form, partner_id: e.target.value }); }} options={refs.clients.map((c) => ({ value: c.id, label: c.name }))} /></Field>
                <Field label="Route" error={erreurs.route_id} className={LIBELLE}><Select id="rotation-route_id" aria-invalid={invalide("route_id")} className={champ} value={form.route_id} placeholder="Choisir la route" onChange={(e) => { corriger("route_id"); setForm({ ...form, route_id: e.target.value }); }} options={refs.routes.map((r) => ({ value: r.id, label: r.distance_km ? `${r.name} (${r.distance_km} km)` : r.name }))} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Produit" className={LIBELLE}><Select className={champ} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} options={refs.products.map((p) => ({ value: p.code, label: p.label }))} /></Field>
                  <Field label="Bon de livraison" className={LIBELLE}><Input className={champ} value={form.delivery_note} onChange={(e) => setForm({ ...form, delivery_note: e.target.value })} /></Field>
                </div>
              </section>

              <section className={cx(FEUILLE, "grid grid-cols-2 gap-3 p-4")}>
                <Field label="Volume chargé (m³)" error={erreurs.volume_loaded} className={LIBELLE}><Input id="rotation-volume_loaded" aria-invalid={invalide("volume_loaded")} className={champVolume} inputMode="decimal" value={form.volume_loaded} onChange={(e) => { corriger("volume_loaded"); setForm({ ...form, volume_loaded: e.target.value }); }} /></Field>
                <Field label="Volume livré (m³)" className={LIBELLE}><Input className={cx(champVolume, "placeholder:font-sans placeholder:text-sm placeholder:font-normal")} inputMode="decimal" placeholder="Si déjà livré" value={form.volume_delivered} onChange={(e) => { corriger("volume_loaded"); setForm({ ...form, volume_delivered: e.target.value }); }} /></Field>
                {(refs.measures ?? []).map((m) => (
                  <Field key={m.code} label={m.label} className={LIBELLE}><Input className={champ} inputMode="decimal" value={form.measures[m.code] ?? ""} onChange={(e) => setForm({ ...form, measures: { ...form.measures, [m.code]: e.target.value } })} /></Field>
                ))}
              </section>

              <section className={cx(FEUILLE, "p-4")}>
                <button type="button" aria-expanded={showCosts} className={cx("flex min-h-12 w-full items-center justify-between gap-3 text-left text-[15px] font-semibold text-ink", SOUS_BARRE)} onClick={() => setShowCosts(!showCosts)}>
                  Frais de route
                  <span className="text-right text-[14px] font-normal text-muted">{showCosts ? "Masquer" : "Carburant, péages, frais de route…"}</span>
                </button>
                {showCosts && (
                  <div className="mt-3 grid grid-cols-2 items-end gap-3 border-t border-line pt-4">
                    {refs.costs.map((c) => (
                      <Field key={c.code} label={`${c.label} (GNF)`} className={LIBELLE}><Input className={cx(champ, "font-compteur font-semibold tracking-wide")} inputMode="numeric" value={grouper(form.costs[c.code] ?? "")} onChange={(e) => setForm({ ...form, costs: { ...form.costs, [c.code]: e.target.value } })} /></Field>
                    ))}
                  </div>
                )}
              </section>

              <Field label="Observations" className={LIBELLE}><Textarea className={cx("min-h-[72px] text-base", SOUS_BARRE)} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>

              {/* Barre d'action collée en bas : le bouton et son retour, là où se trouve le pouce. */}
              <div className={cx("-mx-4 border-t border-line-strong bg-panel px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-10px_24px_-18px_rgb(16_36_31/0.4)]", clavier ? "relative" : "sticky bottom-0 z-10")}>
                <div className="mb-2.5 flex min-h-5 items-start gap-2 text-[14px] leading-5">
                  <span aria-hidden className={cx("mt-0.5 flex-none", retour && TON_RETOUR[retour.tone])}>
                    {IconeRetour ? <IconeRetour className={cx("h-4 w-4", retour?.tone === "neutral" && "animate-spin")} /> : etat.icone}
                  </span>
                  <p role="status" className={cx("min-w-0 flex-1 font-semibold", retour ? TON_RETOUR[retour.tone] : "sr-only")}>{retour?.text ?? ""}</p>
                  {!retour && <p className="min-w-0 flex-1 text-muted">{etat.texte}</p>}
                </div>
                <div className="flex gap-2">
                  {form.uuid && phase === "repos" && <Button size="lg" className="min-h-14 px-5 text-base" onClick={() => { enCorrection.current = null; setForm(blank()); setErreurs({}); }}>Annuler</Button>}
                  <button
                    type="button"
                    onClick={() => void save()}
                    aria-disabled={phase !== "repos" || undefined}
                    aria-busy={phase === "ecriture" || undefined}
                    className={phase === "enregistree" ? BOUTON_FAIT : classesBouton("primary", "lg", "min-h-14 w-full flex-1 text-[17px]")}
                  >
                    {phase === "ecriture" ? (
                      <><Loader2 className="h-5 w-5 animate-spin" /> Enregistrement…</>
                    ) : phase === "enregistree" ? (
                      <><Check className="n-surgir h-5 w-5" /> Rotation enregistrée</>
                    ) : form.uuid ? "Enregistrer la correction" : "Enregistrer la rotation"}
                  </button>
                </div>
              </div>
            </div>
          )
        )}

        {view === "attente" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-[14px] text-muted">
              <span>{lastSync ? `Dernier envoi : ${quand(lastSync)}` : "Les saisies partent seules dès que le réseau revient."}</span>
              <Button size="lg" className="min-h-12" loading={syncing} disabled={!online || !aEnvoyer} onClick={() => void sync("envoi")}><RefreshCw className="h-4 w-4" /> Envoyer</Button>
            </div>
            {mine.length === 0 && <p className="py-8 text-center text-[15px] text-muted">Toutes vos saisies ont été transmises.</p>}
            {mine.map((item) => {
              const mot = item.status === "error" ? "Refusée" : item.status === "recue" ? "À corriger au bureau" : item.client_uuid === form.uuid ? "En correction" : "En attente";
              return (
                <div key={item.client_uuid} className={cx(FEUILLE, "n-surgir p-4 text-sm", item.status !== "pending" && "ring-2 ring-danger/60")}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent-doux text-accent">
                      <Truck className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-ink">{label("vehicles", item.payload.vehicle_id)}, {fmtDate(item.payload.date_loading)}</div>
                      <div className="mt-0.5 text-[14px] text-muted">{label("clients", item.payload.partner_id)}, {label("routes", item.payload.route_id)}</div>
                    </div>
                    {/* Le seul état vivant de l'écran est la pastille du réseau : le tampon ne bat pas. */}
                    <Badge tone={tonEtat(mot, "warn")}>{mot}</Badge>
                  </div>
                  <div className="mt-3 font-compteur text-[26px] font-bold text-ink">{fmtVolume(item.payload.volume_loaded ?? item.payload.volume_delivered)}{INSECABLE}<span className="text-[15px] font-semibold text-muted">m³</span></div>
                  {item.message && <div className="mt-2 text-[14px] font-semibold text-danger">{item.message}</div>}
                  <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
                    {/* Une correction que le bureau n'a pas prise ne repart pas : on la retire, le bureau corrige. */}
                    {item.status !== "recue" && <Button variant="ghost" size="lg" className="min-h-12" onClick={() => void ouvrirCorrection(item)}><Pencil className="h-4 w-4" /> Corriger</Button>}
                    <Button variant="danger" size="lg" className="min-h-12" onClick={() => void remove(item)}><Trash2 className="h-4 w-4" /> {item.status === "recue" ? "Retirer" : "Supprimer"}</Button>
                  </div>
                </div>
              );
            })}
            {others > 0 && <p className="text-[14px] text-muted">{pluriel(others, "saisie")} d&apos;un autre utilisateur {others > 1 ? "restent sur ce téléphone : elles partiront" : "reste sur ce téléphone : elle partira"} à sa prochaine connexion.</p>}
          </div>
        )}

        {view === "envoyees" && (
          <div className="space-y-2">
            {!online && <Notice tone="warn">Hors réseau : dernière liste connue.</Notice>}
            {sent === null ? (sentIndisponible
              ? <Notice tone="warn">Liste indisponible : le bureau n&apos;a pas pu être joint. Elle s&apos;affichera au retour du réseau.</Notice>
              : <p role="status" className="py-8 text-center text-sm text-muted">Chargement des rotations…</p>) : sent.length === 0 ? <p className="py-8 text-center text-sm text-muted">Aucune rotation.</p> : (
              <ul className={cx(FEUILLE, "divide-y divide-line px-4")}>
                {sent.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-3.5 text-sm">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-ink">{r.vehicle?.name ?? "–"}, {fmtDate(r.date_loading)}</div>
                      <div className="mt-0.5 text-[14px] text-muted">{r.client?.name ?? "–"}, {r.route?.name ?? "–"}{r.name ? `, ${r.name}` : ""}</div>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1">
                      <span className="font-compteur text-[19px] font-semibold text-ink">{fmtM3(r.volume_delivered || r.volume_loaded)}</span>
                      <Badge tone={tonEtat(STATE_LABEL[r.state])}>{STATE_LABEL[r.state]}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
