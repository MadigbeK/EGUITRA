import { FunnelDisplay_500Medium, FunnelDisplay_600SemiBold } from "@expo-google-fonts/funnel-display";
import { FunnelSans_400Regular, FunnelSans_500Medium, FunnelSans_600SemiBold } from "@expo-google-fonts/funnel-sans";
import { useFonts } from "expo-font";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../auth/session";
import { API_URL, SIMULATION } from "../config";
import { Connexion } from "../connexion/Connexion";
import { Texte } from "../ui/elements";
import { couleurs, espaces } from "../ui/theme";

export default function Racine() {
  const [chargees, erreur] = useFonts({
    FunnelSans_400Regular, FunnelSans_500Medium, FunnelSans_600SemiBold, FunnelDisplay_500Medium, FunnelDisplay_600SemiBold,
  });
  // Police illisible : l'application s'ouvre avec celles du système plutôt que de rester bloquée.
  if (!chargees && !erreur) return <View style={styles.fond} />;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!API_URL && !SIMULATION ? (
        <View style={[styles.fond, styles.centre]}>
          <Texte variante="titre" style={{ color: couleurs.creme, textAlign: "center" }}>
            Adresse du bureau non configurée
          </Texte>
          <Texte style={{ color: couleurs.menthe, textAlign: "center" }}>
            Cette version de l'application ne peut pas travailler. Prévenez l'administrateur.
          </Texte>
        </View>
      ) : (
        <SessionProvider>
          <Porte />
        </SessionProvider>
      )}
    </SafeAreaProvider>
  );
}

/** Rien de l'application ne s'affiche avant une session ouverte. */
function Porte() {
  const { etape } = useSession();
  if (etape.nom === "demarrage") {
    return (
      <View style={[styles.fond, styles.centre]}>
        <ActivityIndicator color={couleurs.menthe} size="large" />
      </View>
    );
  }
  if (etape.nom !== "ouverte") return <Connexion />;
  return <Slot />;
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: couleurs.foret },
  centre: { alignItems: "center", justifyContent: "center", gap: espaces.m, padding: espaces.xl },
});
