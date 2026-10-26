import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Bouton, Texte, vibrer } from "../ui/elements";
import { espaces, LARGEUR_TABLETTE, marque, mesures, rayons, textes, traits } from "../ui/terrain";
import { codeAppareil } from "./codeAppareil";
import { codeValide, LONGUEUR_MAX, LONGUEUR_MIN } from "./codePersonnel";
import type { Utilisateur } from "./coffre";
import { useSession } from "./session";

/** Au téléphone, le code est redemandé après 5 minutes hors de l'application. */
const REVEIL = 5 * 60_000;
/** À la tablette du dépôt, verrouillage après 2 minutes sans geste, préavis de 20 secondes. */
const INACTIVITE = 2 * 60_000;
const PREAVIS = 20_000;

type Etat = "chargement" | "a_definir" | "ouvert" | "verrouille";

/**
 * Verrou de l'application par le code personnel (système « terrain », § 3.11). Une session reprise
 * au démarrage s'ouvre verrouillée ; un code ne se choisit que juste après une connexion avec
 * identifiant et double authentification, jamais sur une session reprise (elle est alors oubliée, il
 * faut se reconnecter). Le contenu reste monté dessous : au téléphone, la saisie en cours se retrouve
 * après le code ; l'écran du code est une fenêtre au-dessus de toutes les autres. Cinq erreurs : la
 * session est oubliée sur l'appareil et sa fermeture part au bureau au premier échange réussi.
 */
export function Verrou({ user, fraiche, children }: { user: Utilisateur; fraiche: boolean; children: ReactNode }) {
  const { seDeconnecter } = useSession();
  const { width } = useWindowDimensions();
  const tablette = width >= LARGEUR_TABLETTE;
  const [etat, setEtat] = useState<Etat>("chargement");
  const [preavis, setPreavis] = useState(false);
  const quitte = useRef<number | null>(null);
  const dernierGeste = useRef(Date.now());

  // Fraîcheur de la connexion au montage : elle décide de l'état de départ, une fois. La session
  // change d'identité à chaque étape (profil confirmé par le bureau) : l'état de départ n'est pas
  // recalculé pour autant, sinon un utilisateur déjà déverrouillé serait reverrouillé.
  const connexionFraiche = useRef(fraiche);
  const deconnecter = useRef(seDeconnecter);
  deconnecter.current = seDeconnecter;
  useEffect(() => {
    let actif = true;
    void codeAppareil.existe(user.id).then((oui) => {
      if (!actif) return;
      if (oui) setEtat(connexionFraiche.current ? "ouvert" : "verrouille");
      else if (connexionFraiche.current) setEtat("a_definir");
      // Session reprise sans code (installation précédente, application fermée avant le choix du code) :
      // personne ne peut en choisir un sans s'être reconnecté.
      else void deconnecter.current({ horsReseau: true });
    }).catch(() => actif && setEtat("verrouille"));
    return () => {
      actif = false;
    };
  }, [user.id]);

  // Réveil de l'application.
  useEffect(() => {
    const abonnement = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") quitte.current ??= Date.now();
      if (s === "active") {
        const absent = quitte.current !== null ? Date.now() - quitte.current : 0;
        quitte.current = null;
        if (absent >= (tablette ? INACTIVITE : REVEIL)) setEtat((e) => (e === "ouvert" ? "verrouille" : e));
      }
    });
    return () => abonnement.remove();
  }, [tablette]);

  // Tablette : verrouillage après 2 minutes sans geste.
  useEffect(() => {
    if (!tablette || etat !== "ouvert") return;
    const minuteur = setInterval(() => {
      const calme = Date.now() - dernierGeste.current;
      setPreavis(calme >= INACTIVITE - PREAVIS && calme < INACTIVITE);
      if (calme >= INACTIVITE) {
        setPreavis(false);
        setEtat("verrouille");
      }
    }, 1_000);
    return () => clearInterval(minuteur);
  }, [tablette, etat]);

  const geste = useCallback(() => {
    dernierGeste.current = Date.now();
    if (preavis) setPreavis(false);
    return false;
  }, [preavis]);

  const echec = useCallback(async () => {
    await codeAppareil.effacer(user.id);
    await seDeconnecter({ horsReseau: true }).catch(() => undefined);
  }, [seDeconnecter, user.id]);

  if (etat === "chargement") return <View style={{ flex: 1, backgroundColor: marque.foret }} />;
  if (etat === "a_definir") return <DefinirCode user={user} onDefini={() => { dernierGeste.current = Date.now(); setEtat("ouvert"); }} />;

  return (
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={geste} onMoveShouldSetResponderCapture={geste}>
      {children}
      {preavis ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Rester connecté" onPress={geste} style={styles.preavis}>
          <Text style={[textes.libelle, { color: "#0b1a16", textAlign: "center" }]}>La tablette se verrouille dans 20 s. Touchez pour rester.</Text>
        </Pressable>
      ) : null}
      <Modal visible={etat === "verrouille"} animationType="none" statusBarTranslucent onRequestClose={() => undefined}>
        <SaisieCode
            titre={`${user.name}, votre code personnel`}
            aide="Pour reprendre là où vous en étiez."
            onCode={async (code) => {
              const r = await codeAppareil.verifier(user.id, code);
              if (r.ok) {
                dernierGeste.current = Date.now();
                setEtat("ouvert");
                return null;
              }
              if (r.restants === 0) {
                await echec();
                return "Cinq erreurs : reconnectez-vous avec votre identifiant.";
              }
              return `Code incorrect : encore ${r.restants} essai${r.restants > 1 ? "s" : ""}.`;
            }}
            secondaire={{ titre: "Changer d'utilisateur", action: () => void seDeconnecter().catch(() => seDeconnecter({ horsReseau: true })) }}
          />
      </Modal>
    </View>
  );
}

/** Premier usage sur l'appareil : le code se choisit deux fois. */
function DefinirCode({ user, onDefini }: { user: Utilisateur; onDefini: () => void }) {
  const [premier, setPremier] = useState<string | null>(null);
  return (
    <SaisieCode
      key={premier ? "confirmer" : "choisir"}
      titre={premier ? "Tapez-le une seconde fois" : "Choisissez votre code personnel"}
      aide={premier ? "Pour être sûr de ne pas vous tromper." : `De ${LONGUEUR_MIN} à ${LONGUEUR_MAX} chiffres, ni répétés ni suivis. Il vous sera demandé au réveil de l'application.`}
      onCode={async (code) => {
        if (!premier) {
          if (!codeValide(code)) return "Code trop simple : ni 0000, ni 1234. Choisissez-en un autre.";
          setPremier(code);
          return null;
        }
        if (code !== premier) {
          setPremier(null);
          return "Les deux codes diffèrent : recommencez.";
        }
        await codeAppareil.definir(user.id, code);
        onDefini();
        return null;
      }}
    />
  );
}

/**
 * Saisie d'un code : pavé de l'application (64 dp), sans clavier système, cases du compteur au liseré
 * or, chiffres masqués. `onCode` rend un message d'erreur, ou null.
 */
function SaisieCode({
  titre, aide, onCode, secondaire,
}: {
  titre: string;
  aide: string;
  onCode: (code: string) => Promise<string | null>;
  secondaire?: { titre: string; action: () => void };
}) {
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [travail, setTravail] = useState(false);

  async function valider() {
    if (code.length < LONGUEUR_MIN || travail) return;
    setTravail(true);
    const message = await onCode(code).catch(() => "Vérification impossible : réessayez.");
    setTravail(false);
    setCode("");
    setErreur(message);
    if (message) vibrer.erreur();
    else vibrer.succes();
  }

  function taper(t: string) {
    vibrer.selection();
    setErreur(null);
    if (t === "effacer") setCode((c) => c.slice(0, -1));
    else if (code.length < LONGUEUR_MAX) setCode((c) => c + t);
  }

  return (
    <SafeAreaView style={styles.racine}>
      <View style={styles.haut}>
        <Texte variante="titre" style={{ color: "#ffffff", textAlign: "center" }}>{titre}</Texte>
        <Texte style={{ color: marque.menthe, textAlign: "center" }}>{aide}</Texte>
        <View style={styles.cases} accessibilityLabel={`${code.length} chiffres saisis`}>
          {Array.from({ length: LONGUEUR_MAX }, (_, i) => (
            <View key={i} style={[styles.case, { borderColor: marque.or, backgroundColor: i < code.length ? marque.or : "transparent" }]} />
          ))}
        </View>
        {erreur ? <Text accessibilityLiveRegion="assertive" style={[textes.texte, { color: marque.or, textAlign: "center" }]}>{erreur}</Text> : null}
      </View>
      <View style={styles.pave}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "effacer", "0", "valider"].map((t) => (
          <Pressable
            key={t}
            accessibilityRole="button"
            accessibilityLabel={t === "effacer" ? "Effacer" : t === "valider" ? "Valider le code" : `Chiffre ${t}`}
            disabled={t === "valider" && (code.length < LONGUEUR_MIN || travail)}
            onPress={() => (t === "valider" ? void valider() : taper(t))}
            style={({ pressed }) => [styles.touche, t === "valider" && { backgroundColor: marque.menthe }, pressed && { opacity: 0.8 }]}
          >
            <Text style={[textes.libelle, { color: t === "valider" ? "#0b1a16" : "#ffffff" }]}>{t === "effacer" ? "Effacer" : t === "valider" ? "Valider" : t}</Text>
          </Pressable>
        ))}
      </View>
      {secondaire ? <Bouton titre={secondaire.titre} variante="secondaire" onPress={secondaire.action} style={{ marginBottom: espaces[4], alignSelf: "center", minWidth: 260 }} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, backgroundColor: marque.foret, justifyContent: "space-between", padding: espaces[4] },
  haut: { gap: espaces[3], alignItems: "center", paddingTop: espaces[8] },
  cases: { flexDirection: "row", gap: espaces[3], marginTop: espaces[4] },
  case: { width: 20, height: 20, borderRadius: rayons.tampon, borderWidth: traits.champ },
  pave: { flexDirection: "row", flexWrap: "wrap", gap: espaces[3], maxWidth: 420, width: "100%", alignSelf: "center" },
  touche: {
    flexBasis: "30%", flexGrow: 1, minHeight: mesures.cibleForte, borderRadius: rayons.bouton, alignItems: "center", justifyContent: "center",
    borderWidth: traits.champ, borderColor: "rgba(255,255,255,0.35)",
  },
  preavis: { position: "absolute", left: espaces[4], right: espaces[4], bottom: espaces[8], backgroundColor: marque.or, borderRadius: rayons.feuille, padding: espaces[4] },
});
