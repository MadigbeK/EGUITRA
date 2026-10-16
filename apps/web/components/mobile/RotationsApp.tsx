"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monogramme } from "@/components/brand";
import { CloudOff, LogOut, Pencil, RefreshCw, Trash2, Truck, Wifi } from "@/components/icons";
import { Badge, Button, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui";
import { ApiError, apiGet, apiSend } from "@/lib/api-client";
import { cache, claimCache, forgetDevice, newUuid, queue, type QueuedRotation } from "@/lib/offline-store";
import { fmtDate, fmtDec } from "@/lib/format";

interface Referentials {
  vehicles: Array<{ id: number; name: string; tractor_plate: string | false | null; capacity_liters: number; driver_id: number | null }>;
  drivers: Array<{ id: number; name: string }>;
  routes: Array<{ id: number; name: string; distance_km: number }>;
  clients: Array<{ id: number; name: string }>;
  products: Array<{ code: string; label: string }>;
  costs: Array<{ code: string; label: string }>;
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
}

type View = "saisie" | "attente" | "envoyees";

const STATE_LABEL: Record<SentRotation["state"], [string, "neutral" | "ok" | "accent" | "danger"]> = {
  draft: ["Reçue au bureau", "accent"],
  done: ["Validée", "ok"],
  invoiced: ["Facturée", "ok"],
  cancelled: ["Annulée", "danger"],
};

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): Form => ({
  uuid: null, date_loading: today(), vehicle_id: "", driver_id: "", partner_id: "", route_id: "", product: "gasoil",
  delivery_note: "", volume_loaded: "", volume_delivered: "", note: "", costs: {},
});
const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;

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
  return p;
}

function fromPayload(item: QueuedRotation, costs: Referentials["costs"]): Form {
  const p = item.payload;
  const s = (k: string) => (p[k] === undefined || p[k] === null ? "" : String(p[k]));
  return {
    uuid: item.client_uuid, date_loading: s("date_loading") || today(), vehicle_id: s("vehicle_id"), driver_id: s("driver_id"),
    partner_id: s("partner_id"), route_id: s("route_id"), product: s("product") || "gasoil", delivery_note: s("delivery_note"),
    volume_loaded: s("volume_loaded"), volume_delivered: s("volume_delivered"), note: s("note"),
    costs: Object.fromEntries(costs.map((c) => [c.code, s(c.code)]).filter(([, v]) => v)),
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
  const [form, setForm] = useState<Form>(blank);
  const [showCosts, setShowCosts] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const busy = useRef(false);

  const mine = items.filter((i) => i.user_id === me.id);
  const others = items.length - mine.length;

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
      const fresh = keepReferentials(await apiGet<Referentials>("/transport/referentials"));
      setRefs(fresh);
      await cache.set("referentials", fresh);
    } catch {
      if (!cached) setRefs(null);
    }
  }, []);

  const loadSent = useCallback(async () => {
    const cached = await cache.get<SentRotation[]>("sent").catch(() => undefined);
    if (cached) setSent(cached);
    if (!navigator.onLine) return;
    try {
      const res = await apiGet<{ items: SentRotation[] }>("/transport/rotations?limit=30");
      const items = res.items.map(keepSent);
      setSent(items);
      await cache.set("sent", items);
    } catch {
      /* hors réseau : on garde la dernière liste connue */
    }
  }, []);

  const sync = useCallback(async () => {
    if (busy.current || !navigator.onLine) return;
    const pending = (await loadQueue()).filter((i) => i.user_id === me.id);
    if (!pending.length) return;
    busy.current = true;
    setSyncing(true);
    let created = 0;
    let errors = 0;
    try {
      for (let i = 0; i < pending.length; i += 50) {
        const batch = pending.slice(i, i + 50);
        const res = await apiSend<{ results: Array<{ client_uuid: string | null; status: "created" | "exists" | "error"; message?: string }> }>(
          "POST", "/transport/sync", { rotations: batch.map((b) => ({ ...b.payload, client_uuid: b.client_uuid })) },
        );
        for (const r of res.results) {
          if (!r.client_uuid) continue;
          if (r.status === "error") {
            errors += 1;
            const item = batch.find((b) => b.client_uuid === r.client_uuid);
            if (item) await queue.put({ ...item, status: "error", message: r.message ?? "Saisie refusée." });
          } else {
            created += 1;
            await queue.remove(r.client_uuid);
          }
        }
      }
      setLastSync(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      if (errors) setNotice({ tone: "danger", text: `${errors} saisie(s) refusée(s) : corrigez-les dans « À envoyer ».` });
      else if (created) setNotice({ tone: "ok", text: `${created} rotation(s) transmise(s) au bureau.` });
    } catch (e) {
      setNotice({ tone: "warn", text: e instanceof ApiError ? e.message : "Réseau indisponible : les saisies partiront au retour du réseau." });
    } finally {
      busy.current = false;
      setSyncing(false);
      await loadQueue();
      void loadSent();
    }
  }, [loadQueue, loadSent, me.id]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void (async () => {
      await claimCache(me.id); // listes d'un autre compte effacées avant tout affichage
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
    const timer = window.setInterval(() => void sync(), 120_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [loadQueue, loadRefs, loadSent, sync, me.id]);

  async function save() {
    setNotice(null);
    if (!form.vehicle_id || !form.partner_id || !form.route_id) {
      setNotice({ tone: "danger", text: "Ensemble routier, client et route sont obligatoires." });
      return;
    }
    if (!num(form.volume_loaded) && !num(form.volume_delivered)) {
      setNotice({ tone: "danger", text: "Indiquez le volume chargé." });
      return;
    }
    const vehicle = refs?.vehicles.find((v) => String(v.id) === form.vehicle_id);
    if (vehicle?.capacity_liters && num(form.volume_loaded) * 1000 > vehicle.capacity_liters * 1.05 &&
      !window.confirm(`Le volume chargé dépasse la capacité de ${vehicle.name} (${fmtDec(vehicle.capacity_liters / 1000)} m³). Enregistrer quand même ?`)) {
      return;
    }
    const item: QueuedRotation = {
      client_uuid: form.uuid ?? newUuid(), user_id: me.id, created_at: new Date().toISOString(), status: "pending",
      payload: toPayload(form),
    };
    await queue.put(item);
    setForm({ ...blank(), date_loading: form.date_loading });
    setShowCosts(false);
    await loadQueue();
    if (navigator.onLine) await sync();
    else setNotice({ tone: "warn", text: "Rotation enregistrée sur le téléphone : elle partira au retour du réseau." });
  }

  async function remove(item: QueuedRotation) {
    if (!window.confirm("Supprimer cette saisie du téléphone ? Elle ne sera pas transmise.")) return;
    await queue.remove(item.client_uuid);
    await loadQueue();
  }

  async function logout() {
    if (mine.length && !window.confirm(`${mine.length} saisie(s) n'ont pas encore été transmises. Elles restent sur ce téléphone et partiront à votre prochaine connexion. Se déconnecter ?`)) return;
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

  const champ = "min-h-12 text-base";
  const views: Array<[View, string, number | null]> = [
    ["saisie", "Nouvelle", null],
    ["attente", "À envoyer", mine.length],
    ["envoyees", "Envoyées", null],
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="sur-dos sticky top-0 z-10 bg-[linear-gradient(135deg,#c4471d_0%,#983210_60%,#142f29_140%)] text-white shadow-[0_10px_30px_-18px_rgb(152_50_16/0.8)]">
        <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-white/15">
            <Monogramme tuile={false} className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-display text-[19px] font-bold">Rotations</div>
            <div className="truncate text-[12.5px] text-white/95">{me.name}</div>
          </div>
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold",
              online ? "bg-white/15 text-white" : "bg-or text-foret",
            )}
          >
            {online ? <span aria-hidden className="n-pouls h-2 w-2 rounded-full bg-menthe" style={{ ["--pouls" as string]: "rgb(165 230 194 / 0.7)" } as import("react").CSSProperties} /> : <CloudOff className="h-3.5 w-3.5" />}
            {online && <Wifi className="h-3.5 w-3.5" />} {online ? "En ligne" : "Hors réseau"}
          </span>
          <button type="button" onClick={logout} aria-label="Se déconnecter" className="-mr-1.5 grid h-11 w-11 place-items-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="grid grid-cols-3 px-2 text-[15px]">
          {views.map(([key, text, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-current={view === key ? "page" : undefined}
              className={cx("flex min-h-12 items-center justify-center gap-2 border-b-[3px] font-semibold transition-colors", view === key ? "border-white text-white" : "border-transparent text-white/90")}
            >
              {text}
              {count ? <span className="n-surgir grid h-5 min-w-5 place-items-center rounded-full bg-or px-1.5 font-compteur text-[12.5px] font-bold text-foret">{count}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-10 pt-5">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {view === "saisie" && (
          refs === undefined ? <p role="status" className="py-10 text-center text-sm text-muted">Chargement des listes…</p> :
          refs === null ? <Notice tone="warn">Les listes (camions, clients, routes) ne sont pas encore sur ce téléphone. Ouvrez l&apos;application une première fois avec du réseau.</Notice> : (
            <div className="space-y-4">
              {form.uuid && <Notice tone="accent">Correction d&apos;une saisie en attente.</Notice>}
              <section className="space-y-4 rounded-2xl border border-line bg-panel p-4 shadow-[var(--ombre-carte)]">
                <Field label="Date de chargement"><Input className={champ} type="date" value={form.date_loading} onChange={(e) => setForm({ ...form, date_loading: e.target.value })} /></Field>
                <Field label="Ensemble routier">
                  <Select className={champ} value={form.vehicle_id} placeholder="Choisir le camion" onChange={(e) => {
                    const v = refs.vehicles.find((x) => String(x.id) === e.target.value);
                    setForm({ ...form, vehicle_id: e.target.value, driver_id: v?.driver_id ? String(v.driver_id) : form.driver_id });
                  }} options={refs.vehicles.map((v) => ({ value: v.id, label: v.tractor_plate ? `${v.name}, ${v.tractor_plate}` : v.name }))} />
                </Field>
                <Field label="Chauffeur"><Select className={champ} value={form.driver_id} placeholder="Chauffeur habituel" onChange={(e) => setForm({ ...form, driver_id: e.target.value })} options={refs.drivers.map((d) => ({ value: d.id, label: d.name }))} /></Field>
                <Field label="Client"><Select className={champ} value={form.partner_id} placeholder="Choisir le client" onChange={(e) => setForm({ ...form, partner_id: e.target.value })} options={refs.clients.map((c) => ({ value: c.id, label: c.name }))} /></Field>
                <Field label="Route"><Select className={champ} value={form.route_id} placeholder="Choisir la route" onChange={(e) => setForm({ ...form, route_id: e.target.value })} options={refs.routes.map((r) => ({ value: r.id, label: r.distance_km ? `${r.name} (${r.distance_km} km)` : r.name }))} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Produit"><Select className={champ} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} options={refs.products.map((p) => ({ value: p.code, label: p.label }))} /></Field>
                  <Field label="Bon de livraison"><Input className={champ} value={form.delivery_note} onChange={(e) => setForm({ ...form, delivery_note: e.target.value })} /></Field>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-panel p-4 shadow-[var(--ombre-carte)]">
                <Field label="Volume chargé (m³)"><Input className="min-h-14 font-compteur text-[28px] font-semibold tracking-wide" inputMode="decimal" value={form.volume_loaded} onChange={(e) => setForm({ ...form, volume_loaded: e.target.value })} /></Field>
                <Field label="Volume livré (m³)"><Input className="min-h-14 font-compteur text-[28px] font-semibold tracking-wide placeholder:font-sans placeholder:text-sm placeholder:font-normal" inputMode="decimal" placeholder="Si déjà livré" value={form.volume_delivered} onChange={(e) => setForm({ ...form, volume_delivered: e.target.value })} /></Field>
              </section>

              <section className="rounded-2xl border border-line bg-panel p-4 shadow-[var(--ombre-carte)]">
                <button type="button" aria-expanded={showCosts} className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[15px] font-medium text-ink" onClick={() => setShowCosts(!showCosts)}>
                  Frais de route
                  <span className="text-right text-[13px] font-normal text-muted">{showCosts ? "Masquer" : "Carburant, péages, frais de route…"}</span>
                </button>
                {showCosts && (
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-4">
                    {refs.costs.map((c) => (
                      <Field key={c.code} label={`${c.label} (GNF)`}><Input className={champ} inputMode="numeric" value={form.costs[c.code] ?? ""} onChange={(e) => setForm({ ...form, costs: { ...form.costs, [c.code]: e.target.value } })} /></Field>
                    ))}
                  </div>
                )}
              </section>

              <Field label="Observations"><Textarea className="min-h-[72px] text-base" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
              <div className="flex gap-2 pt-1">
                {form.uuid && <Button className="min-h-14 flex-1 text-base" onClick={() => setForm(blank())}>Annuler</Button>}
                <Button variant="primary" className="min-h-14 flex-1 text-base" onClick={save}>Enregistrer la rotation</Button>
              </div>
            </div>
          )
        )}

        {view === "attente" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
              <span>{lastSync ? `Dernier envoi à ${lastSync}` : "Les saisies partent seules dès que le réseau revient."}</span>
              <Button className="min-h-11 px-4" loading={syncing} disabled={!online || !mine.length} onClick={() => void sync()}><RefreshCw className="h-4 w-4" /> Envoyer</Button>
            </div>
            {mine.length === 0 && <p className="py-8 text-center text-sm text-muted">Toutes vos saisies ont été transmises.</p>}
            {mine.map((item) => (
              <div key={item.client_uuid} className={cx("n-surgir rounded-2xl border bg-panel p-4 text-sm shadow-[var(--ombre-carte)]", item.status === "error" ? "border-danger/40" : "border-line")}>
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-accent-doux text-accent">
                    <Truck className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{label("vehicles", item.payload.vehicle_id)}, {fmtDate(item.payload.date_loading)}</div>
                    <div className="mt-0.5 text-[13px] text-muted">{label("clients", item.payload.partner_id)}, {label("routes", item.payload.route_id)}</div>
                  </div>
                  <Badge tone={item.status === "error" ? "danger" : "warn"} vivant={item.status !== "error"}>{item.status === "error" ? "Refusée" : "En attente"}</Badge>
                </div>
                <div className="mt-3 font-compteur text-[26px] font-bold text-ink">{fmtDec(item.payload.volume_loaded ?? item.payload.volume_delivered)} <span className="text-[15px] font-semibold text-muted">m³</span></div>
                {item.message && <div className="mt-2 text-[13px] font-medium text-danger">{item.message}</div>}
                <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
                  <Button variant="ghost" className="min-h-11" onClick={() => { if (refs) { setForm(fromPayload(item, refs.costs)); setView("saisie"); } }}><Pencil className="h-4 w-4" /> Corriger</Button>
                  <Button variant="danger" className="min-h-11" onClick={() => void remove(item)}><Trash2 className="h-4 w-4" /> Supprimer</Button>
                </div>
              </div>
            ))}
            {others > 0 && <p className="text-[13px] text-muted">{others} saisie(s) d&apos;un autre utilisateur restent sur ce téléphone : elles partiront à sa prochaine connexion.</p>}
          </div>
        )}

        {view === "envoyees" && (
          <div className="space-y-2">
            {!online && <Notice tone="warn">Hors réseau : dernière liste connue.</Notice>}
            {sent === null ? <p role="status" className="py-8 text-center text-sm text-muted">Chargement des rotations…</p> : sent.length === 0 ? <p className="py-8 text-center text-sm text-muted">Aucune rotation.</p> : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-panel px-4 shadow-[var(--ombre-carte)]">
                {sent.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-3.5 text-sm">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{r.vehicle?.name ?? "–"}, {fmtDate(r.date_loading)}</div>
                      <div className="mt-0.5 text-[13px] text-muted">{r.client?.name ?? "–"}, {r.route?.name ?? "–"}{r.name ? `, ${r.name}` : ""}</div>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1">
                      <span className="font-compteur text-[19px] font-semibold text-ink">{fmtDec(r.volume_delivered || r.volume_loaded)} m³</span>
                      <Badge tone={STATE_LABEL[r.state][1]}>{STATE_LABEL[r.state][0]}</Badge>
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
