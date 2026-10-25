import { CameraView, useCameraPermissions } from "expo-camera";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SIMULATION } from "../config";
import type { Piece } from "../store/types";
import { Bouton, Texte, vibrer } from "../ui/elements";
import { espaces, marque, mesures, textes } from "../ui/terrain";
import { preparerPhoto } from "./appareil";

/**
 * Appareil photo intégré (système « terrain », § 3.4) : la photo ne passe pas par la galerie du
 * téléphone. Déclencheur de 84 dp, lampe à gauche, fermeture en haut ; le retour Android ferme sans
 * rien perdre. La photo est compressée puis gardée dans le dossier de l'application.
 */
export function PrisePhoto({
  visible, rattachement, onFermer, onPhoto,
}: {
  visible: boolean;
  rattachement: Pick<Piece, "parent_uuid" | "model" | "item_id">;
  onFermer: () => void;
  onPhoto: (piece: Piece) => void;
}) {
  const [permission, demander] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [lampe, setLampe] = useState(false);
  const [travail, setTravail] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Aperçu dans un navigateur (développement) : pas d'appareil photo, une photo simulée.
  const simulee = Platform.OS === "web" && SIMULATION;

  async function prendre() {
    if (travail) return;
    setTravail(true);
    setErreur(null);
    try {
      if (simulee) {
        onPhoto({ client_uuid: randomUUID(), ...rattachement, uri: "simulation://photo.jpg", size: 0, created_at: new Date().toISOString() });
      } else {
        const cliche = await camera.current?.takePictureAsync({ quality: 0.9 });
        if (!cliche) throw new Error("photo");
        onPhoto(await preparerPhoto(cliche, rattachement));
      }
      vibrer.succes();
      onFermer();
    } catch {
      vibrer.erreur();
      setErreur("Photo impossible : réessayez.");
    } finally {
      setTravail(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onFermer}>
      <SafeAreaView style={styles.racine}>
        {simulee ? (
          <View style={[styles.vue, styles.centre]}>
            <Texte style={{ color: "#ffffff", textAlign: "center" }}>Aperçu web : pas d'appareil photo. Le déclencheur ajoute une photo simulée.</Texte>
          </View>
        ) : !permission ? (
          <View style={[styles.vue, styles.centre]}><ActivityIndicator color="#ffffff" /></View>
        ) : !permission.granted ? (
          <View style={[styles.vue, styles.centre]}>
            <Texte style={{ color: "#ffffff", textAlign: "center" }}>
              L'application a besoin de l'appareil photo pour joindre la preuve. La photo reste dans l'application, jamais dans la galerie.
            </Texte>
            {permission.canAskAgain ? (
              <Bouton titre="Autoriser l'appareil photo" onPress={() => void demander()} />
            ) : (
              <Texte style={{ color: marque.or, textAlign: "center" }}>Autorisation refusée : ouvrez les réglages du téléphone, Applications, NIMOVA Terrain, Autorisations.</Texte>
            )}
          </View>
        ) : (
          <CameraView ref={camera} style={styles.vue} facing="back" enableTorch={lampe} />
        )}
        <View style={styles.haut}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer l'appareil photo" onPress={onFermer} style={styles.cible} hitSlop={8}>
            <Text style={[textes.libelle, { color: "#ffffff" }]}>Fermer</Text>
          </Pressable>
        </View>
        {erreur ? <Text style={[textes.service, styles.erreur]}>{erreur}</Text> : null}
        <View style={styles.bas}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={lampe ? "Éteindre la lampe" : "Allumer la lampe"}
            accessibilityState={{ checked: lampe }}
            onPress={() => setLampe(!lampe)}
            style={[styles.cible, styles.lampe, lampe && { backgroundColor: marque.or }]}
          >
            <Text style={[textes.service, { color: lampe ? "#0b1a16" : "#ffffff" }]}>Lampe</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Prendre la photo"
            disabled={travail || (!simulee && !permission?.granted)}
            onPress={() => void prendre()}
            style={({ pressed }) => [styles.declencheur, pressed && { transform: [{ scale: 0.94 }] }]}
          >
            {travail ? <ActivityIndicator color="#0b1a16" /> : null}
          </Pressable>
          <View style={styles.cible} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, backgroundColor: "#000000" },
  vue: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center", gap: espaces[4], padding: espaces[6] },
  haut: { position: "absolute", top: espaces[8], left: espaces[4], right: espaces[4], flexDirection: "row", justifyContent: "flex-end" },
  bas: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: espaces[6], paddingVertical: espaces[5] },
  cible: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center", borderRadius: mesures.cible / 2 },
  lampe: { borderWidth: 2, borderColor: "#ffffff", paddingHorizontal: espaces[3] },
  declencheur: {
    width: mesures.declencheur, height: mesures.declencheur, borderRadius: mesures.declencheur / 2, backgroundColor: "#ffffff",
    borderWidth: 6, borderColor: "rgba(255,255,255,0.45)", alignItems: "center", justifyContent: "center",
  },
  erreur: { color: marque.or, textAlign: "center", paddingHorizontal: espaces[4] },
});
