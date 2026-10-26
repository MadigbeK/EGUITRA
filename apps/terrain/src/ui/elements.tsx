import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { forwardRef, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type HostInstance, type StyleProp, type TextInputInstance, type TextInputProps, type TextProps, type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { signalerActivite } from "./activite";
import { espaces, marque, mesures, polices, rayons, textes, traits, type Palette } from "./terrain";
import { useTerrain } from "./useTerrain";

/** Couleurs de texte de la palette (toutes, sauf le dégradé de l'en-tête). */
export type Ton = Exclude<keyof Palette, "entete">;

const VARIANTES = {
  ...textes,
  /** Texte à lire, en semi-gras : libellés de champ, titres de ligne. */
  texteDemi: { ...textes.texte, fontFamily: polices.texteDemi },
} as const;

export type Variante = keyof typeof VARIANTES;

/** Texte du système « terrain ». Les polices ne s'héritent pas en React Native : tout texte passe par ici. */
export function Texte({ variante = "texte", ton = "encre", style, ...rest }: TextProps & { variante?: Variante; ton?: Ton }) {
  const { c } = useTerrain();
  return (
    <Text
      {...rest}
      style={[VARIANTES[variante], { color: c[ton] }, style]}
      maxFontSizeMultiplier={variante === "service" ? 1.3 : 2}
    />
  );
}

/** Retours haptiques du terrain (systeme-terrain.md, § 5) ; la vibration double le visuel, sans le remplacer. */
export const vibrer = {
  selection: () => void Haptics.selectionAsync().catch(() => undefined),
  avertissement: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  succes: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  erreur: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
};

type VarianteBouton = "principal" | "secondaire" | "danger" | "discret";

/**
 * Bouton : action principale de 64 dp en aplat de la couleur du module, les autres de 56 dp au trait.
 * Inactif, il reste lisible ; la raison se dit dans la ligne d'état.
 */
export function Bouton({
  titre, onPress, variante = "principal", chargement = false, desactive = false, fait = false, style, indice,
}: {
  titre: string;
  onPress: () => void;
  variante?: VarianteBouton;
  chargement?: boolean;
  desactive?: boolean;
  /** Confirmation d'une action réussie : aplat favorable. */
  fait?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Ce que fait le bouton, pour le lecteur d'écran, quand le titre ne suffit pas. */
  indice?: string;
}) {
  const { c } = useTerrain();
  const inactif = desactive || chargement;
  const fond = fait ? c.okPlein : desactive ? c.surface2 : variante === "principal" ? c.accentPlein : variante === "discret" ? "transparent" : c.surface;
  const encre = fait ? c.okSur : desactive ? c.second : variante === "principal" ? c.accentSur : variante === "danger" ? c.dangerTexte : variante === "discret" ? c.accentTexte : c.encre;
  const bord = variante === "secondaire" ? c.trait : variante === "danger" ? c.danger : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactif, busy: chargement }}
      accessibilityHint={indice}
      disabled={inactif}
      onPress={onPress}
      android_ripple={{ color: c.voile, foreground: true }}
      style={({ pressed }) => [
        styles.bouton,
        { minHeight: variante === "principal" ? mesures.cibleForte : mesures.cible, backgroundColor: fond },
        bord && !desactive ? { borderWidth: traits.champ, borderColor: bord } : null,
        pressed && Platform.OS !== "android" ? { opacity: 0.85, transform: [{ scale: 0.98 }] } : null,
        style,
      ]}
    >
      {chargement ? <ActivityIndicator color={encre} /> : null}
      <Text style={[textes.bouton, { color: encre }]} maxFontSizeMultiplier={1.6}>{titre}</Text>
    </Pressable>
  );
}

export type ChampProps = TextInputProps & { libelle: string; erreur?: string; aide?: string };

/** Champ de saisie : libellé au-dessus, aide ou erreur en dessous, contour de 2 dp (2,5 en erreur). */
export const Champ = forwardRef<TextInputInstance, ChampProps>(function Champ({ libelle, erreur, aide, style, ...input }, ref) {
  const { c } = useTerrain();
  const [focus, setFocus] = useState(false);
  return (
    <View style={styles.champ}>
      <Texte variante="texteDemi" ton="encre2">{libelle}</Texte>
      <TextInput
        ref={ref}
        placeholderTextColor={c.second}
        accessibilityLabel={libelle}
        accessibilityHint={erreur ?? aide}
        {...input}
        onChangeText={(t) => {
          signalerActivite();
          input.onChangeText?.(t);
        }}
        onFocus={(e) => {
          setFocus(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          input.onBlur?.(e);
        }}
        style={[
          styles.saisie,
          { borderColor: c.trait, backgroundColor: c.surface, color: c.encre },
          focus && { borderColor: c.accent, borderWidth: traits.fort },
          erreur ? { borderColor: c.danger, borderWidth: traits.fort } : null,
          input.multiline ? { minHeight: 96, textAlignVertical: "top", paddingTop: 14 } : null,
          style,
        ]}
      />
      {erreur ? <Texte variante="service" ton="dangerTexte">{erreur}</Texte> : aide ? <Texte variante="service" ton="second">{aide}</Texte> : null}
    </View>
  );
});

export interface Option {
  valeur: string;
  libelle: string;
  detail?: string;
}

/**
 * Choix dans une liste (camion, client, route…) : le champ ouvre une liste plein écran, avec une
 * recherche quand elle est longue. Lignes de 56 dp, lisibles avec des gants.
 */
export function Choix({
  libelle, valeur, options, onChange, erreur, aide, invite = "Choisir", facultatif = false,
}: {
  libelle: string;
  valeur: string;
  options: Option[];
  onChange: (valeur: string) => void;
  erreur?: string;
  aide?: string;
  invite?: string;
  /** Ajoute la ligne « Aucun » en tête de liste. */
  facultatif?: boolean;
}) {
  const { c } = useTerrain();
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState("");
  const choisi = options.find((o) => o.valeur === valeur);
  const lignes = useMemo(() => {
    const f = sansAccents(filtre.trim());
    const trouvees = f ? options.filter((o) => sansAccents(`${o.libelle} ${o.detail ?? ""}`).includes(f)) : options;
    return facultatif && !f ? [{ valeur: "", libelle: "Aucun" }, ...trouvees] : trouvees;
  }, [options, filtre, facultatif]);
  const fermer = () => {
    setOuvert(false);
    setFiltre("");
  };
  return (
    <View style={styles.champ}>
      <Texte variante="texteDemi" ton="encre2">{libelle}</Texte>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${libelle} : ${choisi ? choisi.libelle : "non renseigné"}`}
        accessibilityHint={erreur ?? "Ouvre la liste"}
        onPress={() => setOuvert(true)}
        android_ripple={{ color: c.voile, foreground: true }}
        style={[styles.saisie, styles.choix, { borderColor: erreur ? c.danger : c.trait, borderWidth: erreur ? traits.fort : traits.champ, backgroundColor: c.surface }]}
      >
        <Texte style={{ flex: 1 }} ton={choisi ? "encre" : "second"} numberOfLines={1}>
          {choisi ? choisi.libelle : invite}
        </Texte>
        <Texte ton="second" accessibilityElementsHidden importantForAccessibility="no">▾</Texte>
      </Pressable>
      {erreur ? <Texte variante="service" ton="dangerTexte">{erreur}</Texte> : aide ? <Texte variante="service" ton="second">{aide}</Texte> : null}
      <Modal visible={ouvert} animationType="fade" onRequestClose={fermer}>
        <SafeAreaView style={[styles.liste, { backgroundColor: c.surface }]}>
          <View style={styles.listeEntete}>
            <Texte variante="titre" style={{ flex: 1 }}>{libelle}</Texte>
            <Bouton titre="Fermer" variante="discret" onPress={fermer} />
          </View>
          {options.length > 8 ? (
            <TextInput
              value={filtre}
              onChangeText={(t) => {
                signalerActivite();
                setFiltre(t);
              }}
              placeholder="Rechercher"
              placeholderTextColor={c.second}
              accessibilityLabel={`Rechercher dans ${libelle}`}
              autoFocus
              style={[styles.saisie, { borderColor: c.trait, color: c.encre, marginHorizontal: espaces[4], marginBottom: espaces[2] }]}
            />
          ) : null}
          <FlatList
            data={lignes}
            keyExtractor={(o) => o.valeur || "aucun"}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Texte ton="second" style={{ padding: espaces[4] }}>Aucun résultat.</Texte>}
            renderItem={({ item }) => {
              const actif = item.valeur === valeur;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: actif }}
                  onPress={() => {
                    vibrer.selection();
                    onChange(item.valeur);
                    fermer();
                  }}
                  android_ripple={{ color: c.voile }}
                  style={[styles.ligneListe, { borderBottomColor: c.filet }, actif && { backgroundColor: c.accentDoux }]}
                >
                  <Texte variante={actif ? "texteDemi" : "texte"}>{item.libelle}</Texte>
                  {item.detail ? <Texte variante="service" ton="second">{item.detail}</Texte> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Message d'état d'une vue : réussite, avertissement ou refus, avec le mot qui le dit. */
export function Bandeau({ ton, texte, onFermer }: { ton: "ok" | "attention" | "danger"; texte: string; onFermer?: () => void }) {
  const { c } = useTerrain();
  const [fond, encre, bord] = ton === "ok" ? [c.okDoux, c.ok, c.ok] : ton === "danger" ? [c.dangerDoux, c.dangerTexte, c.danger] : [c.warnDoux, c.warn, c.warn];
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.bandeau, { backgroundColor: fond, borderLeftColor: bord }]}>
      <Text style={[VARIANTES.texteDemi, { color: encre, flex: 1 }]}>{texte}</Text>
      {onFermer ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer le message" onPress={onFermer} hitSlop={12} style={styles.croix}>
          <Text style={[textes.libelle, { color: encre }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Tampon d'état (charte) : rayon 4, le mot en toutes lettres ; plein pour ce qui demande une action. */
export function Tampon({ mot, ton }: { mot: string; ton: "danger" | "warn" | "ok" | "neutre" }) {
  const { c } = useTerrain();
  const plein = ton === "danger" || ton === "warn";
  const encre = ton === "danger" ? c.dangerTexte : ton === "warn" ? c.warn : ton === "ok" ? c.ok : c.second;
  const fond = ton === "danger" ? c.dangerDoux : ton === "warn" ? c.warnDoux : "transparent";
  return (
    <View style={[styles.tampon, { borderColor: encre, backgroundColor: plein ? fond : "transparent" }]}>
      <Text style={[textes.service, { color: encre }]} maxFontSizeMultiplier={1.3}>{mot}</Text>
    </View>
  );
}

export type EtatReseau = "en_ligne" | "faible" | "hors";

const RESEAU: Record<EtatReseau, string> = { en_ligne: "En ligne", faible: "Réseau faible", hors: "Hors réseau" };

/**
 * Pastille de l'en-tête : ce que dit le dernier échange avec le bureau, pas seulement la liaison, et le
 * nombre de saisies en attente. Or quand le réseau manque.
 */
export function PastilleReseau({ etat, enAttente = 0, envoi = false }: { etat: EtatReseau; enAttente?: number; envoi?: boolean }) {
  const manque = etat !== "en_ligne";
  return (
    <View style={[styles.pastille, { backgroundColor: manque ? marque.or : "rgba(255,255,255,0.15)" }]}>
      {envoi ? <ActivityIndicator size="small" color={manque ? "#0b1a16" : "#ffffff"} /> : !manque ? <View style={[styles.point, { backgroundColor: marque.menthe }]} /> : null}
      <Text style={[textes.service, { color: manque ? "#0b1a16" : "#ffffff" }]} maxFontSizeMultiplier={1.3}>
        {envoi ? "Envoi…" : RESEAU[etat]}
      </Text>
      {enAttente > 0 ? (
        <View style={styles.compteur}>
          <Text style={[textes.service, { color: "#ffffff" }]} maxFontSizeMultiplier={1.3}>{enAttente}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * En-tête de terrain : 64 dp, dégradé de la couleur forte du module vers la forêt, titre court et
 * sous-titre ; à droite, la pastille réseau ou les commandes de l'écran.
 */
export function EnTete({ titre, sousTitre, droite, gauche }: { titre: string; sousTitre?: string; droite?: ReactNode; gauche?: ReactNode }) {
  const { c } = useTerrain();
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[c.entete[0], c.entete[1], c.enteteFin]}
      locations={[0, 0.6, 1.4]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.entete, { paddingTop: insets.top + espaces[2] }]}
    >
      {gauche}
      <View style={{ flex: 1 }}>
        <Text style={[textes.libelle, { color: c.enteteEncre, fontFamily: polices.titre }]} numberOfLines={1} accessibilityRole="header">{titre}</Text>
        {sousTitre ? <Text style={[textes.service, { color: c.enteteEncre, opacity: 0.92 }]} numberOfLines={1}>{sousTitre}</Text> : null}
      </View>
      {droite}
    </LinearGradient>
  );
}

/**
 * Barre d'action basse : la ligne d'état (ce qui se passe, ou pourquoi l'action attend), puis une
 * action principale, deux au plus. Fond surface, filet en haut, ombre vers le haut.
 */
export function BarreAction({ etat, tonEtat = "second", children, dansLaPage = false }: { etat: string; tonEtat?: Ton; children: ReactNode; dansLaPage?: boolean }) {
  const { c } = useTerrain();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.barre,
        { backgroundColor: c.surface, borderTopColor: c.filetFort },
        dansLaPage ? { borderRadius: rayons.feuille, borderWidth: traits.filet, borderColor: c.filet, elevation: 0, shadowOpacity: 0 } : { paddingBottom: Math.max(insets.bottom, espaces[3]) },
      ]}
    >
      <Text accessibilityLiveRegion="polite" style={[textes.service, { color: c[tonEtat], minHeight: 20 }]}>{etat}</Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

/** Onglets d'une vue : libellé et nombre éventuel (« À envoyer 3 »). */
export function Segment<K extends string>({
  options, valeur, onChange,
}: {
  options: Array<{ cle: K; libelle: string; compte?: number }>;
  valeur: K;
  onChange: (cle: K) => void;
}) {
  const { c } = useTerrain();
  return (
    <View accessibilityRole="tablist" style={[styles.segment, { backgroundColor: c.surface2, borderColor: c.filet }]}>
      {options.map((o) => {
        const actif = o.cle === valeur;
        return (
          <Pressable
            key={o.cle}
            accessibilityRole="tab"
            accessibilityState={{ selected: actif }}
            accessibilityLabel={o.compte ? `${o.libelle}, ${o.compte}` : o.libelle}
            onPress={() => onChange(o.cle)}
            style={[styles.onglet, actif && { backgroundColor: c.surface, borderColor: c.accent, borderWidth: traits.champ }]}
          >
            <Text style={[VARIANTES.texteDemi, { color: actif ? c.accentTexte : c.second }]} maxFontSizeMultiplier={1.4}>{o.libelle}</Text>
            {o.compte ? (
              <View style={[styles.compteur, { backgroundColor: actif ? marque.foret : c.filetFort }]}>
                <Text style={[textes.service, { color: actif ? "#ffffff" : c.encre }]} maxFontSizeMultiplier={1.3}>{o.compte}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Feuille : surface bordée d'un filet, sans ombre. */
export function Feuille({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTerrain();
  return <View style={[styles.feuille, { backgroundColor: c.surface, borderColor: c.filet }, style]}>{children}</View>;
}

/**
 * Place faite au clavier pour un contenu qui ne commence pas en haut de l'écran (sous un en-tête et
 * un sélecteur) : KeyboardAvoidingView mesure sa position dans son parent, pas dans la fenêtre ; le
 * décalage est donc la position mesurée du conteneur dans la fenêtre. Android bord à bord : la
 * fenêtre ne rétrécit plus d'elle-même.
 */
export function ClavierEvite({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const conteneur = useRef<HostInstance>(null);
  const [decalage, setDecalage] = useState(0);
  return (
    <View ref={conteneur} style={[{ flex: 1 }, style]} onLayout={() => conteneur.current?.measureInWindow((_x, y) => setDecalage(y))}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={decalage}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Fond d'écran de la palette active. Android affiche bord à bord : en paysage, les marges latérales
 * écartent le contenu de la barre de navigation et de l'encoche.
 */
export function Ecran({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTerrain();
  const insets = useSafeAreaInsets();
  return <View style={[{ flex: 1, backgroundColor: c.fond, paddingLeft: insets.left, paddingRight: insets.right }, style]}>{children}</View>;
}

/** Confirmation avant une action qui ne se rattrape pas ; « Annuler » par défaut. */
export function demanderConfirmation(
  message: string,
  { titre = "Confirmer", action = "Confirmer", danger = false }: { titre?: string; action?: string; danger?: boolean } = {},
): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${titre}\n\n${message}`) ?? false);
  return new Promise((resolve) => {
    Alert.alert(
      titre,
      message,
      [
        { text: "Annuler", style: "cancel", onPress: () => resolve(false) },
        { text: action, style: danger ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  bouton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: espaces[2],
    paddingHorizontal: espaces[4], borderRadius: rayons.bouton, overflow: "hidden",
  },
  champ: { gap: 6 },
  saisie: {
    minHeight: mesures.cible, borderWidth: traits.champ, borderRadius: rayons.champ,
    paddingHorizontal: 14, fontFamily: polices.texte, fontSize: 17,
  },
  choix: { flexDirection: "row", alignItems: "center", gap: espaces[2] },
  liste: { flex: 1 },
  listeEntete: { flexDirection: "row", alignItems: "center", paddingHorizontal: espaces[4], paddingVertical: espaces[3], gap: espaces[3] },
  ligneListe: { minHeight: mesures.cible, justifyContent: "center", paddingHorizontal: espaces[4], paddingVertical: espaces[2], borderBottomWidth: traits.filet },
  bandeau: { flexDirection: "row", alignItems: "center", gap: espaces[3], padding: espaces[3], borderRadius: rayons.champ, borderLeftWidth: 4 },
  croix: { minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" },
  tampon: { alignSelf: "flex-start", borderRadius: rayons.tampon, borderWidth: traits.filet, paddingHorizontal: 8, paddingVertical: 2 },
  pastille: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: rayons.pastille },
  point: { width: 8, height: 8, borderRadius: 4 },
  compteur: { minWidth: 24, paddingHorizontal: 6, borderRadius: 12, alignItems: "center", backgroundColor: marque.foret },
  entete: { flexDirection: "row", alignItems: "center", gap: espaces[2], minHeight: 64, paddingHorizontal: espaces[4], paddingBottom: espaces[3] },
  barre: {
    borderTopWidth: traits.filet, paddingHorizontal: espaces[4], paddingTop: 10, gap: 10,
    shadowColor: "#0b1a16", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8,
  },
  actions: { flexDirection: "row", gap: espaces[3] },
  segment: { flexDirection: "row", borderRadius: rayons.feuille, borderWidth: traits.filet, padding: 4, gap: 4 },
  onglet: { flex: 1, minHeight: mesures.cible, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: rayons.champ },
  feuille: { borderRadius: rayons.feuille, borderWidth: traits.filet, padding: espaces[4], gap: espaces[3] },
});
