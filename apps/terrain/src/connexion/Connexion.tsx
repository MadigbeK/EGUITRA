import * as Linking from "expo-linking";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, DelaiDepasse } from "../api/errors";
import { useSession } from "../auth/session";
import { ENVIRONNEMENT, SIMULATION } from "../config";
import { Bandeau, Bouton, Champ, Feuille, Texte } from "../ui/elements";
import { couleurs, espaces } from "../ui/theme";

/** Message d'un échec de connexion : celui du bureau, ou ce que dit le réseau. */
function messageConnexion(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof DelaiDepasse) return "Réseau faible : le bureau n'a pas répondu à temps. Réessayez.";
  return "Pas de réseau : la connexion en demande. Vos saisies en attente restent sur l'appareil.";
}

/**
 * Connexion à l'application : identifiant et mot de passe, puis code de double authentification
 * (ou son activation au premier usage), puis remplacement d'un mot de passe provisoire.
 */
export function Connexion() {
  const session = useSession();
  const { etape } = session;
  const insets = useSafeAreaInsets();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function agir(action: () => Promise<void>) {
    if (envoi) return;
    setErreur(null);
    setEnvoi(true);
    try {
      await action();
    } catch (e) {
      setErreur(messageConnexion(e));
    } finally {
      setEnvoi(false);
    }
  }

  const message = etape.nom === "connexion" ? etape.message : undefined;

  return (
    <KeyboardAvoidingView style={styles.racine} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + espaces.xxl }]} keyboardShouldPersistTaps="handled">
        <View style={styles.marque}>
          <Texte variante="grandTitre" style={{ color: couleurs.creme }}>NIMOVA</Texte>
          <Texte variante="fort" style={{ color: couleurs.menthe }}>Terrain{ENVIRONNEMENT ? `, ${ENVIRONNEMENT}` : ""}</Texte>
        </View>
        <Feuille style={styles.carte}>
          {SIMULATION ? <Bandeau ton="attention" texte="Simulation : bureau fictif. Tout identifiant ouvre la session, mot de passe « faux » refusé." /> : null}
          {message ? <Bandeau ton="attention" texte={message} /> : null}
          {erreur ? <Bandeau ton="danger" texte={erreur} /> : null}
          {etape.nom === "connexion" ? <Identifiants envoi={envoi} onValider={(l, p) => void agir(() => session.seConnecter(l, p))} /> : null}
          {etape.nom === "code" ? (
            <CodeSaisi
              titre="Code de vérification"
              aide="Le code à 6 chiffres de votre application d'authentification."
              envoi={envoi}
              onValider={(c) => void agir(() => session.validerCode(c))}
              onRetour={session.recommencer}
            />
          ) : null}
          {etape.nom === "activation" ? (
            <>
              <Texte variante="titre">Activer la double authentification</Texte>
              <Texte>Ajoutez ce compte dans votre application d'authentification, puis tapez le code qu'elle affiche.</Texte>
              <Bouton titre="Ouvrir l'application d'authentification" variante="secondaire" onPress={() => void Linking.openURL(etape.uri).catch(() => setErreur("Aucune application d'authentification sur cet appareil : saisissez la clé à la main."))} />
              <Texte variante="libelle" ton="encre2">Clé à saisir à la main</Texte>
              <Texte variante="chiffre" selectable style={{ fontSize: 18, letterSpacing: 1 }}>{etape.secret}</Texte>
              <CodeSaisi titre="Code affiché" envoi={envoi} onValider={(c) => void agir(() => session.activer(c))} onRetour={session.recommencer} />
            </>
          ) : null}
          {etape.nom === "mot_de_passe" ? (
            <NouveauMotDePasse envoi={envoi} onValider={(a, n) => void agir(() => session.changerMotDePasse(a, n))} />
          ) : null}
        </Feuille>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Identifiants({ envoi, onValider }: { envoi: boolean; onValider: (login: string, password: string) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const motDePasse = useRef<TextInputInstance>(null);
  const valider = () => login.trim() && password && onValider(login, password);
  return (
    <>
      <Texte variante="titre">Connexion</Texte>
      <Champ
        libelle="Identifiant"
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => motDePasse.current?.focus()}
      />
      <Champ
        ref={motDePasse}
        libelle="Mot de passe"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={valider}
      />
      <Bouton titre="Se connecter" chargement={envoi} desactive={!login.trim() || !password} onPress={valider} />
    </>
  );
}

function CodeSaisi({
  titre, aide, envoi, onValider, onRetour,
}: {
  titre: string;
  aide?: string;
  envoi: boolean;
  onValider: (code: string) => void;
  onRetour: () => void;
}) {
  const [code, setCode] = useState("");
  const pret = /^\d{6}$/.test(code.replace(/\s/g, ""));
  const valider = () => pret && onValider(code.replace(/\s/g, ""));
  return (
    <>
      <Champ
        libelle={titre}
        aide={aide}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={7}
        autoFocus
        onSubmitEditing={valider}
        style={{ fontSize: 26, letterSpacing: 6 }}
      />
      <Bouton titre="Valider" chargement={envoi} desactive={!pret} onPress={valider} />
      <Bouton titre="Revenir à l'identifiant" variante="discret" onPress={onRetour} />
    </>
  );
}

function NouveauMotDePasse({ envoi, onValider }: { envoi: boolean; onValider: (ancien: string, nouveau: string) => void }) {
  const [ancien, setAncien] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const different = confirmation.length > 0 && confirmation !== nouveau;
  const pret = ancien && nouveau && nouveau === confirmation;
  return (
    <>
      <Texte variante="titre">Nouveau mot de passe</Texte>
      <Texte>Votre mot de passe provisoire doit être remplacé avant de commencer.</Texte>
      <Champ libelle="Mot de passe provisoire" value={ancien} onChangeText={setAncien} secureTextEntry autoComplete="current-password" />
      <Champ libelle="Nouveau mot de passe" value={nouveau} onChangeText={setNouveau} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Champ
        libelle="Nouveau mot de passe, encore"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoComplete="new-password"
        erreur={different ? "Les deux saisies diffèrent" : undefined}
      />
      <Bouton titre="Remplacer le mot de passe" chargement={envoi} desactive={!pret} onPress={() => pret && onValider(ancien, nouveau)} />
    </>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, backgroundColor: couleurs.foret },
  page: { flexGrow: 1, padding: espaces.l, gap: espaces.xl, alignItems: "center" },
  marque: { alignSelf: "center", maxWidth: 480, width: "100%", alignItems: "flex-start", gap: 2 },
  carte: { alignSelf: "center", maxWidth: 480, width: "100%" },
});
