import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { revenir } from "./retour";
import type { Utilisateur } from "../auth/coffre";
import { Bouton, Ecran, Texte } from "../ui/elements";
import { espaces } from "../ui/terrain";
import { peutOuvrir, type ModuleTerrain } from "./modules";

/** Un module hors du profil du compte ne s'ouvre pas, même par une adresse directe. */
export function Garde({ user, module, children }: { user: Utilisateur; module: ModuleTerrain["cle"]; children: ReactNode }) {
  const router = useRouter();
  if (peutOuvrir(user.profiles, module)) return <>{children}</>;
  return (
    <Ecran>
      <View style={styles.page}>
        <Texte variante="titre">Accès non autorisé pour votre profil</Texte>
        <Texte>Ce module ne fait pas partie de votre travail dans l'application. Voyez le bureau si c'est une erreur.</Texte>
        {/* Module ouvert par une adresse directe : rien derrière, retour à l'accueil. */}
        <Bouton titre="Retour à Ma journée" onPress={() => revenir(router)} />
      </View>
    </Ecran>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", padding: espaces[6], gap: espaces[4] },
});
