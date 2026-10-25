"use client";

import { useState } from "react";
import { Fuel, Trash2 } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, Input, Notice, Select, cx, demanderConfirmation } from "@/components/ui";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import { AIDE_NOMBRE, fmtDate, fmtGNF, fmtInt, nombreIllisible } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { EcartBareme, libelleBareme, type OfficialScale } from "./Bareme";
import { CHAMP_INVALIDE, INSECABLE, NombreSurPlace, fmtFixe } from "./commun";
import { parseNumber, type Message, type OfficialRate, type RateGap, type Ref, type Referentials, type RouteStandards, type TransportSettings } from "./types";

// Profils de la route d'écriture des routes et des tarifs du noyau (WRITE) : la direction lit seulement.
const SAISIE: Profile[] = ["admin", "finance", "exploitation"];

interface Tariff { id: number; partner: Ref; product: string | null; rate: number; shortage_tolerance: number | null; shortage_price: number | null; official_gap: RateGap | null }
interface RouteRow extends RouteStandards {
  id: number; name: string; distance_km: number; distance_return_km: number | null; round_trip_km: number; round_trip_inconsistent: boolean;
  duration_days: number | null; default_rate: number; tariffs: Tariff[]; fuel_per_km: number | null;
  /** Destination du barème officiel rattachée, tarif officiel en vigueur, écart du tarif par défaut. */
  official_rate_id: number | null; official_rate: OfficialRate | null; default_rate_gap: RateGap | null;
  /** Sans rattachement : destination du barème que suggère le nom de la route. */
  official_suggestion: OfficialRate | null;
}

/** Tarif envoyé au noyau : un seul par client et par produit (le noyau met à jour celui qui existe). */
interface TarifEnvoye { partner_id: number; product: string | null; rate: number }

/**
 * Tarifs d'une route à renvoyer en entier : celui du même client et du même produit est remplacé (un
 * tarif renégocié ne s'ajoute pas à l'ancien) ; retire : tarif supprimé (finance).
 */
function tarifsDe(route: RouteRow, change?: TarifEnvoye, retire?: number): TarifEnvoye[] {
  const liste = route.tariffs.filter((t) => t.id !== retire).map((t) => ({ partner_id: t.partner.id, product: t.product, rate: t.rate }));
  if (!change) return liste;
  const i = liste.findIndex((t) => t.partner_id === change.partner_id && (t.product ?? null) === (change.product ?? null));
  return i >= 0 ? liste.map((t, j) => (j === i ? change : t)) : [...liste, change];
}

const VIDE_ROUTE = { name: "", distance_km: "", distance_return_km: "", duration_days: "", default_rate: "" };
const VIDE_TARIF = { route_id: "", partner_id: "", product: "", rate: "" };

/** Routes, coûts standard, prix du carburant, tarifs négociés et conditions de manquant. */
export function RoutesTarifs() {
  const { data: routes, error, mutate } = useApi<RouteRow[]>("/transport/routes");
  const { data: ref } = useApi<Referentials>("/transport/referentials");
  const { data: settings } = useApi<TransportSettings>("/transport/settings");
  const { data: bareme } = useApi<OfficialScale>("/transport/official-rates");
  const saisie = useAutorise(SAISIE);
  const finance = Boolean(settings?.can_edit);
  const destinations = (bareme?.items ?? []).map((o) => ({ value: o.id, label: libelleBareme(o) }));
  // Le message dit son état (réussite ou erreur) : la couleur du Transport n'en dit aucun.
  const [message, setMessage] = useState<Message>(null);
  const [envoi, setEnvoi] = useState<"route" | "tarif" | null>(null);
  const echec = (e: unknown) => setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
  const productLabel = (code: string | null) => (code ? ref?.products.find((p) => p.code === code)?.label ?? code : "Tous produits");
  const tariffs = (routes ?? []).flatMap((route) => route.tariffs.map((t) => ({ ...t, route })));

  async function envoyer(path: string, body: Record<string, unknown>, ok?: string) {
    setMessage(null);
    try {
      await apiSend("PATCH", path, body);
      if (ok) setMessage({ tone: "ok", text: ok });
      void mutate();
      return true;
    } catch (e) {
      echec(e);
      return false;
    }
  }
  const patchRoute = (route: RouteRow, body: Record<string, unknown>, ok?: string) => envoyer(`/transport/routes/${route.id}`, body, ok);

  const [r, setR] = useState(VIDE_ROUTE);
  const routeIllisible = (["distance_km", "distance_return_km", "duration_days", "default_rate"] as const).some((k) => nombreIllisible(r[k]));
  async function ajouterRoute() {
    setEnvoi("route");
    setMessage(null);
    try {
      await apiSend("POST", "/transport/routes", {
        name: r.name, distance_km: Math.round(parseNumber(r.distance_km) ?? 0), distance_return_km: Math.round(parseNumber(r.distance_return_km) ?? 0),
        duration_days: parseNumber(r.duration_days) ?? 0, default_rate: parseNumber(r.default_rate) ?? 0,
      });
      setR(VIDE_ROUTE);
      void mutate();
    } catch (e) {
      echec(e);
    } finally {
      setEnvoi(null);
    }
  }

  const [tariff, setTariff] = useState(VIDE_TARIF);
  async function enregistrerTarif() {
    const route = routes?.find((x) => x.id === Number(tariff.route_id));
    const rate = parseNumber(tariff.rate);
    if (!route || rate === null) return;
    const change = { partner_id: Number(tariff.partner_id), product: tariff.product || null, rate };
    const ancien = route.tariffs.find((t) => t.partner.id === change.partner_id && (t.product ?? null) === change.product);
    setEnvoi("tarif");
    const ok = await patchRoute(route, { tariffs: tarifsDe(route, change) },
      ancien ? `Tarif remplacé : ${fmtInt(ancien.rate)} → ${fmtInt(rate)} GNF par m³.` : "Tarif enregistré.");
    setEnvoi(null);
    if (ok) setTariff(VIDE_TARIF);
  }
  async function supprimerTarif(t: Tariff & { route: RouteRow }) {
    if (!(await demanderConfirmation(`Supprimer le tarif de ${t.partner.name} (${productLabel(t.product)}) sur ${t.route.name} ? Les rotations prendront le tarif de la route.`, { action: "Supprimer le tarif", danger: true }))) return;
    void patchRoute(t.route, { tariffs: tarifsDe(t.route, undefined, t.id) }, "Tarif supprimé.");
  }

  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card title="Routes tarifées" padded={false}>
        {!routes ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable rows={routes} rowKey={(x) => x.id} empty="Aucune route." columns={[
            { key: "name", label: "Route" },
            { key: "distance_km", label: "Aller (km)", align: "right", render: (x) => <NombreSurPlace label={`Aller de ${x.name} (km)`} disabled={!saisie} className="w-24" value={x.distance_km} onCommit={(n) => void patchRoute(x, { distance_km: Math.round(n ?? 0) })} /> },
            { key: "distance_return_km", label: "Aller-retour (km)", align: "right", render: (x) => (
              <span className="inline-flex items-center gap-2">
                {x.round_trip_inconsistent && <span title="Écart de plus de 15 % avec deux fois l'aller"><Badge tone="warn">Incohérent</Badge></span>}
                <NombreSurPlace label={`Aller-retour de ${x.name} (km)`} disabled={!saisie} className="w-24" placeholder={String(x.round_trip_km || "")} value={x.distance_return_km} onCommit={(n) => void patchRoute(x, { distance_return_km: Math.round(n ?? 0) })} />
              </span>
            ) },
            { key: "duration_days", label: "Durée (j)", align: "right", render: (x) => <NombreSurPlace label={`Durée de ${x.name} (jours)`} disabled={!saisie} className="w-20" value={x.duration_days} onCommit={(n) => void patchRoute(x, { duration_days: n ?? 0 })} /> },
            { key: "default_rate", label: "Tarif par m³ (GNF)", align: "right", render: (x) => (
              <span className="inline-flex items-center gap-2">
                <EcartBareme gap={x.default_rate_gap} />
                <NombreSurPlace label={`Tarif par défaut de ${x.name} (GNF par m³)`} disabled={!saisie} className="w-28" value={x.default_rate} onCommit={(n) => void patchRoute(x, { default_rate: n ?? 0 })} />
              </span>
            ) },
            { key: "official_rate", label: "Barème officiel (GNF par m³)", render: (x) => (
              <span className="flex min-w-64 flex-col gap-1">
                <Select disabled={!saisie} value={x.official_rate_id ?? ""} placeholder="Sans référence" onChange={(e) => void patchRoute(x, { official_rate_id: e.target.value ? Number(e.target.value) : null })} options={destinations} />
                {x.official_rate ? (
                  <span className="font-mono text-[12px] text-muted">{fmtInt(x.official_rate.rate_per_m3)}{INSECABLE}GNF/m³, {x.official_rate.scale.name}</span>
                ) : x.official_suggestion && saisie ? (
                  <button type="button" className="self-start text-[12px] font-semibold text-accent hover:underline" onClick={() => void patchRoute(x, { official_rate_id: x.official_suggestion!.id })}>
                    Rattacher à {libelleBareme(x.official_suggestion)}
                  </button>
                ) : null}
              </span>
            ) },
            { key: "std_fuel_liters", label: "Carburant réf. (L)", align: "right", render: (x) => (
              <span className="inline-flex items-center gap-2">
                {x.fuel_per_km !== null && <span className="text-[11.5px] text-muted" title="Litres par km parcouru, aller et retour">{fmtFixe(x.fuel_per_km, 2)}{INSECABLE}L/km</span>}
                <NombreSurPlace label={`Carburant de référence de ${x.name} (litres)`} disabled={!saisie} className="w-20" value={x.std_fuel_liters} onCommit={(n) => void patchRoute(x, { std_fuel_liters: n ?? 0 })} />
              </span>
            ) },
            ...(["std_driver_bonus", "std_tolls", "std_other_costs"] as const).map((k) => {
              const label = { std_driver_bonus: "Prime de route", std_tolls: "Péages", std_other_costs: "Autres frais" }[k];
              return {
                key: k, label, align: "right" as const,
                render: (x: RouteRow) => <NombreSurPlace label={`${label} de ${x.name} (GNF)`} disabled={!saisie} className="w-28" value={x[k]} onCommit={(n) => void patchRoute(x, { [k]: n ?? 0 })} />,
              };
            }),
          ]} />
        )}
        {saisie && routes && (
          <div className="grid grid-cols-2 items-start gap-2 border-t border-line p-3 md:grid-cols-6">
            <Field label="Route"><Input placeholder="Conakry - Siguiri" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
            {([["distance_km", "Aller (km)"], ["distance_return_km", "Aller-retour (km)"], ["duration_days", "Durée (jours)"], ["default_rate", "Tarif par m³ (GNF)"]] as const).map(([k, label]) => (
              <Field key={k} label={label} error={nombreIllisible(r[k]) ? AIDE_NOMBRE : undefined}>
                <Input inputMode="decimal" aria-invalid={nombreIllisible(r[k]) || undefined} className={cx("font-mono", CHAMP_INVALIDE)} value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })} />
              </Field>
            ))}
            <Button variant="primary" className="mt-6" loading={envoi === "route"} disabled={!r.name.trim() || routeIllisible} onClick={() => void ajouterRoute()}>Ajouter la route</Button>
          </div>
        )}
      </Card>
      <PrixCarburant canEdit={finance} />
      <Card title="Tarifs des clients" padded={false}>
        <p className="px-5 pt-4 text-[13px] text-muted">
          Un tarif par client et par produit sur une route : un nouveau tarif du même client et du même produit remplace l&apos;ancien. Tolérance et
          prix du m³ manquant prévus au contrat ; vides, ceux du client ou de la société et le prix du produit s&apos;appliquent. Conditions et
          suppression fixées par la finance.
        </p>
        {!routes ? <Etat error={error} onRetry={() => mutate()} /> : (
          <DataTable rows={tariffs} rowKey={(t) => t.id} empty="Aucun tarif négocié." columns={[
            { key: "route", label: "Route", render: (t) => t.route.name, sortValue: (t) => t.route.name },
            { key: "partner", label: "Client", render: (t) => t.partner.name, sortValue: (t) => t.partner.name },
            { key: "product", label: "Produit", render: (t) => productLabel(t.product) },
            { key: "rate", label: "Tarif par m³ (GNF)", align: "right", render: (t) => (
              <span className="inline-flex items-center gap-2">
                <EcartBareme gap={t.official_gap} />
                <NombreSurPlace label={`Tarif de ${t.partner.name} (GNF par m³)`} disabled={!saisie} className="w-28" value={t.rate}
                  onCommit={(n) => void patchRoute(t.route, { tariffs: tarifsDe(t.route, { partner_id: t.partner.id, product: t.product, rate: n ?? 0 }) }, `Tarif de ${t.partner.name} enregistré.`)} />
              </span>
            ) },
            { key: "shortage_tolerance", label: "Tolérance (%)", align: "right", render: (t) => <NombreSurPlace nullable label={`Tolérance de manquant de ${t.partner.name} (%)`} disabled={!finance} className="w-24" placeholder="–" value={t.shortage_tolerance} onCommit={(n) => void envoyer(`/transport/tariffs/${t.id}`, { shortage_tolerance: n }, `Conditions de manquant de ${t.partner.name} enregistrées.`)} /> },
            { key: "shortage_price", label: "Prix du m³ manquant", align: "right", render: (t) => <NombreSurPlace label={`Prix du m³ manquant de ${t.partner.name}`} disabled={!finance} className="w-36" placeholder="Prix du produit" value={t.shortage_price} onCommit={(n) => void envoyer(`/transport/tariffs/${t.id}`, { shortage_price: n ?? 0 }, `Conditions de manquant de ${t.partner.name} enregistrées.`)} /> },
            ...(finance ? [{ key: "actions", label: "", render: (t: Tariff & { route: RouteRow }) => (
              <button type="button" title="Supprimer le tarif" aria-label={`Supprimer le tarif de ${t.partner.name}`} className="text-muted hover:text-danger" onClick={() => void supprimerTarif(t)}><Trash2 className="h-4 w-4" /></button>
            ) }] : []),
          ]} />
        )}
        {saisie && routes && (
          <div className="grid grid-cols-1 items-start gap-2 border-t border-line p-3 md:grid-cols-5">
            <Field label="Route"><Select value={tariff.route_id} onChange={(e) => setTariff({ ...tariff, route_id: e.target.value })} placeholder="Route…" options={routes.map((x) => ({ value: x.id, label: x.name }))} /></Field>
            <Field label="Client"><Select value={tariff.partner_id} onChange={(e) => setTariff({ ...tariff, partner_id: e.target.value })} placeholder="Client…" options={(ref?.clients ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Produit"><Select value={tariff.product} onChange={(e) => setTariff({ ...tariff, product: e.target.value })} placeholder="Tous produits" options={(ref?.products ?? []).map((p) => ({ value: p.code, label: p.label }))} /></Field>
            <Field label="Tarif par m³ (GNF)" error={nombreIllisible(tariff.rate) ? AIDE_NOMBRE : undefined}>
              <Input inputMode="decimal" aria-invalid={nombreIllisible(tariff.rate) || undefined} className={cx("font-mono", CHAMP_INVALIDE)} value={tariff.rate} onChange={(e) => setTariff({ ...tariff, rate: e.target.value })} />
            </Field>
            <Button variant="primary" className="mt-6" loading={envoi === "tarif"} disabled={!tariff.route_id || !tariff.partner_id || !parseNumber(tariff.rate)} onClick={() => void enregistrerTarif()}>
              Enregistrer le tarif
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Prix du carburant de la flotte : coût standard des rotations (prix applicable à la date de chargement). */
function PrixCarburant({ canEdit }: { canEdit: boolean }) {
  const { data, error, mutate } = useApi<{ current: number; items: Array<{ id: number; date_from: string; price: number; note: string | null }> }>("/transport/fuel-prices");
  const [form, setForm] = useState({ date_from: new Date().toISOString().slice(0, 10), price: "", note: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(method: "POST" | "DELETE", path: string, body?: Record<string, unknown>) {
    setMessage(null);
    setBusy(true);
    try {
      await apiSend(method, path, body);
      void mutate();
      return true;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Enregistrement impossible.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function supprimer(x: { id: number; date_from: string; price: number }) {
    if (!(await demanderConfirmation(`Supprimer le prix de ${fmtGNF(x.price)} par litre en vigueur à partir du ${fmtDate(x.date_from)} ? Les rotations en saisie reprendront le prix précédent.`, { action: "Supprimer le prix", danger: true }))) return;
    void send("DELETE", `/transport/fuel-prices/${x.id}`);
  }
  const prixIllisible = nombreIllisible(form.price);
  return (
    <Card title="Prix du carburant" padded={false} actions={data ? <span className="inline-flex items-center gap-1.5 text-[13px] text-muted"><Fuel className="h-4 w-4" /> En vigueur : <span className="whitespace-nowrap font-mono text-ink">{data.current ? `${fmtGNF(data.current)}${INSECABLE}/${INSECABLE}L` : "non renseigné"}</span></span> : undefined}>
      <p className="px-5 pt-4 text-[13px] text-muted">
        Prix du litre appliqué aux forfaits de carburant des routes (coût standard). Une rotation prend le prix en vigueur à sa date de
        chargement ; validée, elle le garde : un nouveau prix ne réécrit pas les rotations passées.
      </p>
      {message && <div className="px-5 pt-3"><Notice tone="danger">{message}</Notice></div>}
      {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
        <DataTable rows={data.items} rowKey={(x) => x.id} empty="Aucun prix enregistré." columns={[
          { key: "date_from", label: "À partir du", render: (x) => fmtDate(x.date_from) },
          { key: "price", label: "Prix du litre (GNF)", align: "right", render: (x) => fmtInt(x.price) },
          { key: "note", label: "Source", render: (x) => x.note ?? "–" },
          ...(canEdit ? [{ key: "actions", label: "", render: (x: { id: number; date_from: string; price: number }) => (
            <button type="button" title="Supprimer" aria-label={`Supprimer le prix du ${fmtDate(x.date_from)}`} className="text-muted hover:text-danger" onClick={() => void supprimer(x)}><Trash2 className="h-4 w-4" /></button>
          ) }] : []),
        ]} />
      )}
      {canEdit && (
        <div className="grid grid-cols-2 items-start gap-2 border-t border-line p-3 md:grid-cols-5">
          <Field label="À partir du"><Input type="date" value={form.date_from} onChange={(e) => setForm({ ...form, date_from: e.target.value })} /></Field>
          <Field label="Prix du litre (GNF)" error={prixIllisible ? AIDE_NOMBRE : undefined}>
            <Input inputMode="decimal" aria-invalid={prixIllisible || undefined} className={cx("font-mono", CHAMP_INVALIDE)} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label="Source" className="md:col-span-2"><Input placeholder="Structure des prix d'octobre…" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <Button variant="primary" className="mt-6" loading={busy} disabled={!form.date_from || !parseNumber(form.price)} onClick={() => void send("POST", "/transport/fuel-prices", { date_from: form.date_from, price: parseNumber(form.price), note: form.note || null }).then((ok) => ok && setForm({ ...form, price: "", note: "" }))}>Enregistrer le prix</Button>
        </div>
      )}
    </Card>
  );
}
