import { randomUUID } from "expo-crypto";
import { useKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Image, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View, type TextInputInstance } from "react-native";
import { revenir } from "../accueil/retour";
import type { Utilisateur } from "../auth/coffre";
import { duree, heure } from "../format";
import type { Piece } from "../store/types";
import { useEnvoi } from "../sync/Envoi";
import { BarreAction, Bouton, Champ, demanderConfirmation, EnTete, Ecran, Feuille, Texte, vibrer } from "../ui/elements";
import { espaces, mesures, rayons, traits } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import { supprimerPhoto } from "./appareil";
import { positionDeLaFiche, usePosition } from "./position";
import { PrisePhoto } from "./PrisePhoto";
import type { CrisisContact, EventReport, EventType } from "./types";
import { numeroAppel, useContactsCrise, useHsseq } from "./useHsseq";

/** Libellés affichés des types d'événement (contrat HSSEQ, § 5 ; écriture du terrain, § 4). */
export const TYPE_LIBELLE: Record<EventType, string> = {
  near_miss: "Presque-accident",
  hazard: "Situation dangereuse",
  road_accident: "Accident de la route",
  work_accident: "Accident du travail",
  spill: "Déversement",
  fire: "Incendie",
  security_breach: "Atteinte à la sûreté",
  product_quality: "Qualité du produit",
  property_damage: "Dégât matériel",
};

const AUTRES: EventType[] = ["spill", "fire", "security_breach", "product_quality", "property_damage"];

/** Titre de la fiche : le type, puis le début de la phrase. */
export function titreDeclaration(type: EventType, phrase: string): string {
  const debut = phrase.trim().replace(/\s+/g, " ");
  if (!debut) return TYPE_LIBELLE[type];
  return `${TYPE_LIBELLE[type]} : ${debut.length > 60 ? `${debut.slice(0, 59)}…` : debut}`;
}

/**
 * Déclaration en un geste (système « terrain », § 3.14) : trois tuiles, le plus fréquent au plus près
 * du pouce, une photo conseillée, une phrase ; la position est relevée sans geste. Une photo ou une
 * phrase suffit. Objectif : moins de 30 secondes, chronométré discrètement.
 */
export function Declaration({ user }: { user: Utilisateur }) {
  return (
    <Module nom="hsseq">
      <Contenu user={user} />
    </Module>
  );
}

function Contenu({ user }: { user: Utilisateur }) {
  useKeepAwake();
  const router = useRouter();
  const envoi = useEnvoi();
  const { refs } = useHsseq();
  const { c } = useTerrain();
  const position = usePosition();
  const debut = useRef(Date.now());
  const uuid = useRef(randomUUID());
  const [type, setType] = useState<EventType | null>(null);
  const [accident, setAccident] = useState(false);
  const [autres, setAutres] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [photo, setPhoto] = useState<Piece | null>(null);
  const [camera, setCamera] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [fait, setFait] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);
  const [sansPhoto, setSansPhoto] = useState(false);
  const champPhrase = useRef<TextInputInstance>(null);
  const contacts = useContactsCrise();
  const sortie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoRef = useRef(photo);
  photoRef.current = photo;
  const enregistree = useRef(false);

  const vehicule = refs?.vehicles.find((v) => v.driver_id != null && v.driver_id === refs.me.driver_id);
  const pret = type !== null && (photo !== null || phrase.trim().length > 0);
  const commencee = photo !== null || phrase.trim().length > 0;

  // Écran quitté sans envoyer : la photo prise quitte l'appareil ; le minuteur de sortie s'arrête.
  useEffect(() => () => {
    if (sortie.current) clearTimeout(sortie.current);
    if (!enregistree.current && photoRef.current) void supprimerPhoto(photoRef.current.uri).catch(() => undefined);
  }, []);

  /** Photo reprise : la précédente quitte l'appareil. */
  function joindre(p: Piece) {
    if (photo && photo.uri !== p.uri) void supprimerPhoto(photo.uri).catch(() => undefined);
    setSansPhoto(false);
    setPhoto(p);
  }

  /** Sortie du formulaire : une déclaration commencée ne se perd pas sans confirmation. */
  async function quitter() {
    if (commencee && !fait && !(await demanderConfirmation("Abandonner cette déclaration ? La photo et la phrase seront effacées.", { action: "Abandonner", danger: true }))) return;
    revenir(router);
  }

  // Retour Android : du formulaire, retour au choix du type (la saisie reste) ; du choix, sortie.
  useEffect(() => {
    const abonnement = BackHandler.addEventListener("hardwareBackPress", () => {
      if (fait) return false;
      if (type) {
        setType(null);
        setAccident(false);
        return true;
      }
      if (commencee) {
        void quitter();
        return true;
      }
      return false;
    });
    return () => abonnement.remove();
  });

  async function enregistrer() {
    if (!type || !pret || envoiEnCours) return;
    setEnvoiEnCours(true);
    setEchec(false);
    const maintenant = new Date().toISOString();
    const fiche: EventReport & { offline: boolean } = {
      type,
      title: titreDeclaration(type, phrase),
      description: phrase.trim() || "Photo jointe, sans commentaire.",
      occurred_at: maintenant,
      site_id: vehicule?.site_id ?? refs?.me.site_ids[0] ?? null,
      vehicle_id: vehicule?.id ?? null,
      ...positionDeLaFiche(position),
      offline: !envoi.online,
    };
    try {
      await envoi.enregistrer(
        { client_uuid: uuid.current, kind: "event", user_id: user.id, created_at: maintenant, status: "pending", payload: { ...fiche } },
        photo ? [photo] : [],
      );
    } catch {
      setEnvoiEnCours(false);
      setEchec(true);
      vibrer.erreur();
      return;
    }
    enregistree.current = true;
    vibrer.succes();
    setFait(`Déclaration enregistrée en ${duree((Date.now() - debut.current) / 1000)}.`);
    void envoi.sync("saisie");
    sortie.current = setTimeout(() => revenir(router), 1500);
  }

  const etat = fait
    ?? (echec
      ? "Enregistrement impossible sur cet appareil : réessayez. Si cela recommence, prévenez le bureau."
      : !type ? "Choisissez ce qui s'est passé."
        : !pret ? (sansPhoto ? "Sans photo : écrivez une phrase." : "Une photo ou une phrase suffit pour envoyer.")
          : !envoi.online ? "Hors réseau : la déclaration partira seule dès que le réseau passe." : "Prêt à envoyer.");

  return (
    <Ecran>
      <EnTete
        titre="Déclarer"
        sousTitre={type ? TYPE_LIBELLE[type] : "Presque-accident, situation dangereuse, accident"}
        gauche={(
          <Pressable accessibilityRole="button" accessibilityLabel="Retour à Ma journée" onPress={() => void quitter()} style={styles.retour}>
            <Texte variante="libelle" style={{ color: c.enteteEncre }}>‹</Texte>
          </Pressable>
        )}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          {position?.vitesse != null && position.vitesse > 10 ? (
            <Feuille style={{ borderColor: c.warn, borderWidth: traits.fort }}>
              <Texte variante="libelle" ton="warn">Arrêtez-vous d'abord</Texte>
              <Texte>Le véhicule roule : garez-vous en sécurité avant de déclarer.</Texte>
            </Feuille>
          ) : null}

          {!type ? (
            <View style={{ gap: espaces[3] }}>
              <Texte variante="titre">Que s'est-il passé ?</Texte>
              {/* Le plus fréquent au plus près du pouce : presque-accident en bas, accident en haut. */}
              <Tuile titre="Accident" detail="Quelqu'un est blessé, ou un véhicule est touché" bord={c.danger} onPress={() => setAccident(true)} />
              {accident ? (
                <Feuille style={{ borderColor: c.danger, borderWidth: traits.fort }}>
                  <Texte variante="libelle" ton="dangerTexte">D'abord la sécurité</Texte>
                  <Texte>Protégez la zone et prévenez les secours et le chef de parc. Déclarez ensuite.</Texte>
                  <Appels contacts={contacts?.items} />
                  <Texte variante="libelle">Puis déclarez l'accident</Texte>
                  <View style={styles.deux}>
                    <Bouton style={{ flex: 1 }} titre="Sur la route" onPress={() => setType("road_accident")} />
                    <Bouton style={{ flex: 1 }} titre="Au travail" onPress={() => setType("work_accident")} />
                  </View>
                </Feuille>
              ) : null}
              <Tuile titre="Situation dangereuse" detail="Un risque, sans accident" bord={c.accent} onPress={() => setType("hazard")} />
              <Tuile titre="Presque-accident" detail="Cela aurait pu mal finir" bord={c.accent} onPress={() => setType("near_miss")} />
              <Bouton titre={autres ? "Masquer les autres événements" : "Autre événement"} variante="discret" onPress={() => setAutres(!autres)} />
              {autres ? (
                <View style={styles.puces}>
                  {AUTRES.map((t) => (
                    <Bouton key={t} titre={TYPE_LIBELLE[t]} variante="secondaire" onPress={() => setType(t)} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            <>
              <Feuille>
                <Texte variante="libelle">Photo, conseillée</Texte>
                {photo ? (
                  <View style={styles.vignette}>
                    {photo.uri.startsWith("simulation://") ? (
                      <View style={[styles.image, { backgroundColor: c.surface2 }]} />
                    ) : (
                      <Image source={{ uri: photo.uri }} style={styles.image} accessibilityLabel="Photo jointe" />
                    )}
                    <View style={{ flex: 1, gap: espaces[2] }}>
                      <Texte variante="service" ton="second">Prise à {heure(photo.created_at)}{photo.size ? `, ${Math.round(photo.size / 1024)} Ko` : ""}</Texte>
                      <Bouton titre="Reprendre" variante="secondaire" onPress={() => setCamera(true)} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.deux}>
                    <Bouton style={{ flex: 1 }} titre="Prendre la photo" onPress={() => setCamera(true)} />
                    <Bouton
                      style={{ flex: 1 }}
                      titre={sansPhoto ? "Sans photo, choisi" : "Sans photo"}
                      variante={sansPhoto ? "principal" : "secondaire"}
                      onPress={() => {
                        vibrer.selection();
                        setSansPhoto(true);
                        champPhrase.current?.focus();
                      }}
                    />
                  </View>
                )}
              </Feuille>
              <Champ
                ref={champPhrase}
                libelle="Ce qui s'est passé, en une phrase"
                aide="Touchez le micro du clavier pour dicter."
                multiline
                value={phrase}
                onChangeText={setPhrase}
              />
              <Texte variante="service" ton="second">
                {position === undefined
                  ? "Position : relevé en cours…"
                  : position === null
                    ? "Position : non disponible, la déclaration part sans."
                    : `Position${position.derniere ? ` connue à ${heure(position.at)}` : ""}, à ${Math.round(position.gps_accuracy ?? 0)} m près.`}
              </Texte>
              <Bouton titre="Changer de type" variante="discret" onPress={() => { setType(null); setAccident(false); }} />
            </>
          )}
        </ScrollView>
        {type ? (
          <BarreAction etat={etat} tonEtat={fait ? "ok" : echec ? "dangerTexte" : "second"}>
            <Bouton style={{ flex: 1 }} titre={fait ? "Déclaration enregistrée" : "Envoyer la déclaration"} fait={!!fait} desactive={!pret} chargement={envoiEnCours && !fait} onPress={() => void enregistrer()} />
          </BarreAction>
        ) : null}
      </KeyboardAvoidingView>
      <PrisePhoto
        visible={camera}
        rattachement={{ parent_uuid: uuid.current, model: "event", item_id: null }}
        onFermer={() => setCamera(false)}
        onPhoto={joindre}
      />
    </Ecran>
  );
}

/**
 * Appels d'urgence de l'annuaire de crise : le site d'abord, puis les secours communs, dans l'ordre
 * d'appel du Responsable HSSEQ. Trois au plus, le reste sur demande. Sans annuaire sur l'appareil, le
 * conducteur appelle le chef de parc par son propre répertoire.
 */
function Appels({ contacts }: { contacts: CrisisContact[] | undefined }) {
  const [tous, setTous] = useState(false);
  if (!contacts?.length) {
    return <Texte variante="service" ton="second">Annuaire de crise pas encore sur l'appareil : appelez le chef de parc depuis votre répertoire.</Texte>;
  }
  const montres = tous ? contacts : contacts.slice(0, 3);
  return (
    <View style={{ gap: espaces[2] }}>
      {montres.map((k) => (
        <Bouton
          key={k.id}
          titre={`Appeler : ${k.function}`}
          variante="danger"
          indice={`Appelle ${k.name}, ${k.phone}`}
          onPress={() => void Linking.openURL(`tel:${numeroAppel(k.phone)}`).catch(() => undefined)}
        />
      ))}
      {contacts.length > 3 && !tous ? <Bouton titre={`Autres numéros (${contacts.length - 3})`} variante="discret" onPress={() => setTous(true)} /> : null}
    </View>
  );
}

function Tuile({ titre, detail, bord, onPress }: { titre: string; detail: string; bord: string; onPress: () => void }) {
  const { c } = useTerrain();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${titre}. ${detail}`}
      onPress={() => {
        vibrer.selection();
        onPress();
      }}
      android_ripple={{ color: c.voile, foreground: true }}
      style={[styles.tuile, { backgroundColor: c.surface, borderColor: bord }]}
    >
      <Texte variante="titre">{titre}</Texte>
      <Texte variante="service" ton="second">{detail}</Texte>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  retour: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center" },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  tuile: { minHeight: mesures.tuile, borderRadius: rayons.tuile, borderWidth: traits.fort, padding: espaces[4], justifyContent: "center", gap: espaces[1], overflow: "hidden" },
  deux: { flexDirection: "row", gap: espaces[3] },
  puces: { flexDirection: "row", flexWrap: "wrap", gap: espaces[3] },
  vignette: { flexDirection: "row", gap: espaces[3], alignItems: "center" },
  image: { width: 96, height: 96, borderRadius: rayons.champ },
});
