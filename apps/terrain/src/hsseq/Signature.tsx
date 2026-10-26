import { useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Platform, StyleSheet, View, type HostInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { BarreAction, Bouton, Texte, vibrer } from "../ui/elements";
import { espaces, rayons, traits } from "../ui/terrain";
import { useTerrain } from "../ui/useTerrain";

/** Le noyau accepte une signature en image PNG ou JPEG de 512 Ko au plus (controllers/checks.py). */
const TAILLE_MAX = 512 * 1024;
/** Aperçu web (développement) : pas de capture d'écran possible, une image d'un point. */
const SIGNATURE_SIMULEE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Signature tracée au doigt (système « terrain », § 3.10) : zone de 230 dp de haut, ligne de base en
 * tirets, « Effacer » et « Valider la signature ». Le tracé est rendu en image PNG, envoyée avec le
 * contrôle. La signature par code personnel attend la décision de la Direction générale sur sa valeur.
 */
export function Signature({ visible, onFermer, onSignee }: { visible: boolean; onFermer: () => void; onSignee: (image: string) => void }) {
  const { c } = useTerrain();
  const zone = useRef<HostInstance>(null);
  const [traces, setTraces] = useState<string[]>([]);
  const encours = useRef("");
  const [, rafraichir] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [travail, setTravail] = useState(false);

  const geste = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          encours.current = `M${e.nativeEvent.locationX.toFixed(1)} ${e.nativeEvent.locationY.toFixed(1)}`;
          rafraichir((n) => n + 1);
        },
        onPanResponderMove: (e) => {
          encours.current += ` L${e.nativeEvent.locationX.toFixed(1)} ${e.nativeEvent.locationY.toFixed(1)}`;
          rafraichir((n) => n + 1);
        },
        onPanResponderRelease: () => {
          const t = encours.current;
          encours.current = "";
          if (t) setTraces((x) => [...x, t]);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  const vide = traces.length === 0 && !encours.current;

  async function valider() {
    if (vide || travail) return;
    setTravail(true);
    setErreur(null);
    try {
      const image = Platform.OS === "web" ? SIGNATURE_SIMULEE : await captureRef(zone, { format: "png", result: "data-uri", width: 600 });
      if ((image.length * 3) / 4 > TAILLE_MAX) throw new Error("taille");
      vibrer.succes();
      onSignee(image);
      setTraces([]);
      onFermer();
    } catch {
      vibrer.erreur();
      setErreur("Signature impossible à enregistrer : effacez et recommencez.");
    } finally {
      setTravail(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onFermer}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
        <View style={styles.page}>
          <Texte variante="titre">Signature du contrôle</Texte>
          <Texte ton="second">Signez avec le doigt, dans le cadre.</Texte>
          <View ref={zone} collapsable={false} style={[styles.zone, { borderColor: c.trait }]} {...geste.panHandlers}>
            <View style={[styles.base, { borderColor: c.second }]} />
            <Svg style={StyleSheet.absoluteFill}>
              {[...traces, encours.current].filter(Boolean).map((d, i) => (
                <Path key={i} d={d} stroke="#0b1a16" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </Svg>
            {vide ? <Texte ton="second" style={styles.invite} pointerEvents="none">Signez ici avec le doigt</Texte> : null}
          </View>
          {erreur ? <Texte ton="dangerTexte">{erreur}</Texte> : null}
          <View style={styles.deux}>
            <Bouton titre="Effacer" variante="secondaire" desactive={vide} onPress={() => { setTraces([]); encours.current = ""; rafraichir((n) => n + 1); }} />
            <Bouton titre="Annuler" variante="discret" onPress={onFermer} />
          </View>
        </View>
        <BarreAction etat={vide ? "Signez dans le cadre pour valider." : "Signature prête."}>
          <Bouton style={{ flex: 1 }} titre="Valider la signature" desactive={vide} chargement={travail} onPress={() => void valider()} />
        </BarreAction>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: espaces[4], gap: espaces[4] },
  zone: { height: 230, width: "100%", maxWidth: 560, alignSelf: "center", backgroundColor: "#ffffff", borderWidth: traits.champ, borderRadius: rayons.feuille, overflow: "hidden" },
  base: { position: "absolute", left: espaces[6], right: espaces[6], bottom: 56, borderBottomWidth: traits.champ, borderStyle: "dashed" },
  invite: { position: "absolute", left: 0, right: 0, top: 90, textAlign: "center" },
  deux: { flexDirection: "row", gap: espaces[3] },
});
