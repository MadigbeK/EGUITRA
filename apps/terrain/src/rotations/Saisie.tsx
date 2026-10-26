import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Referentials } from "../api/types";
import { aujourdhui, fmtDate, fmtM3, lireDate } from "../format";
import { Bandeau, BarreAction, Bouton, Champ, Choix, Feuille, Texte, demanderConfirmation, vibrer, type Ton } from "../ui/elements";
import { espaces, mesures, polices, rayons, traits } from "../ui/terrain";
import { useTerrain } from "../ui/useTerrain";
import { blank, controler, depasseCapacite, grouper, num, REQUIS, toPayload, type Erreurs, type Form, type Requis } from "./form";
import type { Rotations } from "./useRotations";

/** Retour d'un enregistrement, sur la ligne d'état de la barre d'action. */
interface Retour {
  ton: "ok" | "attention" | "danger" | "neutre";
  texte: string;
}

/** Bouton d'enregistrement : au repos, pendant l'écriture sur l'appareil, puis 1,5 s de confirmation. */
type Phase = "repos" | "ecriture" | "enregistree";

const TON_RETOUR: Record<Retour["ton"], Ton> = { ok: "ok", attention: "warn", danger: "dangerTexte", neutre: "encre" };

/**
 * Nouvelle rotation, ou correction d'une saisie en attente. Une rotation est d'abord écrite sur
 * l'appareil, puis envoyée au bureau si le réseau passe : rien n'est perdu sans réseau.
 */
export function Saisie({
  rot, userId, form, setForm, barre = true,
}: {
  rot: Rotations;
  userId: number;
  form: Form;
  setForm: (f: Form) => void;
  /** Barre d'action collée en bas (téléphone) ; sur tablette, elle suit le formulaire. */
  barre?: boolean;
}) {
  const refs = rot.refs;
  const insets = useSafeAreaInsets();
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [phase, setPhase] = useState<Phase>("repos");
  const [retour, setRetour] = useState<Retour | null>(null);
  const [frais, setFrais] = useState(false);
  const [clavier, setClavier] = useState(false);
  const defilement = useRef<ScrollViewInstance>(null);
  // Position des champs obligatoires dans leur carte, et des cartes dans la page : le défilement
  // amène le premier champ fautif à l'écran.
  const positions = useRef<Partial<Record<Requis, number>>>({});
  const cartes = useRef({ une: 0, deux: 0 });
  // Verrou d'enregistrement : posé au premier toucher, avant toute attente. Un double toucher ne
  // met jamais deux rotations en file.
  const verrou = useRef(false);
  const minuteurs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const ouvert = Keyboard.addListener("keyboardDidShow", () => setClavier(true));
    const ferme = Keyboard.addListener("keyboardDidHide", () => setClavier(false));
    return () => {
      ouvert.remove();
      ferme.remove();
      minuteurs.current.forEach(clearTimeout);
    };
  }, []);

  if (refs === undefined) return <Texte ton="second" style={styles.vide}>Chargement des listes…</Texte>;
  if (refs === null) {
    return (
      <View style={{ padding: espaces[4] }}>
        <Bandeau ton="attention" texte="Les listes (camions, clients, routes) ne sont pas encore sur cet appareil. Ouvrez l'application une première fois avec du réseau." />
      </View>
    );
  }

  const annoncer = (r: Retour | null, duree: number | null = 4000) => {
    setRetour(r);
    if (r && duree) minuteurs.current.push(setTimeout(() => setRetour((x) => (x === r ? null : x)), duree));
  };

  /** Une erreur disparaît dès que l'agent touche à son champ. */
  const corriger = (k: Requis) =>
    setErreurs((e) => {
      if (!e[k]) return e;
      const suite = { ...e };
      delete suite[k];
      return suite;
    });

  const changer = (patch: Partial<Form>, champ?: Requis) => {
    if (champ) corriger(champ);
    setForm({ ...form, ...patch });
  };

  async function enregistrer(r: Referentials) {
    if (verrou.current) return;
    verrou.current = true;
    let garde = false;
    try {
      rot.setNotice(null);
      const fautes = controler(form);
      setErreurs(fautes);
      const premier = REQUIS.find((k) => fautes[k]);
      if (premier) {
        const n = Object.keys(fautes).length;
        vibrer.erreur();
        annoncer({ ton: "danger", texte: n > 1 ? `${n} champs à compléter, signalés en rouge.` : `${fautes[premier]}.` });
        const carte = premier === "volume_loaded" ? cartes.current.deux : cartes.current.une;
        defilement.current?.scrollTo({ y: Math.max(0, carte + (positions.current[premier] ?? 0) - 24), animated: true });
        return;
      }
      const vehicle = depasseCapacite(form, r);
      // Le bureau ne valide pas une rotation chargée au-delà de la capacité : l'agent est prévenu dès la saisie.
      if (vehicle && !(await demanderConfirmation(
        `Le volume chargé dépasse la capacité de ${vehicle.name} (${fmtM3(vehicle.capacity_liters / 1000)}) : le bureau devra le corriger avant validation.`,
        { titre: "Enregistrer au-delà de la capacité ?", action: "Enregistrer quand même" },
      ))) {
        return;
      }
      const uuid = form.uuid ?? randomUUID();
      // Correction : la saisie doit être encore sur l'appareil. Partie entre-temps, elle est au bureau,
      // qui garde la première version : la correction s'y fait.
      const precedente = form.uuid ? await rot.retrouver(form.uuid) : undefined;
      if (form.uuid && !precedente) {
        vibrer.erreur();
        annoncer({ ton: "danger", texte: "Cette rotation est déjà arrivée au bureau : faites-y la correction. Rien n'a été enregistré sur l'appareil." }, null);
        setForm(blank(form.date_loading));
        return;
      }
      const camion = r.vehicles.find((v) => String(v.id) === form.vehicle_id);
      // « ER-09, 36,50 m³ » : ce que l'agent reconnaît de la rotation qu'il vient de saisir.
      const resume = `${camion?.name ?? "Rotation"}, ${fmtM3(num(form.volume_loaded) || num(form.volume_delivered))}`;
      setPhase("ecriture");
      annoncer(null);
      try {
        await rot.enregistrer({
          client_uuid: uuid, kind: "rotation", user_id: userId, created_at: precedente?.created_at ?? new Date().toISOString(), status: "pending",
          payload: toPayload(form),
          // Version du premier envoi conservée : si le bureau l'a déjà reçue, l'envoi le dira.
          ...(precedente?.tentative ? { tentative: precedente.tentative } : {}),
        });
      } catch {
        setPhase("repos");
        annoncer({ ton: "danger", texte: "Enregistrement impossible sur cet appareil : réessayez. Si cela recommence, prévenez le bureau." });
        return;
      }

      // Enregistrée sur l'appareil : le bouton le dit 1,5 s, l'appareil vibre, la page remonte.
      setForm(blank(form.date_loading));
      setFrais(false);
      setErreurs({});
      setPhase("enregistree");
      garde = true;
      vibrer.succes();
      minuteurs.current.push(setTimeout(() => {
        setPhase("repos");
        verrou.current = false;
      }, 1500));
      minuteurs.current.push(setTimeout(() => defilement.current?.scrollTo({ y: 0, animated: true }), 450));

      if (!rot.online) {
        annoncer({ ton: "attention", texte: `${resume} : partira seule au retour du réseau. Rien à refaire.` });
        return;
      }
      annoncer({ ton: "neutre", texte: `${resume} : envoi au bureau…` }, null);
      const bilan = await rot.sync("saisie");
      const restant = await rot.retrouver(uuid);
      if (!restant) annoncer({ ton: "ok", texte: `${resume} : envoyée au bureau.` });
      else if (restant.status === "error") annoncer({ ton: "danger", texte: `${resume} : refusée par le bureau, à corriger dans « À envoyer ».` });
      else if (!bilan) annoncer({ ton: "ok", texte: `${resume} : enregistrée, partira avec le prochain envoi.` });
      else if (bilan.echec && !bilan.echec.reseau) annoncer({ ton: "attention", texte: `${resume} : enregistrée sur l'appareil. ${bilan.echec.message}` });
      else annoncer({ ton: "attention", texte: `${resume} : partira seule au retour du réseau. Rien à refaire.` });
    } finally {
      if (!garde) verrou.current = false;
    }
  }

  const aEnvoyer = rot.mine.length;
  const etat = rot.syncing
    ? "Envoi au bureau…"
    : !rot.online
      ? aEnvoyer ? `Hors réseau, ${aEnvoyer} à envoyer` : "Hors réseau : la saisie attendra le réseau"
      : rot.faible
        ? aEnvoyer ? `Réseau faible, ${aEnvoyer} à envoyer` : "Réseau faible : l'envoi peut tarder"
        : aEnvoyer ? `${aEnvoyer} à envoyer` : "En ligne : envoi dès l'enregistrement";

  const repere = (k: Requis) => ({ onLayout: (e: { nativeEvent: { layout: { y: number } } }) => (positions.current[k] = e.nativeEvent.layout.y) });

  const actions = (
    <BarreAction etat={retour?.texte ?? etat} tonEtat={retour ? TON_RETOUR[retour.ton] : "second"} dansLaPage={!barre}>
      {form.uuid && phase === "repos" ? (
        <Bouton titre="Annuler" variante="secondaire" onPress={() => { setForm(blank()); setErreurs({}); }} />
      ) : null}
      <Bouton
        style={{ flex: 1 }}
        fait={phase === "enregistree"}
        titre={phase === "ecriture" ? "Enregistrement…" : phase === "enregistree" ? "Rotation enregistrée" : form.uuid ? "Enregistrer la correction" : "Enregistrer la rotation"}
        chargement={phase === "ecriture"}
        onPress={() => void enregistrer(refs)}
      />
    </BarreAction>
  );

  // Android affiche bord à bord : le clavier ne réduit plus la fenêtre, la page lui fait place.
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        ref={defilement}
        contentContainerStyle={[styles.page, !barre && { paddingBottom: espaces[8] + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {form.uuid ? <Bandeau ton="attention" texte="Correction d'une saisie en attente." /> : null}
        <View onLayout={(e) => (cartes.current.une = e.nativeEvent.layout.y)}>
          <Feuille>
            <ChoixDate valeur={form.date_loading} onChange={(d) => changer({ date_loading: d })} />
            <View {...repere("vehicle_id")}>
              <Choix
                libelle="Ensemble routier"
                invite="Choisir le camion"
                valeur={form.vehicle_id}
                erreur={erreurs.vehicle_id}
                options={refs.vehicles.map((v) => ({ valeur: String(v.id), libelle: v.name, detail: v.tractor_plate || undefined }))}
                onChange={(id) => {
                  const v = refs.vehicles.find((x) => String(x.id) === id);
                  changer({ vehicle_id: id, driver_id: v?.driver_id ? String(v.driver_id) : form.driver_id }, "vehicle_id");
                }}
              />
            </View>
            <Choix
              libelle="Chauffeur"
              invite="Chauffeur habituel"
              facultatif
              valeur={form.driver_id}
              options={refs.drivers.map((d) => ({ valeur: String(d.id), libelle: d.name }))}
              onChange={(id) => changer({ driver_id: id })}
            />
            <View {...repere("partner_id")}>
              <Choix
                libelle="Client"
                invite="Choisir le client"
                valeur={form.partner_id}
                erreur={erreurs.partner_id}
                options={refs.clients.map((c) => ({ valeur: String(c.id), libelle: c.name }))}
                onChange={(id) => changer({ partner_id: id }, "partner_id")}
              />
            </View>
            <View {...repere("route_id")}>
              <Choix
                libelle="Route"
                invite="Choisir la route"
                valeur={form.route_id}
                erreur={erreurs.route_id}
                options={refs.routes.map((r) => ({ valeur: String(r.id), libelle: r.name, detail: r.distance_km ? `${r.distance_km} km` : undefined }))}
                onChange={(id) => changer({ route_id: id }, "route_id")}
              />
            </View>
            <View style={styles.deux}>
              <View style={{ flex: 1 }}>
                <Choix
                  libelle="Produit"
                  valeur={form.product}
                  options={refs.products.map((p) => ({ valeur: p.code, libelle: p.label }))}
                  onChange={(code) => changer({ product: code })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Champ libelle="Bon de livraison" value={form.delivery_note} onChangeText={(t) => changer({ delivery_note: t })} autoCapitalize="characters" />
              </View>
            </View>
          </Feuille>
        </View>

        <View onLayout={(e) => (cartes.current.deux = e.nativeEvent.layout.y)}>
          <Feuille>
            <View style={styles.deux} {...repere("volume_loaded")}>
              <View style={{ flex: 1 }}>
                <Champ
                  libelle="Volume chargé (m³)"
                  keyboardType="decimal-pad"
                  value={form.volume_loaded}
                  erreur={erreurs.volume_loaded}
                  onChangeText={(t) => changer({ volume_loaded: t }, "volume_loaded")}
                  style={styles.volume}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Champ
                  libelle="Volume livré (m³)"
                  keyboardType="decimal-pad"
                  placeholder="Si déjà livré"
                  value={form.volume_delivered}
                  onChangeText={(t) => changer({ volume_delivered: t }, "volume_loaded")}
                  style={form.volume_delivered ? styles.volume : undefined}
                />
              </View>
            </View>
            {(refs.measures ?? []).map((m) => (
              <Champ
                key={m.code}
                libelle={m.label}
                keyboardType="decimal-pad"
                value={form.measures[m.code] ?? ""}
                onChangeText={(t) => changer({ measures: { ...form.measures, [m.code]: t } })}
              />
            ))}
          </Feuille>
        </View>

        <Feuille>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: frais }}
            onPress={() => setFrais(!frais)}
            style={styles.depliant}
          >
            <Texte variante="texteDemi" style={{ flexShrink: 0 }}>Frais de route</Texte>
            <Texte variante="service" ton="second" style={{ flex: 1, textAlign: "right" }}>{frais ? "Masquer" : "Carburant, péages…"}</Texte>
          </Pressable>
          {frais
            ? refs.costs.map((c) => (
                <Champ
                  key={c.code}
                  libelle={`${c.label} (GNF)`}
                  keyboardType="number-pad"
                  value={grouper(form.costs[c.code] ?? "")}
                  onChangeText={(t) => changer({ costs: { ...form.costs, [c.code]: t } })}
                  style={{ fontFamily: polices.titreDemi }}
                />
              ))
            : null}
        </Feuille>

        <Champ libelle="Observations" multiline value={form.note} onChangeText={(t) => changer({ note: t })} />
        {!barre ? actions : null}
      </ScrollView>
      {barre && !clavier ? actions : null}
    </KeyboardAvoidingView>
  );
}

/** Date de chargement : aujourd'hui, hier ou avant-hier d'un toucher, ou une autre date tapée. */
function ChoixDate({ valeur, onChange }: { valeur: string; onChange: (iso: string) => void }) {
  const { c } = useTerrain();
  const jours = [
    { iso: aujourdhui(), libelle: "Aujourd'hui" },
    { iso: aujourdhui(-1), libelle: "Hier" },
    { iso: aujourdhui(-2), libelle: "Avant-hier" },
  ];
  const autre = !jours.some((j) => j.iso === valeur);
  const [texte, setTexte] = useState(autre ? fmtDate(valeur) : "");
  const [erreur, setErreur] = useState<string | undefined>();
  const ERREUR_DATE = "Date au format JJ/MM/AAAA, au plus tard aujourd'hui";
  // La date s'applique dès qu'elle est complète : ni le retour Android ni « Enregistrer » ne font
  // forcément quitter le champ.
  const taper = (t: string) => {
    setTexte(t);
    const iso = lireDate(t);
    if (iso) {
      setErreur(undefined);
      onChange(iso);
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t.trim())) {
      setErreur(ERREUR_DATE);
    }
  };
  const lire = () => {
    if (!texte.trim()) return;
    setErreur(lireDate(texte) ? undefined : ERREUR_DATE);
  };
  return (
    <View style={{ gap: 6 }}>
      <Texte variante="texteDemi" ton="encre2">Date de chargement</Texte>
      <View style={styles.jours} accessibilityRole="radiogroup">
        {jours.map((j) => {
          const actif = j.iso === valeur;
          return (
            <Pressable
              key={j.iso}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={`${j.libelle}, ${fmtDate(j.iso)}`}
              onPress={() => {
                vibrer.selection();
                setTexte("");
                setErreur(undefined);
                onChange(j.iso);
              }}
              style={[styles.jour, { borderColor: actif ? c.accentPlein : c.trait, backgroundColor: actif ? c.accentPlein : c.surface }]}
            >
              <Texte variante="texteDemi" style={{ color: actif ? c.accentSur : c.encre }}>{j.libelle}</Texte>
            </Pressable>
          );
        })}
      </View>
      <Champ
        libelle="Autre date"
        placeholder="JJ/MM/AAAA"
        keyboardType="numbers-and-punctuation"
        value={texte}
        erreur={erreur}
        aide={autre ? `Date retenue : ${fmtDate(valeur)}` : undefined}
        onChangeText={taper}
        onBlur={lire}
        onSubmitEditing={lire}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  vide: { padding: espaces[8], textAlign: "center" },
  deux: { flexDirection: "row", gap: espaces[3] },
  volume: { fontFamily: polices.titre, fontSize: 28, minHeight: 64 },
  depliant: { minHeight: mesures.cible, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: espaces[3] },
  jours: { flexDirection: "row", gap: espaces[3], flexWrap: "wrap" },
  jour: { minHeight: mesures.cible, paddingHorizontal: espaces[4], borderRadius: rayons.champ, justifyContent: "center", borderWidth: traits.champ },
});
