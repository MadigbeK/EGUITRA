"use client";

/**
 * Déclaration web d'un événement (POST /hsseq/events, §5), et correction de la déclaration
 * (PATCH /hsseq/events/{id}) avec le même formulaire. Les photos suivent la création, rattachées à
 * la fiche (POST /hsseq/attachments, model « event »). La criticité potentielle se calcule à l'écran
 * à titre indicatif et son effet (§9.1) s'annonce : le noyau n'enregistre pas les notes du déclarant
 * (proposition, §14 du contrat), le Responsable HSSEQ les fixe au classement.
 *
 * Personnes en cause : `person_id` désigne le chauffeur (référentiels) ou le salarié RH ; la liste des
 * salariés n'étant pas servie (proposition, §14), un salarié se nomme librement.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { FileText, Plus, Trash2, X } from "@/components/icons";
import { Button, Field, Input, Modal, Notice, Select, Textarea, classesBouton, cx } from "@/components/ui";
import { DOMAINE, ROLE_PERSONNE, TYPE_EVENEMENT, TYPE_VEHICULE, Criticite, criticite, nomRotation } from "@/components/hsseq/commun";
import { apiSend, apiUpload, useApi } from "@/lib/api-client";
import { INSECABLE, fmtInt } from "@/lib/format";
import type { Attachment, Departures, Domain, Event as Evenement, EventReport, EventType, MyRotations, PersonInput, PersonRole, RotationRef, Score } from "@/lib/hsseq-types";
import { ChoixNote, NATURE_PERSONNE, champsRefus, effetCriticite, isoDepuisLocal, localDepuisIso, messageRefus, newUuid, niveauSelon, sitesDuCompte, useReferentiels } from "./commun";

type NaturePersonne = "driver" | "employee" | "third_party";

interface LignePersonne {
  cle: string;
  kind: NaturePersonne;
  /** Chauffeur ou salarié RH désigné ; nul pour un tiers ou un salarié nommé librement. */
  person_id: number | null;
  name: string;
  role: PersonRole;
  days_off: number;
}

interface Photo {
  cle: string;
  fichier: File;
  apercu: string | null;
}

/** Formats et taille acceptés par le noyau (eguitra_api/files.py, §11). */
const FORMATS = ["image/jpeg", "image/png", "application/pdf"];
const TAILLE_MAX = 8 * 1024 * 1024;

const OPTIONS_TYPES = (Object.keys(TYPE_EVENEMENT) as EventType[]).map((t) => ({ value: t, label: TYPE_EVENEMENT[t].label }));
const OPTIONS_DOMAINES = (Object.keys(DOMAINE) as Domain[]).map((d) => ({ value: d, label: DOMAINE[d] }));
const OPTIONS_ROLES = (Object.keys(ROLE_PERSONNE) as PersonRole[]).map((r) => ({ value: r, label: ROLE_PERSONNE[r] }));
const OPTIONS_NATURES = (Object.keys(NATURE_PERSONNE) as NaturePersonne[]).map((k) => ({ value: k, label: NATURE_PERSONNE[k] }));


function taille(octets: number): string {
  return octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${INSECABLE}Mo` : `${fmtInt(Math.ceil(octets / 1024))}${INSECABLE}ko`;
}

let compteur = 0;
const cle = () => `l${++compteur}`;

/**
 * Fenêtre de déclaration. Sans `evenement`, elle déclare (statut « déclaré », notes proposées,
 * photos) ; avec, elle corrige la déclaration (droit `can_edit` de la fiche), sans notes ni photos :
 * les notes se fixent au classement, les pièces se joignent depuis la fiche.
 */
export function Declaration({ open, onClose, evenement, onEnregistre }: { open: boolean; onClose: () => void; evenement?: Evenement; onEnregistre: (e: Evenement) => void }) {
  if (!open) return null;
  return <Formulaire onClose={onClose} evenement={evenement} onEnregistre={onEnregistre} />;
}

function Formulaire({ onClose, evenement, onEnregistre }: { onClose: () => void; evenement?: Evenement; onEnregistre: (e: Evenement) => void }) {
  const edition = Boolean(evenement);
  const formId = useId();
  const { data: ref } = useReferentiels();
  // Idempotence (§1) : un même envoi rejoué ne crée qu'un événement.
  const uuid = useRef(newUuid());

  const [type, setType] = useState<EventType | "">(evenement?.type ?? "");
  const [domaine, setDomaine] = useState<Domain | "">(evenement?.domain ?? "");
  const [domaineChoisi, setDomaineChoisi] = useState(edition);
  const [titre, setTitre] = useState(evenement?.title ?? "");
  const [survenu, setSurvenu] = useState(localDepuisIso(evenement?.occurred_at));
  const [site, setSite] = useState<string>(evenement?.site ? String(evenement.site.id) : "");
  const [lieu, setLieu] = useState(evenement?.location ?? "");
  const [description, setDescription] = useState(evenement?.description ?? "");
  const [vehicule, setVehicule] = useState<string>(evenement?.vehicle ? String(evenement.vehicle.id) : "");
  const [rotation, setRotation] = useState<string>(evenement?.rotation ? String(evenement.rotation.id) : "");
  const [personnes, setPersonnes] = useState<LignePersonne[]>(() => (evenement?.people ?? []).map((p) => ({ cle: cle(), kind: p.kind, person_id: p.person_id, name: p.name, role: p.role, days_off: p.days_off })));
  const [reelle, setReelle] = useState<Score | null>(null);
  const [potentielle, setPotentielle] = useState<Score | null>(null);
  const [probabilite, setProbabilite] = useState<Score | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [refusPhoto, setRefusPhoto] = useState<string | null>(null);

  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [champs, setChamps] = useState<string[]>([]);
  const [tente, setTente] = useState(false);
  // Événement créé, photos en partie refusées : la fenêtre le dit avant d'ouvrir la fiche.
  const [cree, setCree] = useState<{ evenement: Evenement; echecs: Array<{ nom: string; motif: string }> } | null>(null);

  // Aperçus des photos : libérés au retrait et à la fermeture.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => p.apercu && URL.revokeObjectURL(p.apercu)), []);

  const sites = sitesDuCompte(ref);
  const vehicules = useMemo(() => {
    const tous = ref?.vehicles ?? [];
    return site ? tous.filter((v) => v.site_id === Number(site) || String(v.id) === vehicule) : tous;
  }, [ref, site, vehicule]);

  // Rotations rattachables : celles chargées le jour de l'événement, saisies ou en route
  // (GET /hsseq/me/rotations, bornée au compte) ; la direction, qui n'y a pas accès, lit les départs
  // du jour pas encore partis. Une route des rotations d'un véhicule à une date est proposée (§14).
  const jour = survenu.slice(0, 10);
  const parCompte = Boolean(ref?.me.profiles.some((p) => p === "admin" || p === "hsseq" || p === "exploitation" || p === "conducteur"));
  const { data: duJour } = useApi<MyRotations>(ref && jour && parCompte ? `/hsseq/me/rotations?date=${jour}` : null);
  const { data: departs } = useApi<Departures>(ref && jour && !parCompte ? `/hsseq/lock/departures?date=${jour}` : null);
  const rotations = useMemo(() => {
    const liste: Array<{ rotation: RotationRef; vehicleId: number }> = duJour
      ? duJour.items.map((r) => ({ rotation: { id: r.id, name: r.name, date_loading: r.date_loading, route_name: r.route_name, state: r.state }, vehicleId: r.vehicle.id }))
      : (departs?.items ?? []).map((d) => ({ rotation: d.rotation, vehicleId: d.vehicle.id }));
    if (evenement?.rotation && !liste.some((r) => r.rotation.id === evenement.rotation!.id)) liste.unshift({ rotation: evenement.rotation, vehicleId: evenement.vehicle?.id ?? 0 });
    return vehicule ? liste.filter((r) => String(r.vehicleId) === vehicule || String(r.rotation.id) === rotation) : liste;
  }, [duJour, departs, evenement, vehicule, rotation]);

  const note = criticite(potentielle, probabilite);
  const niveau = niveauSelon(note, ref?.criticality_thresholds);
  const effet = niveau ? effetCriticite(niveau, ref?.criticality_thresholds) : null;

  function choisirType(t: EventType | "") {
    setType(t);
    if (t && !domaineChoisi) setDomaine(TYPE_EVENEMENT[t].domaine);
  }

  function choisirVehicule(id: string) {
    setVehicule(id);
    const v = ref?.vehicles.find((x) => String(x.id) === id);
    if (v?.site_id) setSite(String(v.site_id));
    if (rotation && !rotations.some((r) => String(r.rotation.id) === rotation && String(r.vehicleId) === id)) setRotation("");
  }

  function choisirRotation(id: string) {
    setRotation(id);
    const r = rotations.find((x) => String(x.rotation.id) === id);
    if (r && r.vehicleId && !vehicule) {
      // Le véhicule de la rotation, et son site ; la rotation choisie reste.
      setVehicule(String(r.vehicleId));
      const v = ref?.vehicles.find((x) => x.id === r.vehicleId);
      if (v?.site_id) setSite(String(v.site_id));
    }
  }

  function ajouterPersonne(kind: NaturePersonne = "third_party", id: number | null = null, role: PersonRole = kind === "driver" ? "driver" : "witness") {
    const nom = kind === "driver" ? (ref?.drivers.find((d) => d.id === id)?.name ?? "") : "";
    setPersonnes((l) => [...l, { cle: cle(), kind, person_id: id, name: nom, role, days_off: 0 }]);
  }

  function changerPersonne(k: string, valeurs: Partial<LignePersonne>) {
    setPersonnes((l) => l.map((p) => (p.cle === k ? { ...p, ...valeurs } : p)));
  }

  function ajouterPhotos(fichiers: FileList | null) {
    if (!fichiers) return;
    const refus: string[] = [];
    const ajout: Photo[] = [];
    for (const f of Array.from(fichiers)) {
      if (!FORMATS.includes(f.type)) refus.push(`${f.name} : format non accepté (JPEG, PNG ou PDF)`);
      else if (f.size > TAILLE_MAX) refus.push(`${f.name} : ${taille(f.size)}, 8${INSECABLE}Mo au plus`);
      else ajout.push({ cle: cle(), fichier: f, apercu: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
    }
    setRefusPhoto(refus.length ? refus.join(" ; ") : null);
    setPhotos((l) => [...l, ...ajout]);
  }

  function retirerPhoto(k: string) {
    setPhotos((l) => {
      const p = l.find((x) => x.cle === k);
      if (p?.apercu) URL.revokeObjectURL(p.apercu);
      return l.filter((x) => x.cle !== k);
    });
  }

  const conducteurDuVehicule = ref?.vehicles.find((v) => String(v.id) === vehicule)?.driver_id ?? null;
  const conducteurDejaCite = personnes.some((p) => p.kind === "driver" && p.person_id === conducteurDuVehicule);

  const occurredAt = isoDepuisLocal(survenu);
  const futur = occurredAt !== null && Date.parse(occurredAt) > Date.now() + 5 * 60_000;
  const manque = {
    type: !type,
    title: !titre.trim(),
    description: !description.trim(),
    occurred_at: !occurredAt || futur,
    people: personnes.some((p) => (p.kind === "driver" ? !p.person_id : !p.person_id && !p.name.trim())),
  };
  const invalide = (champ: keyof typeof manque) => (tente && manque[champ]) || champs.includes(champ);

  async function envoyer(ev: FormEvent) {
    ev.preventDefault();
    setTente(true);
    setErreur(null);
    setChamps([]);
    if (Object.values(manque).some(Boolean) || !type || !occurredAt) {
      setErreur(futur ? "La date de l'événement ne peut pas être dans le futur." : "Complétez les champs signalés.");
      return;
    }
    // person_id seul, jamais id : le noyau lit id en premier comme identifiant de la personne.
    const people: PersonInput[] = personnes.map((p) => ({ kind: p.kind, person_id: p.kind === "third_party" ? null : p.person_id, name: p.name.trim() || null, role: p.role, days_off: p.days_off }));
    const commun = {
      type,
      domain: domaine || undefined,
      title: titre.trim(),
      description: description.trim(),
      occurred_at: occurredAt,
      location: lieu.trim() || null,
      site_id: site ? Number(site) : null,
      vehicle_id: vehicule ? Number(vehicule) : null,
      rotation_id: rotation ? Number(rotation) : null,
      people,
    };
    setEnvoi(true);
    try {
      if (evenement) {
        const maj = await apiSend<Evenement>("PATCH", `/hsseq/events/${evenement.id}`, commun);
        onEnregistre(maj);
        return;
      }
      // Les notes du déclarant restent à l'écran : le noyau ne les reçoit pas à la déclaration.
      const corps: EventReport = {
        ...commun,
        client_uuid: uuid.current,
        reported_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        offline: false,
      };
      const nouveau = await apiSend<Evenement>("POST", "/hsseq/events", corps);
      const echecs: Array<{ nom: string; motif: string }> = [];
      for (const p of photos) {
        const form = new FormData();
        form.append("file", p.fichier, p.fichier.name);
        form.append("model", "event");
        form.append("id", String(nouveau.id));
        form.append("client_uuid", `${uuid.current}-${p.cle}`);
        try {
          await apiUpload<Attachment>("/hsseq/attachments", form);
        } catch (e) {
          echecs.push({ nom: p.fichier.name, motif: messageRefus(e) });
        }
      }
      if (echecs.length) setCree({ evenement: nouveau, echecs });
      else onEnregistre(nouveau);
    } catch (e) {
      setErreur(messageRefus(e, edition ? "La déclaration n'a pas été corrigée." : "L'événement n'a pas été déclaré."));
      setChamps(champsRefus(e));
    } finally {
      setEnvoi(false);
    }
  }

  if (cree) {
    return (
      <Modal
        open
        title={`Événement ${cree.evenement.reference} déclaré`}
        onClose={() => onEnregistre(cree.evenement)}
        footer={
          <Button variant="primary" onClick={() => onEnregistre(cree.evenement)}>
            Ouvrir la fiche
          </Button>
        }
      >
        <Notice tone="warn">
          <p>{cree.echecs.length > 1 ? "Ces pièces n'ont pas été jointes :" : "Cette pièce n'a pas été jointe :"}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {cree.echecs.map((e) => (
              <li key={e.nom}>
                <b>{e.nom}</b> : {e.motif}
              </li>
            ))}
          </ul>
          <p className="mt-1.5">Joignez-les depuis la fiche de l'événement.</p>
        </Notice>
      </Modal>
    );
  }

  return (
    <Modal
      open
      wide
      title={edition ? `Corriger la déclaration ${evenement!.reference}` : "Déclarer un événement"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form={formId} loading={envoi}>
            {edition ? "Enregistrer" : "Déclarer l'événement"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={envoyer} noValidate className="space-y-6">
        <section aria-labelledby={`${formId}-quoi`} className="space-y-4">
          <h3 id={`${formId}-quoi`} className="font-display text-[15px] font-[620] text-ink">
            Ce qui s'est passé
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type d'événement" error={invalide("type") ? "Choisissez le type." : undefined}>
              <Select required aria-invalid={invalide("type") || undefined} value={type} onChange={(e) => choisirType(e.target.value as EventType | "")} options={OPTIONS_TYPES} placeholder="Choisir…" />
            </Field>
            <Field label="Domaine" hint={type && !domaineChoisi ? "Déduit du type ; modifiable." : undefined}>
              <Select
                value={domaine}
                onChange={(e) => {
                  setDomaine(e.target.value as Domain | "");
                  setDomaineChoisi(true);
                }}
                options={OPTIONS_DOMAINES}
                placeholder="Déduit du type"
              />
            </Field>
            <Field label="Titre" className="sm:col-span-2" error={invalide("title") ? "Donnez un titre court." : undefined}>
              <Input required maxLength={200} aria-invalid={invalide("title") || undefined} value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Citerne immobilisée de nuit sans balisage" />
            </Field>
            <Field label="Date et heure" error={invalide("occurred_at") ? (futur ? "Date dans le futur." : "Indiquez la date et l'heure.") : undefined}>
              <Input type="datetime-local" required max={localDepuisIso(null)} aria-invalid={invalide("occurred_at") || undefined} value={survenu} onChange={(e) => setSurvenu(e.target.value)} />
            </Field>
            <Field label="Site">
              <Select value={site} onChange={(e) => setSite(e.target.value)} options={sites.map((s) => ({ value: s.id, label: s.name }))} placeholder={sites.length ? "Choisir…" : "Chargement…"} />
            </Field>
            <Field label="Lieu" className="sm:col-span-2" hint="Point kilométrique, carrefour, quai, zone du parc.">
              <Input maxLength={200} value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="RN1, sortie de Coyah" />
            </Field>
            <Field label="Description" className="sm:col-span-2" error={invalide("description") ? "Décrivez l'événement." : undefined} hint="Les faits, sans jugement. Aucune information médicale ni résultat d'alcootest : ils ne se tiennent pas ici.">
              <Textarea required maxLength={4000} rows={5} aria-invalid={invalide("description") || undefined} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </section>

        <section aria-labelledby={`${formId}-vehicule`} className="space-y-4">
          <h3 id={`${formId}-vehicule`} className="font-display text-[15px] font-[620] text-ink">
            Véhicule et rotation
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Véhicule">
              <Select value={vehicule} onChange={(e) => choisirVehicule(e.target.value)} options={vehicules.map((v) => ({ value: v.id, label: `${v.name} · ${TYPE_VEHICULE[v.vehicle_kind]}${v.plate ? ` · ${v.plate}` : ""}` }))} placeholder="Aucun véhicule" />
            </Field>
            <Field label="Rotation" hint={rotations.length ? "Rotations chargées le jour de l'événement." : jour ? "Aucune rotation chargée ce jour-là pour ce choix." : undefined}>
              <Select value={rotation} onChange={(e) => choisirRotation(e.target.value)} options={rotations.map((r) => ({ value: r.rotation.id, label: `${nomRotation(r.rotation)}${r.rotation.route_name ? ` · ${r.rotation.route_name}` : ""}` }))} placeholder="Aucune rotation" />
            </Field>
          </div>
        </section>

        <section aria-labelledby={`${formId}-personnes`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${formId}-personnes`} className="font-display text-[15px] font-[620] text-ink">
              Personnes impliquées
            </h3>
            <div className="flex flex-wrap gap-2">
              {conducteurDuVehicule && !conducteurDejaCite && (
                <Button size="sm" onClick={() => ajouterPersonne("driver", conducteurDuVehicule)}>
                  <Plus className="h-3.5 w-3.5" /> Conducteur du véhicule
                </Button>
              )}
              <Button size="sm" onClick={() => ajouterPersonne()}>
                <Plus className="h-3.5 w-3.5" /> Ajouter une personne
              </Button>
            </div>
          </div>
          {personnes.length === 0 ? (
            <p className="text-[13px] text-muted">Aucune personne citée.</p>
          ) : (
            <ul className="space-y-2">
              {personnes.map((p, i) => {
                const n = i + 1;
                const sansNom = tente && (p.kind === "driver" ? !p.person_id : !p.person_id && !p.name.trim());
                return (
                  <li key={p.cle} className="grid items-end gap-2 rounded-xl bg-panel-2 p-3 sm:grid-cols-[9rem_minmax(0,1fr)_10rem_auto]">
                    <Field label={`Nature, personne ${n}`}>
                      <Select value={p.kind} onChange={(e) => changerPersonne(p.cle, { kind: e.target.value as NaturePersonne, person_id: null, name: "" })} options={OPTIONS_NATURES} />
                    </Field>
                    {p.kind === "driver" ? (
                      <Field label={`Conducteur, personne ${n}`} error={sansNom ? "Choisissez le conducteur." : undefined}>
                        <Select
                          aria-invalid={sansNom || undefined}
                          value={p.person_id ?? ""}
                          onChange={(e) => {
                            const id = e.target.value ? Number(e.target.value) : null;
                            changerPersonne(p.cle, { person_id: id, name: ref?.drivers.find((d) => d.id === id)?.name ?? "" });
                          }}
                          options={(ref?.drivers ?? []).map((x) => ({ value: x.id, label: x.name }))}
                          placeholder="Choisir…"
                        />
                      </Field>
                    ) : (
                      <Field
                        label={`Nom, personne ${n}`}
                        hint={p.kind === "employee" && !p.person_id ? "La liste des salariés n'est pas encore servie : nommez le salarié." : undefined}
                        error={sansNom ? (p.kind === "employee" ? "Nommez le salarié." : "Nommez le tiers.") : undefined}
                      >
                        <Input
                          maxLength={120}
                          aria-invalid={sansNom || undefined}
                          value={p.name}
                          onChange={(e) => changerPersonne(p.cle, { name: e.target.value, person_id: null })}
                          placeholder={p.kind === "employee" ? "Nom du salarié" : "Nom et qualité du tiers"}
                        />
                      </Field>
                    )}
                    <Field label={`Rôle, personne ${n}`}>
                      <Select value={p.role} onChange={(e) => changerPersonne(p.cle, { role: e.target.value as PersonRole })} options={OPTIONS_ROLES} />
                    </Field>
                    <Button variant="ghost" size="sm" aria-label={`Retirer la personne ${n}`} title="Retirer" className="mb-0.5" onClick={() => setPersonnes((l) => l.filter((x) => x.cle !== p.cle))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!edition && (
          <section aria-labelledby={`${formId}-gravite`} className="space-y-4">
            <div>
              <h3 id={`${formId}-gravite`} className="font-display text-[15px] font-[620] text-ink">
                Gravité et probabilité
              </h3>
              <p className="mt-1 text-[12.5px] leading-snug text-muted">Estimation indicative de 1 à 5 : elle annonce l&apos;effet de la criticité mais n&apos;est pas enregistrée. Le Responsable HSSEQ note la gravité et la probabilité au classement.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <ChoixNote legende="Gravité réelle" aide="Ce qui est arrivé." valeur={reelle} onChange={setReelle} facultative />
              <ChoixNote legende="Gravité potentielle" aide="Ce qui aurait pu arriver." valeur={potentielle} onChange={setPotentielle} facultative />
              <ChoixNote legende="Probabilité" aide="Que cela se reproduise." valeur={probabilite} onChange={setProbabilite} facultative />
            </div>
            <div aria-live="polite" className="space-y-2">
              {note !== null && niveau && effet ? (
                <>
                  <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                    Criticité potentielle indicative : <Criticite gravite={potentielle} probabilite={probabilite} />
                  </p>
                  <Notice tone={effet.ton}>{effet.texte}</Notice>
                </>
              ) : (
                <p className="text-[12.5px] text-muted">Notez la gravité potentielle et la probabilité pour voir la criticité et son effet.</p>
              )}
            </div>
          </section>
        )}

        {!edition && (
          <section aria-labelledby={`${formId}-photos`} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`${formId}-photos`} className="font-display text-[15px] font-[620] text-ink">
                Photos
              </h3>
              <label className={classesBouton("secondary", "sm", "relative cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent")}>
                <Plus className="h-3.5 w-3.5" /> Ajouter des photos
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    ajouterPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="text-[12.5px] text-muted">JPEG, PNG ou PDF, 8{INSECABLE}Mo au plus chacune. Elles sont jointes à la fiche après la déclaration.</p>
            {refusPhoto && <Notice tone="warn">{refusPhoto}</Notice>}
            {photos.length > 0 && (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {photos.map((p) => (
                  <li key={p.cle} className="relative overflow-hidden rounded-xl bg-panel-2">
                    {p.apercu ? (
                      <img src={p.apercu} alt={`Aperçu de ${p.fichier.name}`} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center text-muted">
                        <FileText className="h-7 w-7" />
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11.5px]">
                      <span className="min-w-0 truncate text-ink-2" title={p.fichier.name}>
                        {p.fichier.name}
                      </span>
                      <span className="flex-none text-muted tabular">{taille(p.fichier.size)}</span>
                    </div>
                    <button type="button" onClick={() => retirerPhoto(p.cle)} aria-label={`Retirer ${p.fichier.name}`} title="Retirer" className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-lg bg-panel text-ink shadow-[0_1px_3px_rgb(16_36_31/0.2)] hover:text-danger">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <p className={cx("text-[12px] text-muted", edition && "hidden")}>Le Responsable HSSEQ est notifié de toute déclaration.</p>
      </form>
    </Modal>
  );
}
