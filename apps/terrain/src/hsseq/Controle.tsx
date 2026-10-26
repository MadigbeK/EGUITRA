import { randomUUID } from "expo-crypto";
import { useKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Utilisateur } from "../auth/coffre";
import { duree, heure, pluriel } from "../format";
import type { Piece } from "../store/types";
import { useEnvoi } from "../sync/Envoi";
import { BarreAction, Bandeau, Bouton, Champ, Choix, EnTete, Ecran, Feuille, Tampon, Texte, vibrer } from "../ui/elements";
import { Appareil, Cadenas, Coche, Losange } from "../ui/icones";
import { espaces, mesures, rayons, textes, traits } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import { supprimerPhoto } from "./appareil";
import { ficheControle, manques, pointsDuControle, resultat, type Reponse } from "./reglesControle";
import { positionDeLaFiche, usePosition } from "./position";
import { PrisePhoto } from "./PrisePhoto";
import { Signature } from "./Signature";
import type { Answer, TemplateItem } from "./types";
import { grilleDe, NATURE_VEHICULE, useHsseq } from "./useHsseq";

type Etape = "vehicule" | "critiques" | "autres" | "recap";

/** Contrôle avant départ (système « terrain », § 3.3 à 3.5 ; contrat HSSEQ, § 7). Couleur : pétrole. */
export function Controle({ user, vehiculeInitial }: { user: Utilisateur; vehiculeInitial?: string }) {
  return (
    <Module nom="hsseq">
      <Contenu user={user} vehiculeInitial={vehiculeInitial} />
    </Module>
  );
}

function Contenu({ user, vehiculeInitial }: { user: Utilisateur; vehiculeInitial?: string }) {
  useKeepAwake();
  const router = useRouter();
  const envoi = useEnvoi();
  const { refs, grilles } = useHsseq();
  const { c } = useTerrain();
  const position = usePosition();
  const uuid = useRef(randomUUID());
  const [etape, setEtape] = useState<Etape>("vehicule");
  // Véhicule venu du verrou (motif V01), sinon celui du conducteur.
  const [vehiculeId, setVehiculeId] = useState(vehiculeInitial ?? "");
  const [index, setIndex] = useState(0);
  const [reponses, setReponses] = useState<Record<number, Reponse>>({});
  const [photos, setPhotos] = useState<Record<number, Piece>>({});
  const [photoPour, setPhotoPour] = useState<number | null>(null);
  const [debut, setDebut] = useState<number | null>(null);
  const [ecoule, setEcoule] = useState(0);
  const [enregistrement, setEnregistrement] = useState(false);
  const [fait, setFait] = useState<string | null>(null);
  const [signature, setSignature] = useState<{ image: string; at: string } | null>(null);
  const [signer, setSigner] = useState(false);

  // Véhicule pré-rempli : celui du conducteur, s'il en a un.
  useEffect(() => {
    if (!refs || vehiculeId) return;
    const sien = refs.vehicles.find((v) => v.driver_id != null && v.driver_id === refs.me.driver_id);
    if (sien) setVehiculeId(String(sien.id));
  }, [refs, vehiculeId]);

  // Le minuteur mesure sans presser : temps écoulé, jamais de compte à rebours.
  useEffect(() => {
    if (debut === null || fait) return;
    const t = setInterval(() => setEcoule(Math.round((Date.now() - debut) / 1000)), 1000);
    return () => clearInterval(t);
  }, [debut, fait]);

  const vehicule = refs?.vehicles.find((v) => String(v.id) === vehiculeId);
  const grille = vehicule ? grilleDe(grilles, vehicule.vehicle_kind) : null;
  const points = grille ? pointsDuControle(grille) : { critiques: [], autres: [] };
  const critique = points.critiques[index];

  // Retour Android : point précédent ou étape précédente ; la saisie reste en brouillon.
  useEffect(() => {
    const abonnement = BackHandler.addEventListener("hardwareBackPress", () => {
      if (fait) return false;
      if (etape === "critiques" && index > 0) {
        setIndex(index - 1);
        return true;
      }
      if (etape === "critiques") {
        setEtape("vehicule");
        return true;
      }
      if (etape === "autres") {
        setEtape("critiques");
        setIndex(Math.max(0, points.critiques.length - 1));
        return true;
      }
      if (etape === "recap") {
        setEtape(points.autres.length ? "autres" : "critiques");
        return true;
      }
      return false;
    });
    return () => abonnement.remove();
  }, [etape, index, fait, points.critiques.length, points.autres.length]);

  function repondre(item: TemplateItem, answer: Answer) {
    setReponses((r) => ({ ...r, [item.id]: { ...r[item.id], answer } }));
    if (answer === "ok") {
      vibrer.selection();
      const retiree = photos[item.id];
      if (retiree) {
        void supprimerPhoto(retiree.uri).catch(() => undefined);
        setPhotos(({ [item.id]: _retiree, ...reste }) => reste);
      }
      if (etape === "critiques") avancer();
    } else {
      vibrer.avertissement();
      if (!photos[item.id]) setPhotoPour(item.id);
    }
  }

  function avancer() {
    if (index < points.critiques.length - 1) setIndex(index + 1);
    else setEtape(points.autres.length ? "autres" : "recap");
  }

  async function enregistrer() {
    if (!grille || !vehicule || enregistrement || fait) return;
    const { sansReponse, sansPhoto } = manques(grille, reponses, photos);
    if (sansReponse.length || sansPhoto.length) return;
    setEnregistrement(true);
    const secondes = Math.round((Date.now() - (debut ?? Date.now())) / 1000);
    const fiche = ficheControle(grille, reponses, {
      vehicle_id: vehicule.id,
      rotation_id: null,
      driver_id: refs?.me.driver_id ?? vehicule.driver_id,
      duration_s: secondes,
      ...positionDeLaFiche(position),
    });
    try {
      await envoi.enregistrer(
        { client_uuid: uuid.current, kind: "check", user_id: user.id, created_at: new Date().toISOString(), status: "pending", payload: { ...fiche, ...(signature ? { signature: signature.image } : {}), offline: !envoi.online } },
        Object.values(photos),
      );
    } catch {
      setEnregistrement(false);
      vibrer.erreur();
      return;
    }
    vibrer.succes();
    setFait(`Contrôle enregistré en ${duree(secondes)}.`);
    void envoi.sync("saisie");
    setTimeout(() => router.back(), 1500);
  }

  const entete = (
    <EnTete
      titre="Contrôle"
      sousTitre={vehicule ? `Avant départ, ${vehicule.name}` : "Avant départ"}
      gauche={(
        <Pressable accessibilityRole="button" accessibilityLabel="Retour à Ma journée" onPress={() => router.back()} style={styles.retour}>
          <Text style={[textes.libelle, { color: c.enteteEncre }]}>‹</Text>
        </Pressable>
      )}
    />
  );

  if (refs === undefined || grilles === undefined) {
    return <Ecran>{entete}<Texte ton="second" style={styles.vide}>Chargement des grilles…</Texte></Ecran>;
  }
  if (refs === null || grilles === null) {
    return (
      <Ecran>
        {entete}
        <View style={styles.page}>
          <Bandeau ton="attention" texte="Les grilles de contrôle ne sont pas encore sur cet appareil. Ouvrez l'application une première fois avec du réseau." />
        </View>
      </Ecran>
    );
  }

  const total = points.critiques.length + points.autres.length;
  const repondus = Object.keys(reponses).length;
  const progression = etape !== "vehicule" ? (
    <View style={[styles.progression, { backgroundColor: c.surface, borderBottomColor: c.filet }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: repondus }}>
      <Text style={[textes.service, { color: c.encre2, flex: 1 }]}>
        {etape === "critiques" ? `Point ${index + 1} sur ${total}` : etape === "autres" ? "Points non bloquants" : "Récapitulatif"}
      </Text>
      <Text style={[textes.service, { color: c.second }]} accessibilityElementsHidden>{duree(ecoule)}</Text>
    </View>
  ) : null;

  // Étape 1 : le véhicule et sa grille.
  if (etape === "vehicule") {
    return (
      <Ecran>
        {entete}
        <ScrollView contentContainerStyle={styles.page}>
          <Choix
            libelle="Véhicule contrôlé"
            invite="Choisir le véhicule"
            valeur={vehiculeId}
            options={refs.vehicles.map((v) => ({ valeur: String(v.id), libelle: v.name, detail: [NATURE_VEHICULE[v.vehicle_kind], v.plate].filter(Boolean).join(", ") }))}
            onChange={(id) => {
              setVehiculeId(id);
              setReponses({});
              setPhotos({});
              setIndex(0);
            }}
          />
          {vehicule ? <Tampon mot={NATURE_VEHICULE[vehicule.vehicle_kind]} ton="neutre" /> : null}
          {vehicule && !grille ? <Bandeau ton="attention" texte={`Aucune grille de contrôle en vigueur pour une ${NATURE_VEHICULE[vehicule.vehicle_kind].toLowerCase()} : prévenez le Responsable HSSEQ.`} /> : null}
          {grille ? (
            <Feuille>
              <Texte variante="libelle">{grille.name}</Texte>
              <Texte>
                {pluriel(points.critiques.length, "point critique", "points critiques")}, puis {pluriel(points.autres.length, "point non bloquant", "points non bloquants")}. Objectif : moins de 4 minutes. Toute non-conformité demande une photo.
              </Texte>
            </Feuille>
          ) : null}
        </ScrollView>
        <BarreAction etat={!vehicule ? "Choisissez le véhicule contrôlé." : !grille ? "Pas de grille pour ce véhicule." : "Prêt à commencer."}>
          <Bouton style={{ flex: 1 }} titre="Commencer le contrôle" desactive={!grille} onPress={() => {
            setDebut((d) => d ?? Date.now());
            setEtape(points.critiques.length ? "critiques" : points.autres.length ? "autres" : "recap");
          }} />
        </BarreAction>
      </Ecran>
    );
  }

  // Étape 2 : un point critique par écran, réponses de 104 dp dans le tiers bas.
  if (etape === "critiques" && critique) {
    const r = reponses[critique.id];
    const photo = photos[critique.id];
    return (
      <Ecran>
        {entete}
        {progression}
        <ScrollView contentContainerStyle={styles.page}>
          <View style={styles.mention}>
            <Cadenas taille={22} couleur={c.dangerTexte} />
            <Texte variante="service" ton="dangerTexte">Point critique : un défaut bloque le départ</Texte>
          </View>
          <Texte variante="titreFort">{critique.label}</Texte>
          {r?.answer === "not_ok" ? (
            <ZonePhoto photo={photo} onPrendre={() => setPhotoPour(critique.id)} commentaire={r.comment ?? ""} onCommentaire={(t) => setReponses((x) => ({ ...x, [critique.id]: { answer: "not_ok", comment: t } }))} />
          ) : null}
          {index > 0 ? <Bouton titre="Point précédent" variante="discret" onPress={() => setIndex(index - 1)} /> : null}
        </ScrollView>
        {r?.answer === "not_ok" ? (
          <BarreAction etat={photo ? "Photo jointe." : "Photo obligatoire pour une non-conformité."} tonEtat={photo ? "ok" : "dangerTexte"}>
            <Bouton titre="Conforme" variante="secondaire" onPress={() => repondre(critique, "ok")} />
            <Bouton style={{ flex: 1 }} titre={photo ? "Continuer" : "Prendre la photo"} onPress={() => (photo ? avancer() : setPhotoPour(critique.id))} />
          </BarreAction>
        ) : (
          <View style={[styles.reponses, { backgroundColor: c.surface, borderTopColor: c.filetFort }]}>
            <GrandeReponse answer="not_ok" choisie={false} onPress={() => repondre(critique, "not_ok")} />
            <GrandeReponse answer="ok" choisie={r?.answer === "ok"} onPress={() => repondre(critique, "ok")} />
          </View>
        )}
        <PrisePhoto visible={photoPour !== null} rattachement={{ parent_uuid: uuid.current, model: "nonconformity", item_id: photoPour }} onFermer={() => setPhotoPour(null)} onPhoto={(p) => setPhotos((x) => ({ ...x, [p.item_id!]: p }))} />
      </Ecran>
    );
  }

  // Étape 3 : points non bloquants, une ligne par point.
  if (etape === "autres") {
    const manque = grille ? manques(grille, reponses, photos) : null;
    const restants = points.autres.filter((p) => !reponses[p.id]).length;
    const sansPhoto = points.autres.filter((p) => reponses[p.id]?.answer === "not_ok" && !photos[p.id]).length;
    return (
      <Ecran>
        {entete}
        {progression}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
            {points.autres.map((p) => {
              const r = reponses[p.id];
              return (
                <Feuille key={p.id}>
                  <Texte variante="texteDemi">{p.label}</Texte>
                  <View style={styles.deux}>
                    <PetiteReponse answer="not_ok" choisie={r?.answer === "not_ok"} onPress={() => repondre(p, "not_ok")} />
                    <PetiteReponse answer="ok" choisie={r?.answer === "ok"} onPress={() => repondre(p, "ok")} />
                  </View>
                  {r?.answer === "not_ok" ? (
                    <ZonePhoto photo={photos[p.id]} onPrendre={() => setPhotoPour(p.id)} commentaire={r.comment ?? ""} onCommentaire={(t) => setReponses((x) => ({ ...x, [p.id]: { answer: "not_ok", comment: t } }))} />
                  ) : null}
                </Feuille>
              );
            })}
          </ScrollView>
          <BarreAction
            etat={restants ? `${pluriel(restants, "point")} sans réponse.` : sansPhoto ? `${pluriel(sansPhoto, "photo obligatoire")} pour les non-conformités.` : "Tous les points sont répondus."}
            tonEtat={restants || sansPhoto ? "second" : "ok"}
          >
            <Bouton style={{ flex: 1 }} titre="Voir le récapitulatif" desactive={!manque || restants > 0 || sansPhoto > 0} onPress={() => setEtape("recap")} />
          </BarreAction>
        </KeyboardAvoidingView>
        <PrisePhoto visible={photoPour !== null} rattachement={{ parent_uuid: uuid.current, model: "nonconformity", item_id: photoPour }} onFermer={() => setPhotoPour(null)} onPhoto={(p) => setPhotos((x) => ({ ...x, [p.item_id!]: p }))} />
      </Ecran>
    );
  }

  // Étape 4 : récapitulatif, non-conformités en tête avec leur conséquence.
  const tous = [...points.critiques, ...points.autres];
  const nonConformes = tous.filter((p) => reponses[p.id]?.answer === "not_ok");
  const conformes = tous.filter((p) => reponses[p.id]?.answer === "ok").length;
  const issue = grille ? resultat(grille, reponses) : "compliant";
  const manque = grille ? manques(grille, reponses, photos) : { sansReponse: [], sansPhoto: [] };
  return (
    <Ecran>
      {entete}
      {progression}
      <ScrollView contentContainerStyle={styles.page}>
        {issue === "blocking" ? (
          <Feuille style={{ borderColor: c.danger, borderWidth: traits.fort, backgroundColor: c.dangerDoux }}>
            <View style={styles.mention}>
              <Cadenas taille={32} couleur={c.dangerTexte} />
              <Texte variante="titre" ton="dangerTexte">Départ bloqué après envoi</Texte>
            </View>
            <Texte>Un point critique est non conforme (V02). Le chef de parc lève la non-conformité après correction, photo obligatoire.</Texte>
          </Feuille>
        ) : issue === "non_compliant" ? (
          <Bandeau ton="attention" texte="Conforme avec réserves : un point non bloquant est à corriger. Le départ n'est pas bloqué par ce contrôle." />
        ) : (
          <Bandeau ton="ok" texte="Tous les points sont conformes." />
        )}
        {nonConformes.map((p) => (
          <Feuille key={p.id}>
            <View style={styles.mention}>
              <Losange taille={24} couleur={c.danger} />
              <Texte variante="texteDemi" style={{ flex: 1 }}>{p.label}</Texte>
              <Tampon mot={p.blocking ? "Bloquant" : "Non conforme"} ton={p.blocking ? "danger" : "warn"} />
            </View>
            {reponses[p.id]?.comment ? <Texte variante="service" ton="second">{reponses[p.id]!.comment}</Texte> : null}
            <Texte variante="service" ton={photos[p.id] ? "ok" : "dangerTexte"}>{photos[p.id] ? `Photo jointe à ${heure(photos[p.id]!.created_at)}` : "Photo manquante"}</Texte>
          </Feuille>
        ))}
        <Feuille>
          <View style={styles.mention}>
            <Coche taille={24} couleur={c.ok} />
            <Texte variante="texteDemi">{pluriel(conformes, "point conforme", "points conformes")}</Texte>
          </View>
          <Bouton titre="Revoir les points" variante="discret" onPress={() => { setIndex(0); setEtape(points.critiques.length ? "critiques" : "autres"); }} />
        </Feuille>
        <Feuille>
          <Texte variante="libelle">Signature</Texte>
          {signature ? (
            <View style={styles.mention}>
              <Texte style={{ flex: 1 }}>Signé à {heure(signature.at)}.</Texte>
              <Bouton titre="Effacer" variante="secondaire" onPress={() => setSignature(null)} />
            </View>
          ) : (
            <Bouton titre="Signer le contrôle" variante="secondaire" onPress={() => setSigner(true)} />
          )}
        </Feuille>
      </ScrollView>
      <Signature visible={signer} onFermer={() => setSigner(false)} onSignee={(image) => setSignature({ image, at: new Date().toISOString() })} />
      <BarreAction
        etat={fait ?? (manque.sansReponse.length || manque.sansPhoto.length ? "Des points restent à compléter." : !envoi.online ? "Hors réseau : le contrôle partira seul dès que le réseau passe. Rien à refaire." : `Durée : ${duree(ecoule)}.`)}
        tonEtat={fait ? "ok" : "second"}
      >
        <Bouton
          style={{ flex: 1 }}
          titre={fait ? "Contrôle enregistré" : "Enregistrer le contrôle"}
          fait={!!fait}
          chargement={enregistrement && !fait}
          desactive={manque.sansReponse.length > 0 || manque.sansPhoto.length > 0}
          onPress={() => void enregistrer()}
        />
      </BarreAction>
    </Ecran>
  );
}

/** Zone de photo obligatoire : tirets rouges tant qu'elle manque, vignette une fois jointe. */
function ZonePhoto({ photo, onPrendre, commentaire, onCommentaire }: { photo: Piece | undefined; onPrendre: () => void; commentaire: string; onCommentaire: (t: string) => void }) {
  const { c } = useTerrain();
  return (
    <View style={{ gap: espaces[3] }}>
      <Tampon mot="Non conforme" ton="danger" />
      {photo ? (
        <View style={styles.vignette}>
          {photo.uri.startsWith("simulation://") ? <View style={[styles.image, { backgroundColor: c.surface2 }]} /> : <Image source={{ uri: photo.uri }} style={styles.image} accessibilityLabel="Photo du défaut" />}
          <View style={{ flex: 1, gap: espaces[2] }}>
            <Texte variante="service" ton="second">Prise à {heure(photo.created_at)}{photo.size ? `, ${Math.round(photo.size / 1024)} Ko` : ""}</Texte>
            <Bouton titre="Reprendre" variante="secondaire" onPress={onPrendre} />
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Photo obligatoire : prendre la photo" onPress={onPrendre} style={[styles.zonePhoto, { borderColor: c.danger, backgroundColor: c.dangerDoux }]}>
          <Appareil taille={40} couleur={c.dangerTexte} />
          <Texte variante="libelle" ton="dangerTexte">Photo obligatoire</Texte>
        </Pressable>
      )}
      <Champ libelle="Défaut constaté (facultatif)" value={commentaire} onChangeText={onCommentaire} />
    </View>
  );
}

/** Réponse géante d'un point critique : 104 dp, forme et mot, aplat une fois choisie. */
function GrandeReponse({ answer, choisie, onPress }: { answer: "ok" | "not_ok"; choisie: boolean; onPress: () => void }) {
  const { c } = useTerrain();
  const ok = answer === "ok";
  const bord = ok ? c.ok : c.danger;
  const encre = choisie ? (ok ? c.okSur : c.dangerSur) : bord;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: choisie }}
      accessibilityLabel={ok ? "Conforme" : "Non conforme"}
      onPress={onPress}
      android_ripple={{ color: c.voile, foreground: true }}
      style={[styles.grande, { borderColor: bord, backgroundColor: choisie ? (ok ? c.okPlein : c.dangerPlein) : c.surface }]}
    >
      {ok ? <Coche taille={32} couleur={encre} /> : <Losange taille={32} couleur={encre} />}
      <Text style={[textes.libelle, { color: encre }]}>{ok ? "Conforme" : "Non conforme"}</Text>
    </Pressable>
  );
}

/** Réponse d'un point non bloquant : 56 dp. */
function PetiteReponse({ answer, choisie, onPress }: { answer: "ok" | "not_ok"; choisie: boolean; onPress: () => void }) {
  const { c } = useTerrain();
  const ok = answer === "ok";
  const bord = ok ? c.ok : c.danger;
  const encre = choisie ? (ok ? c.okSur : c.dangerSur) : bord;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: choisie }}
      accessibilityLabel={ok ? "Conforme" : "Non conforme"}
      onPress={onPress}
      style={[styles.petite, { borderColor: bord, backgroundColor: choisie ? (ok ? c.okPlein : c.dangerPlein) : c.surface }]}
    >
      {ok ? <Coche taille={22} couleur={encre} /> : <Losange taille={22} couleur={encre} />}
      <Text style={[textes.bouton, { color: encre }]}>{ok ? "Conforme" : "Non conforme"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  retour: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center" },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  vide: { padding: espaces[8], textAlign: "center" },
  progression: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: espaces[4], borderBottomWidth: traits.filet },
  mention: { flexDirection: "row", alignItems: "center", gap: espaces[2] },
  reponses: { flexDirection: "row", gap: espaces[3], padding: espaces[4], borderTopWidth: traits.filet },
  grande: { flex: 1, minHeight: mesures.choix, borderRadius: rayons.feuille, borderWidth: traits.fort, alignItems: "center", justifyContent: "center", gap: espaces[2], overflow: "hidden" },
  petite: { flex: 1, minHeight: mesures.cible, borderRadius: rayons.bouton, borderWidth: traits.champ, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: espaces[2] },
  deux: { flexDirection: "row", gap: espaces[3] },
  zonePhoto: { minHeight: 120, borderRadius: rayons.feuille, borderWidth: traits.fort, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: espaces[2] },
  vignette: { flexDirection: "row", gap: espaces[3], alignItems: "center" },
  image: { width: 96, height: 96, borderRadius: rayons.champ },
});
