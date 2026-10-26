import { randomUUID } from "expo-crypto";
import { useKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { revenir } from "../accueil/retour";
import type { Utilisateur } from "../auth/coffre";
import { useEnvoi } from "../sync/Envoi";
import { BarreAction, Bandeau, Bouton, Champ, Choix, EnTete, Ecran, Feuille, Texte, vibrer } from "../ui/elements";
import { espaces, marque, mesures, rayons, textes, traits } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import { appareil, garderResultat } from "./appareil";
import type { NewBreathTest } from "./types";
import { useHsseq } from "./useHsseq";

const MOTIFS = ["Appareil indisponible", "Conducteur absent", "Refus du conducteur"];

/**
 * Alcootest (système « terrain », § 3.13 ; contrat HSSEQ, § 8). Le résultat et la lecture se tapent
 * sur un pavé propre à l'application, masqués, sans bouton pour les afficher ; ils restent dans le
 * coffre du téléphone jusqu'à l'envoi, jamais dans la base, puis sont effacés. L'écran est protégé
 * des captures. La confirmation dit « Alcootest fait », sans chiffre ni couleur qui le trahirait.
 */
export function Alcootest({ user }: { user: Utilisateur }) {
  return (
    <Module nom="hsseq">
      <Contenu user={user} />
    </Module>
  );
}

function Contenu({ user }: { user: Utilisateur }) {
  useKeepAwake();
  usePreventScreenCapture("alcootest");
  const router = useRouter();
  const envoi = useEnvoi();
  const { refs } = useHsseq();
  const { c } = useTerrain();
  const uuid = useRef(randomUUID());
  const conducteurSeul = user.profiles.includes("conducteur") && !user.profiles.some((p) => p === "exploitation" || p === "hsseq");
  const [conducteurId, setConducteurId] = useState("");
  const [realise, setRealise] = useState<boolean | null>(null);
  const [resultat, setResultat] = useState<"negative" | "positive" | null>(null);
  const [lecture, setLecture] = useState("");
  const [motif, setMotif] = useState("");
  const [autreMotif, setAutreMotif] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  /** Enregistré : « realise » si l'alcootest a été fait, « non_realise » sinon. */
  const [fait, setFait] = useState<"realise" | "non_realise" | null>(null);
  const [echec, setEchec] = useState(false);
  const sortie = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (sortie.current) clearTimeout(sortie.current);
  }, []);

  // Un conducteur ne saisit que pour lui-même ; le chef de parc choisit le conducteur.
  const driverId = conducteurSeul ? (refs?.me.driver_id ?? null) : conducteurId ? Number(conducteurId) : null;
  const raison = motif === "Autre" ? autreMotif.trim() : motif;
  const pret = driverId !== null && realise !== null && (realise ? resultat !== null : raison.length > 0);

  function taper(t: string) {
    vibrer.selection();
    if (t === "effacer") setLecture((l) => l.slice(0, -1));
    else if (t === "," && !lecture.includes(",")) setLecture((l) => (l ? `${l},` : "0,"));
    else if (t !== "," && lecture.replace(",", "").length < 4) setLecture((l) => l + t);
  }

  async function enregistrer() {
    if (!pret || enregistrement || fait) return;
    setEnregistrement(true);
    setEchec(false);
    const fiche: NewBreathTest & { offline: boolean } = {
      rotation_id: null,
      driver_id: driverId,
      performed: realise === true,
      ...(realise ? {} : { not_done_reason: raison }),
      offline: !envoi.online,
    };
    try {
      if (realise && resultat) {
        const mg = lecture ? Number(lecture.replace(",", ".")) : undefined;
        await garderResultat(uuid.current, { result: resultat, ...(mg !== undefined && Number.isFinite(mg) ? { reading_mg_l: mg } : {}) });
      }
      await envoi.enregistrer({ client_uuid: uuid.current, kind: "breath_test", user_id: user.id, created_at: new Date().toISOString(), status: "pending", payload: { ...fiche } });
    } catch {
      // Rien d'enregistré : le résultat ne reste pas seul au coffre.
      await appareil.effacerResultat(uuid.current).catch(() => undefined);
      setEnregistrement(false);
      setEchec(true);
      vibrer.erreur();
      return;
    }
    vibrer.succes();
    setFait(realise ? "realise" : "non_realise");
    setLecture("");
    setResultat(null);
    void envoi.sync("saisie");
    sortie.current = setTimeout(() => revenir(router), 1500);
  }

  return (
    <Ecran>
      <EnTete
        titre="Alcootest"
        sousTitre="Avant le départ"
        gauche={(
          <Pressable accessibilityRole="button" accessibilityLabel="Retour à Ma journée" onPress={() => revenir(router)} style={styles.retour}>
            <Text style={[textes.libelle, { color: c.enteteEncre }]}>‹</Text>
          </Pressable>
        )}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {refs === null ? <Bandeau ton="attention" texte="Les listes ne sont pas encore sur cet appareil. Ouvrez l'application une première fois avec du réseau." /> : null}
        {conducteurSeul ? (
          refs && refs.me.driver_id === null ? <Bandeau ton="attention" texte="Votre compte n'est relié à aucun conducteur : voyez le bureau." /> : null
        ) : (
          <Choix
            libelle="Conducteur"
            invite="Choisir le conducteur"
            valeur={conducteurId}
            options={(refs?.drivers ?? []).map((d) => ({ valeur: String(d.id), libelle: d.name }))}
            onChange={setConducteurId}
          />
        )}

        {fait === "realise" ? (
          <Feuille style={{ borderColor: c.ok, borderWidth: traits.fort }}>
            <Texte variante="titre" ton="ok">Alcootest fait</Texte>
            <Texte>Le résultat est chiffré sur le téléphone, puis envoyé au seul Responsable HSSEQ.</Texte>
          </Feuille>
        ) : fait === "non_realise" ? (
          <Feuille style={{ borderColor: c.warn, borderWidth: traits.fort }}>
            <Texte variante="titre" ton="warn">Alcootest non réalisé, enregistré</Texte>
            <Texte>Le départ reste bloqué (V03) tant qu'un alcootest réalisé et négatif n'est pas enregistré.</Texte>
          </Feuille>
        ) : (
          <>
            <Feuille>
              <Texte variante="libelle">L'alcootest a-t-il été réalisé ?</Texte>
              <View style={styles.deux}>
                <Choisir titre="Oui" actif={realise === true} onPress={() => setRealise(true)} />
                <Choisir titre="Non" actif={realise === false} onPress={() => { setRealise(false); setResultat(null); setLecture(""); }} />
              </View>
            </Feuille>

            {realise ? (
              <Feuille>
                <Texte variante="libelle">Résultat lu sur l'appareil</Texte>
                {/* Mêmes boutons, même couleur : rien à l'écran ne trahit le résultat choisi. */}
                <View style={styles.deux}>
                  <Choisir titre="Négatif" actif={resultat === "negative"} masque onPress={() => setResultat("negative")} />
                  <Choisir titre="Positif" actif={resultat === "positive"} masque onPress={() => setResultat("positive")} />
                </View>
                <Texte variante="texteDemi" ton="encre2">Lecture en mg/l, facultative</Texte>
                <View style={[styles.cases, { borderColor: marque.or }]} accessibilityLabel={`${lecture.length} caractères saisis, masqués`}>
                  <Text style={[textes.chiffre, { color: c.encre, letterSpacing: 8 }]}>{lecture ? "•".repeat(lecture.length) : " "}</Text>
                </View>
                <Texte variante="service" ton="second">Le chiffre reste masqué. Il est chiffré sur le téléphone, puis envoyé au seul Responsable HSSEQ.</Texte>
                <View style={styles.pave}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "effacer"].map((t) => (
                    <Pressable
                      key={t}
                      accessibilityRole="button"
                      accessibilityLabel={t === "effacer" ? "Effacer" : t === "," ? "Virgule" : `Chiffre ${t}`}
                      onPress={() => taper(t)}
                      android_ripple={{ color: c.voile }}
                      style={[styles.touche, { borderColor: c.trait, backgroundColor: c.surface }]}
                    >
                      <Text style={[textes.libelle, { color: c.encre }]}>{t === "effacer" ? "Effacer" : t}</Text>
                    </Pressable>
                  ))}
                </View>
              </Feuille>
            ) : null}

            {realise === false ? (
              <Feuille>
                <Texte variante="libelle">Pourquoi n'a-t-il pas été réalisé ?</Texte>
                <View style={styles.puces}>
                  {[...MOTIFS, "Autre"].map((m) => (
                    <Choisir key={m} titre={m} actif={motif === m} onPress={() => setMotif(m)} />
                  ))}
                </View>
                {motif === "Autre" ? <Champ libelle="Motif" value={autreMotif} onChangeText={setAutreMotif} /> : null}
                <Texte variante="service" ton="second">Sans alcootest réalisé et négatif, le départ reste bloqué (V03).</Texte>
              </Feuille>
            ) : null}
          </>
        )}
      </ScrollView>
      <BarreAction
        etat={fait === "realise" ? "Alcootest enregistré." : fait === "non_realise" ? "Non réalisé, enregistré : le départ reste bloqué (V03)."
          : echec ? "Enregistrement impossible sur cet appareil : réessayez. Si cela recommence, prévenez le bureau."
            : !pret ? "Répondez aux questions pour enregistrer." : !envoi.online ? "Hors réseau : l'alcootest partira seul dès que le réseau passe." : "Prêt à enregistrer."}
        tonEtat={fait === "realise" ? "ok" : fait === "non_realise" ? "warn" : echec ? "dangerTexte" : "second"}
      >
        <Bouton
          style={{ flex: 1 }}
          titre={fait === "realise" ? "Alcootest fait" : fait === "non_realise" ? "Enregistré" : "Enregistrer l'alcootest"}
          fait={fait !== null}
          desactive={!pret && !fait}
          chargement={enregistrement && !fait}
          onPress={() => void enregistrer()}
        />
      </BarreAction>
      </KeyboardAvoidingView>
    </Ecran>
  );
}

/** Choix d'une réponse : 56 dp, au trait ; `masque` : choisi, il garde la même couleur neutre. */
function Choisir({ titre, actif, onPress, masque = false }: { titre: string; actif: boolean; onPress: () => void; masque?: boolean }) {
  const { c } = useTerrain();
  const fond = actif ? (masque ? c.encre2 : c.accentPlein) : c.surface;
  const encre = actif ? (masque ? c.surface : c.accentSur) : c.encre;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: actif }}
      accessibilityLabel={titre}
      onPress={() => {
        vibrer.selection();
        onPress();
      }}
      style={[styles.choix, { borderColor: actif ? fond : c.trait, backgroundColor: fond }]}
    >
      <Text style={[textes.bouton, { color: encre }]}>{titre}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  retour: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center" },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  deux: { flexDirection: "row", gap: espaces[3] },
  puces: { flexDirection: "row", flexWrap: "wrap", gap: espaces[3] },
  choix: { flexGrow: 1, minHeight: mesures.cible, paddingHorizontal: espaces[4], borderRadius: rayons.bouton, borderWidth: traits.champ, alignItems: "center", justifyContent: "center" },
  cases: { minHeight: 64, borderWidth: traits.fort, borderRadius: rayons.champ, alignItems: "center", justifyContent: "center" },
  pave: { flexDirection: "row", flexWrap: "wrap", gap: espaces[2] },
  touche: { flexBasis: "30%", flexGrow: 1, minHeight: mesures.cibleForte, borderRadius: rayons.bouton, borderWidth: traits.champ, alignItems: "center", justifyContent: "center" },
});
