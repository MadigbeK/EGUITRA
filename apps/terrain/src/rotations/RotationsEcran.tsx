import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HorsReseau } from "../api/errors";
import type { Utilisateur } from "../auth/coffre";
import { useSession } from "../auth/session";
import { ENVIRONNEMENT, SIMULATION } from "../config";
import { pluriel } from "../format";
import { Bandeau, PastilleReseau, Segment, Texte, demanderConfirmation, type EtatReseau } from "../ui/elements";
import { couleurs, espaces, LARGEUR_TABLETTE } from "../ui/theme";
import { blank, fromPayload, type Form } from "./form";
import { ListeAttente, ListeEnvoyees } from "./Listes";
import { Saisie } from "./Saisie";
import { useRotations } from "./useRotations";

type Vue = "saisie" | "attente" | "envoyees";

/**
 * Rotations : saisie au parc, saisies en attente, rotations envoyées. Au téléphone, une vue à la
 * fois sous des onglets ; sur tablette ou en paysage, la saisie à gauche et les listes à droite.
 */
export function RotationsEcran({ user }: { user: Utilisateur }) {
  const { api, store, seDeconnecter } = useSession();
  const rot = useRotations(store, api, user.id);
  const [vue, setVue] = useState<Vue>("saisie");
  const [form, setForm] = useState<Form>(() => blank());
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tablette = width >= LARGEUR_TABLETTE;
  const aEnvoyer = rot.mine.length;
  const etatReseau: EtatReseau = !rot.online ? "hors" : rot.faible ? "faible" : "en_ligne";

  async function quitter() {
    // Toujours confirmée : la déconnexion efface les listes de l'appareil.
    const question = aEnvoyer
      ? `${pluriel(aEnvoyer, "saisie n'a pas encore été transmise", "saisies n'ont pas encore été transmises")}. ${aEnvoyer > 1 ? "Elles restent sur cet appareil et partiront" : "Elle reste sur cet appareil et partira"} à votre prochaine connexion.`
      : "Les listes gardées sur cet appareil seront effacées : il faudra du réseau pour vous reconnecter.";
    if (!(await demanderConfirmation(question, { titre: "Se déconnecter ?", action: "Se déconnecter" }))) return;
    try {
      await seDeconnecter();
    } catch (e) {
      rot.setNotice({
        ton: "attention",
        texte: e instanceof HorsReseau || !(e instanceof Error) ? "Déconnexion impossible sans réseau : réessayez au retour du réseau." : e.message,
      });
    }
  }

  const corriger = (item: Parameters<typeof fromPayload>[0]) => {
    if (!rot.refs) return;
    setForm(fromPayload(item, rot.refs));
    setVue("saisie");
  };

  const listes: Array<{ cle: Vue; libelle: string; compte?: number }> = [
    { cle: "attente", libelle: "À envoyer", compte: aEnvoyer },
    { cle: "envoyees", libelle: "Envoyées" },
  ];
  const vueListe: Vue = vue === "saisie" ? "attente" : vue;

  return (
    <View style={styles.racine}>
      <View style={[styles.entete, { paddingTop: insets.top + espaces.s }]}>
        <View style={{ flex: 1 }}>
          <Texte variante="titre" style={{ color: couleurs.creme }}>Rotations</Texte>
          <Texte variante="aide" style={{ color: couleurs.menthe }} numberOfLines={1}>
            {user.name}{ENVIRONNEMENT ? `, ${ENVIRONNEMENT}` : ""}
          </Texte>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${aEnvoyer ? pluriel(aEnvoyer, "saisie à envoyer", "saisies à envoyer") : "Rien à envoyer"}. Ouvrir « À envoyer ».`}
          onPress={() => setVue("attente")}
          style={styles.cible}
        >
          <PastilleReseau etat={rot.syncing ? "en_ligne" : etatReseau} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" onPress={() => void quitter()} style={styles.cible}>
          <Texte variante="libelle" style={{ color: couleurs.creme }}>Quitter</Texte>
        </Pressable>
      </View>
      {SIMULATION ? (
        <View style={styles.simulation}>
          <Texte variante="libelle" ton="foret">Simulation : bureau fictif, aucune donnée réelle.</Texte>
        </View>
      ) : null}

      {tablette ? (
        <View style={styles.colonnes}>
          <View style={[styles.colonne, { flex: 1.15, borderRightWidth: 1, borderRightColor: couleurs.ligneForte }]}>
            {rot.notice ? <Avis rot={rot} /> : null}
            <Saisie rot={rot} userId={user.id} form={form} setForm={setForm} barre={false} />
          </View>
          <View style={styles.colonne}>
            <View style={styles.onglets}>
              <Segment options={listes} valeur={vueListe} onChange={setVue} />
            </View>
            {vueListe === "attente" ? <ListeAttente rot={rot} onCorriger={corriger} /> : <ListeEnvoyees rot={rot} />}
          </View>
        </View>
      ) : (
        <View style={styles.colonne}>
          <View style={styles.onglets}>
            <Segment options={[{ cle: "saisie", libelle: "Nouvelle" }, ...listes]} valeur={vue} onChange={setVue} />
          </View>
          {rot.notice ? <Avis rot={rot} /> : null}
          {vue === "saisie" ? <Saisie rot={rot} userId={user.id} form={form} setForm={setForm} /> : null}
          {vue === "attente" ? <ListeAttente rot={rot} onCorriger={corriger} /> : null}
          {vue === "envoyees" ? <ListeEnvoyees rot={rot} /> : null}
        </View>
      )}
    </View>
  );
}

function Avis({ rot }: { rot: ReturnType<typeof useRotations> }) {
  const n = rot.notice;
  if (!n) return null;
  return (
    <View style={{ paddingHorizontal: espaces.l, paddingTop: espaces.m }}>
      <Bandeau ton={n.ton} texte={n.texte} onFermer={() => rot.setNotice(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, backgroundColor: couleurs.fond },
  entete: {
    flexDirection: "row", alignItems: "center", gap: espaces.s, backgroundColor: couleurs.foret,
    paddingHorizontal: espaces.l, paddingBottom: espaces.m,
  },
  cible: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  simulation: { backgroundColor: couleurs.or, paddingHorizontal: espaces.l, paddingVertical: 6 },
  colonnes: { flex: 1, flexDirection: "row" },
  colonne: { flex: 1 },
  onglets: { paddingHorizontal: espaces.l, paddingTop: espaces.m },
});
