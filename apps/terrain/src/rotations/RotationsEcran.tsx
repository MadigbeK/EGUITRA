import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { ApiError } from "../api/errors";
import type { Utilisateur } from "../auth/coffre";
import { useSession } from "../auth/session";
import { ENVIRONNEMENT } from "../config";
import { enSimulation } from "../serveur";
import { pluriel } from "../format";
import { Bandeau, EnTete, Ecran, PastilleReseau, Segment, Texte, demanderConfirmation, type EtatReseau } from "../ui/elements";
import { espaces, LARGEUR_TABLETTE, marque, mesures, traits } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import { blank, fromPayload, type Form } from "./form";
import { ListeAttente, ListeEnvoyees } from "./Listes";
import { Saisie } from "./Saisie";
import { useRotations } from "./useRotations";

type Vue = "saisie" | "attente" | "envoyees";

/**
 * Rotations : saisie au parc, saisies en attente, rotations envoyées. Au téléphone, une vue à la
 * fois sous des onglets ; sur tablette ou en paysage, la saisie à gauche et les listes à droite.
 * Couleur du module : latérite.
 */
export function RotationsEcran({ user, onRetour }: { user: Utilisateur; onRetour?: () => void }) {
  return (
    <Module nom="rotations">
      <Contenu user={user} onRetour={onRetour} />
    </Module>
  );
}

function Contenu({ user, onRetour }: { user: Utilisateur; onRetour?: () => void }) {
  const { api, store, seDeconnecter } = useSession();
  const { c } = useTerrain();
  const rot = useRotations(store, api, user.id);
  const [vue, setVue] = useState<Vue>("saisie");
  const [form, setForm] = useState<Form>(() => blank());
  const { width } = useWindowDimensions();
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
      if (e instanceof ApiError) {
        rot.setNotice({ ton: "attention", texte: e.message });
        return;
      }
      // Changement d'équipe sans réseau : la session est oubliée sur l'appareil tout de suite, et
      // fermée au bureau au premier échange réussi. Personne ne travaille sous le nom du précédent.
      const confirmee = await demanderConfirmation(
        "Hors réseau : la session sera fermée au bureau dès le retour du réseau. Sur cet appareil, elle l'est tout de suite.",
        { titre: "Se déconnecter sans réseau ?", action: "Se déconnecter" },
      );
      if (confirmee) await seDeconnecter({ horsReseau: true }).catch(() => undefined);
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
    <Ecran>
      <EnTete
        titre="Rotations"
        sousTitre={`${user.name}${ENVIRONNEMENT ? `, ${ENVIRONNEMENT}` : ""}`}
        gauche={onRetour ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Retour à Ma journée" onPress={onRetour} style={styles.cible}>
            <Texte variante="libelle" style={{ color: c.enteteEncre }}>‹</Texte>
          </Pressable>
        ) : undefined}
        droite={(
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${aEnvoyer ? pluriel(aEnvoyer, "saisie à envoyer", "saisies à envoyer") : "Rien à envoyer"}. Ouvrir « À envoyer ».`}
              onPress={() => setVue("attente")}
              style={styles.cible}
            >
              <PastilleReseau etat={etatReseau} enAttente={aEnvoyer} envoi={rot.syncing} />
            </Pressable>
            {!onRetour ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" onPress={() => void quitter()} style={styles.cible}>
                <Texte variante="service" style={{ color: c.enteteEncre }}>Quitter</Texte>
              </Pressable>
            ) : null}
          </>
        )}
      />
      {enSimulation() ? (
        <View style={styles.simulation}>
          <Texte variante="service" style={{ color: "#0b1a16" }}>Démonstration : bureau simulé, aucune donnée réelle.</Texte>
        </View>
      ) : null}

      {tablette ? (
        <View style={styles.colonnes}>
          <View style={[styles.colonne, { flex: 1.15, borderRightWidth: traits.filet, borderRightColor: c.filetFort }]}>
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
    </Ecran>
  );
}

function Avis({ rot }: { rot: ReturnType<typeof useRotations> }) {
  const n = rot.notice;
  if (!n) return null;
  return (
    <View style={{ paddingHorizontal: espaces[4], paddingTop: espaces[3] }}>
      <Bandeau ton={n.ton} texte={n.texte} onFermer={() => rot.setNotice(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  cible: { minHeight: mesures.cible, minWidth: mesures.cible, alignItems: "center", justifyContent: "center" },
  simulation: { backgroundColor: marque.or, paddingHorizontal: espaces[4], paddingVertical: 6 },
  colonnes: { flex: 1, flexDirection: "row" },
  colonne: { flex: 1 },
  onglets: { paddingHorizontal: espaces[4], paddingTop: espaces[3] },
});
