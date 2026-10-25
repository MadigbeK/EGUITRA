import { FunnelDisplay_600SemiBold, FunnelDisplay_700Bold } from "@expo-google-fonts/funnel-display";
import { FunnelSans_400Regular, FunnelSans_600SemiBold, FunnelSans_700Bold } from "@expo-google-fonts/funnel-sans";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../auth/session";
import { EnvoiProvider } from "../sync/Envoi";
import { API_URL, SIMULATION } from "../config";
import { Connexion } from "../connexion/Connexion";
import { Texte } from "../ui/elements";
import { espaces, marque, polices } from "../ui/terrain";
import { TerrainProvider } from "../ui/useTerrain";

export default function Racine() {
  // Une famille par graisse, aux noms du système « terrain » (ui/terrain.ts, polices).
  const [chargees, erreur] = useFonts({
    [polices.titre]: FunnelDisplay_700Bold,
    [polices.titreDemi]: FunnelDisplay_600SemiBold,
    [polices.texte]: FunnelSans_400Regular,
    [polices.texteDemi]: FunnelSans_600SemiBold,
    [polices.texteGras]: FunnelSans_700Bold,
  });
  // Police illisible : l'application s'ouvre avec celles du système plutôt que de rester bloquée.
  if (!chargees && !erreur) return <View style={styles.fond} />;
  return (
    <SafeAreaProvider>
      <TerrainProvider>
        <StatusBar style="light" />
        {!API_URL && !SIMULATION ? (
          <View style={[styles.fond, styles.centre]}>
            <Texte variante="titre" style={{ color: "#ffffff", textAlign: "center" }}>
              Adresse du bureau non configurée
            </Texte>
            <Texte style={{ color: marque.menthe, textAlign: "center" }}>
              Cette version de l'application ne peut pas travailler. Prévenez l'administrateur.
            </Texte>
          </View>
        ) : (
          <SessionProvider>
            <Porte />
          </SessionProvider>
        )}
      </TerrainProvider>
    </SafeAreaProvider>
  );
}

/**
 * Rien de l'application ne s'affiche avant une session ouverte. La file d'envoi commune appartient à
 * l'utilisateur : un autre compte repart d'une file à lui.
 */
function Porte() {
  const { etape, store, api } = useSession();
  if (etape.nom === "demarrage") {
    return (
      <View style={[styles.fond, styles.centre]}>
        <ActivityIndicator color={marque.menthe} size="large" />
      </View>
    );
  }
  if (etape.nom !== "ouverte") return <Connexion />;
  return (
    <EnvoiProvider key={etape.user.id} store={store} api={api} userId={etape.user.id}>
      <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
    </EnvoiProvider>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: marque.foret },
  centre: { alignItems: "center", justifyContent: "center", gap: espaces[3], padding: espaces[6] },
});
