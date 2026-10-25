import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ApiError } from "../api/errors";
import type { Utilisateur } from "../auth/coffre";
import { useSession } from "../auth/session";
import { ENVIRONNEMENT, SIMULATION } from "../config";
import { heure, pluriel, quand } from "../format";
import { useEnvoi } from "../sync/Envoi";
import { Bandeau, Bouton, EnTete, Ecran, Feuille, PastilleReseau, Tampon, Texte, demanderConfirmation, type EtatReseau } from "../ui/elements";
import { espaces, marque, mesures, modules, rayons, traits } from "../ui/terrain";
import { useTerrain } from "../ui/useTerrain";
import { modulesOuverts } from "./modules";

const NATURE: Record<string, string> = {
  rotation: "Rotation",
  check: "Contrôle avant départ",
  breath_test: "Alcootest",
  event: "Déclaration",
};

/**
 * « Ma journée » : les modules ouverts au compte, puis la file d'envoi commune, chaque saisie avec
 * ses deux heures (saisie, envoi).
 */
export function MaJournee({ user }: { user: Utilisateur }) {
  const router = useRouter();
  const { seDeconnecter } = useSession();
  const envoi = useEnvoi();
  const { c, mode } = useTerrain();
  const ouverts = modulesOuverts(user.profiles);
  const aEnvoyer = envoi.mine.length;
  const etatReseau: EtatReseau = !envoi.online ? "hors" : envoi.faible ? "faible" : "en_ligne";

  async function quitter() {
    const question = aEnvoyer
      ? `${pluriel(aEnvoyer, "saisie n'a pas encore été transmise", "saisies n'ont pas encore été transmises")}. ${aEnvoyer > 1 ? "Elles restent sur cet appareil et partiront" : "Elle reste sur cet appareil et partira"} à votre prochaine connexion.`
      : "Les listes gardées sur cet appareil seront effacées : il faudra du réseau pour vous reconnecter.";
    if (!(await demanderConfirmation(question, { titre: "Se déconnecter ?", action: "Se déconnecter" }))) return;
    try {
      await seDeconnecter();
    } catch (e) {
      if (e instanceof ApiError) {
        envoi.setNotice({ ton: "attention", texte: e.message });
        return;
      }
      const confirmee = await demanderConfirmation(
        "Hors réseau : la session sera fermée au bureau dès le retour du réseau. Sur cet appareil, elle l'est tout de suite.",
        { titre: "Se déconnecter sans réseau ?", action: "Se déconnecter" },
      );
      if (confirmee) await seDeconnecter({ horsReseau: true }).catch(() => undefined);
    }
  }

  return (
    <Ecran>
      <EnTete
        titre="Ma journée"
        sousTitre={`${user.name}${ENVIRONNEMENT ? `, ${ENVIRONNEMENT}` : ""}`}
        droite={(
          <>
            <View style={styles.cible} accessibilityLabel={aEnvoyer ? pluriel(aEnvoyer, "saisie à envoyer", "saisies à envoyer") : "Rien à envoyer"}>
              <PastilleReseau etat={etatReseau} enAttente={aEnvoyer} envoi={envoi.syncing} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" onPress={() => void quitter()} style={styles.cible}>
              <Texte variante="service" style={{ color: c.enteteEncre }}>Quitter</Texte>
            </Pressable>
          </>
        )}
      />
      {SIMULATION ? (
        <View style={styles.simulation}>
          <Texte variante="service" style={{ color: "#0b1a16" }}>Simulation : bureau fictif, aucune donnée réelle.</Texte>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.page}>
        {envoi.notice ? <Bandeau ton={envoi.notice.ton} texte={envoi.notice.texte} onFermer={() => envoi.setNotice(null)} /> : null}
        {ouverts.length === 0 ? (
          <Bandeau ton="attention" texte="Votre profil n'ouvre aucun module de terrain. Voyez le Responsable HSSEQ ou le bureau." />
        ) : null}
        <View style={styles.tuiles}>
          {ouverts.map((m) => {
            const teinte = modules[m.couleur][mode];
            return (
              <Pressable
                key={m.cle}
                accessibilityRole="button"
                accessibilityLabel={`${m.titre}. ${m.detail}`}
                onPress={() => router.push(m.route)}
                android_ripple={{ color: c.voile, foreground: true }}
                style={[styles.tuile, { backgroundColor: c.surface, borderColor: teinte.accent, borderLeftColor: teinte.accentPlein }]}
              >
                <Texte variante="libelle" style={{ color: teinte.accentTexte }}>{m.titre}</Texte>
                <Texte variante="service" ton="second">{m.detail}</Texte>
              </Pressable>
            );
          })}
        </View>

        <Feuille>
          <View style={styles.ligne}>
            <Texte variante="titre" style={{ flexGrow: 1, minWidth: 160 }}>File d'envoi</Texte>
            <Bouton titre="Envoyer maintenant" variante="secondaire" chargement={envoi.syncing} desactive={!envoi.online || !aEnvoyer} onPress={() => void envoi.sync("envoi")} />
          </View>
          <Texte variante="service" ton="second">
            {!envoi.online
              ? "Hors réseau : les saisies partiront seules dès que le réseau passe. Rien à refaire."
              : envoi.lastSync ? `Dernier envoi : ${quand(envoi.lastSync)}` : "Les saisies partent seules dès que le réseau passe."}
          </Texte>
          {envoi.lectureImpossible ? (
            <Bandeau ton="danger" texte="Les saisies de cet appareil ne se lisent pas. Fermez puis rouvrez l'application ; si cela recommence, prévenez le bureau avant toute nouvelle saisie." />
          ) : aEnvoyer === 0 ? (
            <Texte ton="second">Toutes vos saisies ont été transmises.</Texte>
          ) : (
            envoi.mine.map((i, n) => (
              <View key={i.client_uuid} style={[styles.saisie, n > 0 && { borderTopWidth: traits.filet, borderTopColor: c.filet }]}>
                <View style={{ flex: 1 }}>
                  <Texte variante="texteDemi">{NATURE[i.kind] ?? i.kind}</Texte>
                  <Texte variante="service" ton="second">Saisi {heure(i.created_at)}, envoi : {i.status === "error" ? "refusé" : "en attente"}</Texte>
                  {i.message ? <Texte variante="service" ton="dangerTexte">{i.message}</Texte> : null}
                </View>
                <Tampon mot={i.status === "error" ? "Refusée" : "En attente"} ton={i.status === "error" ? "danger" : "warn"} />
              </View>
            ))
          )}
        </Feuille>
      </ScrollView>
    </Ecran>
  );
}

const styles = StyleSheet.create({
  cible: { minHeight: mesures.cible, minWidth: mesures.cible, alignItems: "center", justifyContent: "center" },
  simulation: { backgroundColor: marque.or, paddingHorizontal: espaces[4], paddingVertical: 6 },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  tuiles: { flexDirection: "row", flexWrap: "wrap", gap: espaces[3] },
  tuile: {
    flexGrow: 1, flexBasis: 160, minHeight: mesures.tuile, borderRadius: rayons.tuile, borderWidth: traits.filet,
    borderLeftWidth: 6, padding: espaces[4], justifyContent: "space-between", gap: espaces[2], overflow: "hidden",
  },
  ligne: { flexDirection: "row", alignItems: "center", gap: espaces[3], flexWrap: "wrap" },
  saisie: { flexDirection: "row", alignItems: "center", gap: espaces[3], paddingVertical: espaces[3] },
});
