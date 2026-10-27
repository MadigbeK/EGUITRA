import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Image, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { revenir } from "../accueil/retour";
import { ApiError } from "../api/errors";
import type { Utilisateur } from "../auth/coffre";
import { useSession } from "../auth/session";
import { useConfirmerCode } from "../auth/Verrou";
import { DELAI_LISTE } from "../config";
import { fmtDate, heure, pluriel } from "../format";
import type { Piece } from "../store/types";
import { useEnvoi } from "../sync/Envoi";
import { BarreAction, Bandeau, Bouton, Champ, EnTete, Ecran, Feuille, Tampon, Texte, vibrer } from "../ui/elements";
import { Appareil } from "../ui/icones";
import { espaces, mesures, rayons, textes, traits } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import { appareil, supprimerPhoto } from "./appareil";
import { deposerPhoto } from "./depot";
import { PrisePhoto } from "./PrisePhoto";
import type { Nonconformity } from "./types";

interface Page {
  items: Nonconformity[];
  counts?: { open: number; blocking_open: number };
}

/**
 * Non-conformités ouvertes du site, à lever par le chef de parc après correction (contrat HSSEQ,
 * § 7) : photo de la correction obligatoire, déposée d'abord, puis citée par la levée. La levée
 * d'un point bloquant lève V02 quand il n'en reste plus sur le véhicule. Geste en ligne : le bureau
 * confirme la levée.
 */
export function NonConformites({ user: _user }: { user: Utilisateur }) {
  return (
    <Module nom="hsseq">
      <Contenu />
    </Module>
  );
}

function Contenu() {
  const router = useRouter();
  const { api } = useSession();
  const envoi = useEnvoi();
  const { echanger } = envoi;
  const { c } = useTerrain();
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [chargement, setChargement] = useState(false);
  const [choisie, setChoisie] = useState<Nonconformity | null>(null);
  const [photo, setPhoto] = useState<Piece | null>(null);
  const [camera, setCamera] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [levee, setLevee] = useState(false);
  const [retour, setRetour] = useState<{ ton: "ok" | "attention" | "danger"; texte: string } | null>(null);
  const uuid = useRef(randomUUID());
  const confirmerCode = useConfirmerCode();
  // Pièce déjà déposée pour cette photo : un nouvel essai après un échec de la levée ne la redépose pas.
  const depose = useRef<{ photo: string; id: number } | null>(null);
  const photoRef = useRef(photo);
  photoRef.current = photo;

  /** Photo remplacée ou abandonnée : elle quitte l'appareil. */
  const changerPhoto = useCallback((suivante: Piece | null) => {
    const avant = photoRef.current;
    if (avant && avant.uri !== suivante?.uri) void supprimerPhoto(avant.uri).catch(() => undefined);
    depose.current = null;
    setPhoto(suivante);
  }, []);

  /** Retour à la liste : la photo d'une levée non faite est abandonnée. */
  const fermer = useCallback(() => {
    changerPhoto(null);
    setCommentaire("");
    setChoisie(null);
    uuid.current = randomUUID();
  }, [changerPhoto]);

  // Retour Android sur une fiche : retour à la liste, pas à « Ma journée ».
  useEffect(() => {
    if (!choisie) return;
    const abonnement = BackHandler.addEventListener("hardwareBackPress", () => {
      fermer();
      return true;
    });
    return () => abonnement.remove();
  }, [choisie, fermer]);

  // Écran quitté sans lever : la photo prise ne sert plus.
  useEffect(() => () => {
    if (photoRef.current) void supprimerPhoto(photoRef.current.uri).catch(() => undefined);
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setPage(await echanger(() => api.appel<Page>("GET", "/hsseq/checks/nonconformities?status=open&limit=200", { timeout: DELAI_LISTE })));
    } catch {
      setPage((p) => p ?? null);
    } finally {
      setChargement(false);
    }
  }, [api, echanger]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function lever(nc: Nonconformity) {
    if (!photo || levee) return;
    setRetour(null);
    // La levée engage la personne devant l'écran : code personnel à l'appui.
    if (!(await confirmerCode(`Levée de « ${nc.item.label} » à votre nom.`))) return;
    setLevee(true);
    try {
      // La photo reste sur l'appareil jusqu'à la levée confirmée : un échec se réessaie avec elle.
      const id = depose.current?.photo === photo.uri
        ? depose.current.id
        : (await deposerPhoto(api, appareil, photo, { model: "nonconformity", id: nc.id, role: "lift" })).id;
      depose.current = { photo: photo.uri, id };
      await api.appel("POST", `/hsseq/checks/${nc.check.id}/lift`, {
        body: { nonconformity_id: nc.id, comment: commentaire.trim(), attachment_ids: [id] },
      });
      vibrer.succes();
      setRetour({ ton: "ok", texte: `Non-conformité levée : ${nc.item.label}.` });
      fermer();
      void charger();
    } catch (e) {
      vibrer.erreur();
      setRetour({ ton: "danger", texte: e instanceof ApiError ? e.message : "Levée impossible sans réseau : la photo reste sur l'appareil, réessayez au retour du réseau." });
    } finally {
      setLevee(false);
    }
  }

  const entete = (
    <EnTete
      titre="Non-conformités"
      sousTitre={choisie ? choisie.vehicle?.name ?? "À lever" : "À lever après correction"}
      gauche={(
        <Pressable accessibilityRole="button" accessibilityLabel={choisie ? "Retour à la liste" : "Retour à Ma journée"} onPress={() => (choisie ? fermer() : revenir(router))} style={styles.retour}>
          <Text style={[textes.libelle, { color: c.enteteEncre }]}>‹</Text>
        </Pressable>
      )}
    />
  );

  if (page === undefined) return <Ecran>{entete}<Texte ton="second" style={styles.vide}>Chargement des non-conformités…</Texte></Ecran>;

  if (!choisie) {
    const items = page?.items ?? [];
    return (
      <Ecran>
        {entete}
        <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={chargement} onRefresh={() => void charger()} />}>
          {retour ? <Bandeau ton={retour.ton} texte={retour.texte} onFermer={() => setRetour(null)} /> : null}
          {page === null ? <Bandeau ton="attention" texte="Liste indisponible : le bureau n'a pas pu être joint. Elle s'affichera au retour du réseau." /> : null}
          {page && items.length === 0 ? <Texte ton="second" style={styles.vide}>Aucune non-conformité ouverte sur vos sites.</Texte> : null}
          {page?.counts && items.length ? (
            <Texte variante="service" ton="second">{pluriel(page.counts.open, "ouverte")}, dont {pluriel(page.counts.blocking_open, "bloquante")}.</Texte>
          ) : null}
          {items.map((nc) => (
            <Pressable key={nc.id} accessibilityRole="button" accessibilityLabel={`${nc.item.label}, ${nc.vehicle?.name ?? ""}`} onPress={() => { setRetour(null); setChoisie(nc); }} android_ripple={{ color: c.voile }}>
              <Feuille style={nc.item.blocking ? { borderColor: c.danger, borderWidth: traits.champ } : undefined}>
                <View style={styles.ligne}>
                  <Texte variante="texteDemi" style={{ flex: 1 }}>{nc.item.label}</Texte>
                  <Tampon mot={nc.item.blocking ? "Bloquant" : "Ouverte"} ton={nc.item.blocking ? "danger" : "warn"} />
                </View>
                <Texte variante="service" ton="second">{[nc.vehicle?.name, nc.site?.name, `constatée le ${fmtDate(nc.found_at)} à ${heure(nc.found_at)}`].filter(Boolean).join(", ")}</Texte>
                {nc.photos_missing ? <Texte variante="service" ton="dangerTexte">Photo du défaut manquante</Texte> : null}
              </Feuille>
            </Pressable>
          ))}
        </ScrollView>
      </Ecran>
    );
  }

  const peutLever = choisie.rights?.can_close !== false;
  return (
    <Ecran>
      {entete}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {retour ? <Bandeau ton={retour.ton} texte={retour.texte} onFermer={() => setRetour(null)} /> : null}
        <Feuille>
          <Tampon mot={choisie.item.blocking ? "Bloquant" : "Ouverte"} ton={choisie.item.blocking ? "danger" : "warn"} />
          <Texte variante="titre">{choisie.item.label}</Texte>
          {choisie.comment ? <Texte>{choisie.comment}</Texte> : null}
          <Texte variante="service" ton="second">Constatée le {fmtDate(choisie.found_at)} à {heure(choisie.found_at)}{choisie.check.reference ? `, contrôle ${choisie.check.reference}` : ""}.</Texte>
          {choisie.item.blocking ? <Texte variante="service" ton="dangerTexte">Bloque le départ du véhicule (V02) tant qu'elle n'est pas levée.</Texte> : null}
        </Feuille>
        {!peutLever ? <Bandeau ton="attention" texte="Levée réservée au chef de parc du site et au Responsable HSSEQ." /> : null}
        <Feuille>
          <Texte variante="libelle">Photo après correction, obligatoire</Texte>
          {photo ? (
            <View style={styles.vignette}>
              {photo.uri.startsWith("simulation://") ? <View style={[styles.image, { backgroundColor: c.surface2 }]} /> : <Image source={{ uri: photo.uri }} style={styles.image} accessibilityLabel="Photo de la correction" />}
              <View style={{ flex: 1, gap: espaces[2] }}>
                <Texte variante="service" ton="second">Prise à {heure(photo.created_at)}</Texte>
                <Bouton titre="Reprendre" variante="secondaire" onPress={() => setCamera(true)} />
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Photo obligatoire : prendre la photo de la correction" onPress={() => setCamera(true)} style={[styles.zonePhoto, { borderColor: c.danger, backgroundColor: c.dangerDoux }]}>
              <Appareil taille={40} couleur={c.dangerTexte} />
              <Texte variante="libelle" ton="dangerTexte">Photo obligatoire</Texte>
            </Pressable>
          )}
          <Champ libelle="Correction faite (facultatif)" multiline value={commentaire} onChangeText={setCommentaire} />
        </Feuille>
      </ScrollView>
      <BarreAction
        etat={!envoi.online ? "Hors réseau : la levée demande le bureau." : !photo ? "Photo obligatoire pour lever la non-conformité." : "Prêt à lever."}
        tonEtat={!photo ? "dangerTexte" : "second"}
      >
        <Bouton style={{ flex: 1 }} titre="Lever la non-conformité" desactive={!photo || !envoi.online || !peutLever} chargement={levee} onPress={() => void lever(choisie)} />
      </BarreAction>
      </KeyboardAvoidingView>
      <PrisePhoto
        visible={camera}
        rattachement={{ parent_uuid: uuid.current, model: "nonconformity", item_id: choisie.item.id }}
        onFermer={() => setCamera(false)}
        onPhoto={changerPhoto}
      />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  retour: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center" },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  vide: { padding: espaces[8], textAlign: "center" },
  ligne: { flexDirection: "row", alignItems: "center", gap: espaces[3] },
  zonePhoto: { minHeight: 120, borderRadius: rayons.feuille, borderWidth: traits.fort, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: espaces[2] },
  vignette: { flexDirection: "row", gap: espaces[3], alignItems: "center" },
  image: { width: 96, height: 96, borderRadius: rayons.champ },
});
