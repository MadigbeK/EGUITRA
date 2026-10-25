import { forwardRef, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputInstance, type TextInputProps, type TextProps, type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cible, couleurs, espaces, polices, rayons, tailles } from "./theme";

type Ton = keyof typeof couleurs;
type Variante = "grandTitre" | "titre" | "corps" | "fort" | "libelle" | "aide" | "chiffre";

const VARIANTES: Record<Variante, { fontFamily: string; fontSize: number; lineHeight: number }> = {
  grandTitre: { fontFamily: polices.titre, fontSize: tailles.grandTitre, lineHeight: 34 },
  titre: { fontFamily: polices.titre, fontSize: tailles.titre, lineHeight: 28 },
  corps: { fontFamily: polices.texte, fontSize: tailles.corps, lineHeight: 22 },
  fort: { fontFamily: polices.texteGras, fontSize: tailles.corps, lineHeight: 22 },
  libelle: { fontFamily: polices.texteGras, fontSize: tailles.aide, lineHeight: 20 },
  aide: { fontFamily: polices.texte, fontSize: tailles.aide, lineHeight: 20 },
  chiffre: { fontFamily: polices.chiffre, fontSize: tailles.titre, lineHeight: 28 },
};

/** Texte de la charte. Les polices ne s'héritent pas en React Native : tout texte passe par ici. */
export function Texte({ variante = "corps", ton = "encre", style, ...rest }: TextProps & { variante?: Variante; ton?: Ton }) {
  return <Text {...rest} style={[VARIANTES[variante], { color: couleurs[ton] }, style]} maxFontSizeMultiplier={1.6} />;
}

type VarianteBouton = "principal" | "secondaire" | "danger" | "discret";

const FOND: Record<VarianteBouton, [string, string]> = {
  principal: [couleurs.accent, couleurs.accentFort],
  secondaire: [couleurs.panneau, couleurs.panneau2],
  danger: [couleurs.panneau, couleurs.dangerDoux],
  discret: ["transparent", couleurs.panneau2],
};

/** Bouton : 56 dp de haut pour l'action principale, 48 dp sinon. */
export function Bouton({
  titre, onPress, variante = "principal", chargement = false, desactive = false, style, indice,
}: {
  titre: string;
  onPress: () => void;
  variante?: VarianteBouton;
  chargement?: boolean;
  desactive?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Ce que fait le bouton, pour le lecteur d'écran, quand le titre ne suffit pas. */
  indice?: string;
}) {
  const inactif = desactive || chargement;
  const encre = variante === "principal" ? couleurs.surAccent : variante === "danger" ? couleurs.danger : couleurs.accentFort;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactif, busy: chargement }}
      accessibilityHint={indice}
      disabled={inactif}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bouton,
        { minHeight: variante === "principal" ? cible.action : cible.min, backgroundColor: FOND[variante][pressed ? 1 : 0] },
        variante === "secondaire" && styles.boutonBord,
        variante === "danger" && { borderColor: couleurs.danger, borderWidth: 1.5 },
        inactif && !chargement && styles.inactif,
        style,
      ]}
    >
      {chargement ? <ActivityIndicator color={encre} /> : null}
      <Texte variante="fort" style={{ color: encre, fontSize: variante === "principal" ? 17 : 16 }}>{titre}</Texte>
    </Pressable>
  );
}

export type ChampProps = TextInputProps & { libelle: string; erreur?: string; aide?: string };

/** Champ de saisie : libellé au-dessus, aide ou erreur en dessous, filet de 1,5 px (2 px en erreur). */
export const Champ = forwardRef<TextInputInstance, ChampProps>(function Champ({ libelle, erreur, aide, style, ...input }, ref) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={styles.champ}>
      <Texte variante="libelle" ton="encre2" nativeID={input.nativeID ? `${input.nativeID}-libelle` : undefined}>{libelle}</Texte>
      <TextInput
        ref={ref}
        placeholderTextColor={couleurs.discret}
        accessibilityLabel={libelle}
        accessibilityHint={erreur ?? aide}
        {...input}
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
          focus && { borderColor: couleurs.accent, borderWidth: 2 },
          erreur ? { borderColor: couleurs.danger, borderWidth: 2 } : null,
          input.multiline ? { minHeight: 88, textAlignVertical: "top", paddingTop: 12 } : null,
          style,
        ]}
      />
      {erreur ? <Texte variante="aide" ton="danger">{erreur}</Texte> : aide ? <Texte variante="aide" ton="discret">{aide}</Texte> : null}
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
      <Texte variante="libelle" ton="encre2">{libelle}</Texte>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${libelle} : ${choisi ? choisi.libelle : "non renseigné"}`}
        accessibilityHint={erreur ?? "Ouvre la liste"}
        onPress={() => setOuvert(true)}
        style={({ pressed }) => [styles.saisie, styles.choix, pressed && { backgroundColor: couleurs.panneau2 }, erreur ? { borderColor: couleurs.danger, borderWidth: 2 } : null]}
      >
        <Texte style={{ flex: 1, fontSize: tailles.champ }} ton={choisi ? "encre" : "discret"} numberOfLines={1}>
          {choisi ? choisi.libelle : invite}
        </Texte>
        <Texte ton="discret" accessibilityElementsHidden importantForAccessibility="no">▾</Texte>
      </Pressable>
      {erreur ? <Texte variante="aide" ton="danger">{erreur}</Texte> : aide ? <Texte variante="aide" ton="discret">{aide}</Texte> : null}
      <Modal visible={ouvert} animationType="slide" onRequestClose={fermer}>
        <SafeAreaView style={styles.liste}>
          <View style={styles.listeEntete}>
            <Texte variante="titre" style={{ flex: 1 }}>{libelle}</Texte>
            <Bouton titre="Fermer" variante="discret" onPress={fermer} />
          </View>
          {options.length > 8 ? (
            <TextInput
              value={filtre}
              onChangeText={setFiltre}
              placeholder="Rechercher"
              placeholderTextColor={couleurs.discret}
              accessibilityLabel={`Rechercher dans ${libelle}`}
              autoFocus
              style={[styles.saisie, { marginHorizontal: espaces.l, marginBottom: espaces.s }]}
            />
          ) : null}
          <FlatList
            data={lignes}
            keyExtractor={(o) => o.valeur || "aucun"}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Texte ton="discret" style={{ padding: espaces.l }}>Aucun résultat.</Texte>}
            renderItem={({ item }) => {
              const actif = item.valeur === valeur;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: actif }}
                  onPress={() => {
                    onChange(item.valeur);
                    fermer();
                  }}
                  style={({ pressed }) => [styles.ligneListe, actif && { backgroundColor: couleurs.accentDoux }, pressed && { backgroundColor: couleurs.panneau2 }]}
                >
                  <Texte variante={actif ? "fort" : "corps"} style={{ fontSize: tailles.champ }}>{item.libelle}</Texte>
                  {item.detail ? <Texte variante="aide" ton="discret">{item.detail}</Texte> : null}
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

const BANDEAU: Record<"ok" | "attention" | "danger", [Ton, Ton]> = {
  ok: ["okDoux", "okTexte"],
  attention: ["attentionDoux", "attention"],
  danger: ["dangerDoux", "danger"],
};

/** Message d'état en haut d'une vue : réussite, avertissement ou refus. */
export function Bandeau({ ton, texte, onFermer }: { ton: "ok" | "attention" | "danger"; texte: string; onFermer?: () => void }) {
  const [fond, encre] = BANDEAU[ton];
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.bandeau, { backgroundColor: couleurs[fond], borderLeftColor: couleurs[encre] }]}>
      <Texte variante="fort" ton={encre} style={{ flex: 1 }}>{texte}</Texte>
      {onFermer ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer le message" onPress={onFermer} hitSlop={12} style={styles.croix}>
          <Texte ton={encre} variante="fort">×</Texte>
        </Pressable>
      ) : null}
    </View>
  );
}

export type EtatReseau = "en_ligne" | "faible" | "hors";

const RESEAU: Record<EtatReseau, { texte: string; point: string }> = {
  en_ligne: { texte: "En ligne", point: couleurs.menthe },
  faible: { texte: "Réseau faible", point: couleurs.attentionVif },
  hors: { texte: "Hors réseau", point: "#f28b82" },
};

/** Pastille de l'en-tête : ce que dit le dernier échange avec le bureau, pas seulement la liaison. */
export function PastilleReseau({ etat }: { etat: EtatReseau }) {
  const r = RESEAU[etat];
  return (
    <View style={styles.pastille} accessibilityLabel={`État du réseau : ${r.texte}`}>
      <View style={[styles.point, { backgroundColor: r.point }]} />
      <Texte variante="libelle" style={{ color: couleurs.creme }}>{r.texte}</Texte>
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
  return (
    <View accessibilityRole="tablist" style={styles.segment}>
      {options.map((o) => {
        const actif = o.cle === valeur;
        return (
          <Pressable
            key={o.cle}
            accessibilityRole="tab"
            accessibilityState={{ selected: actif }}
            accessibilityLabel={o.compte ? `${o.libelle}, ${o.compte}` : o.libelle}
            onPress={() => onChange(o.cle)}
            style={[styles.onglet, actif && styles.ongletActif]}
          >
            <Texte variante="fort" ton={actif ? "foret" : "discret"}>{o.libelle}</Texte>
            {o.compte ? (
              <View style={[styles.compte, { backgroundColor: actif ? couleurs.foret : couleurs.ligneForte }]}>
                <Texte variante="libelle" style={{ color: actif ? couleurs.creme : couleurs.encre }}>{o.compte}</Texte>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Carte blanche bordée, sans ombre. */
export function Feuille({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.feuille, style]}>{children}</View>;
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
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: espaces.s,
    paddingHorizontal: espaces.l, borderRadius: rayons.champ,
  },
  boutonBord: { borderWidth: 1.5, borderColor: couleurs.ligneChamp },
  inactif: { opacity: 0.45 },
  champ: { gap: 6 },
  saisie: {
    minHeight: cible.action, borderWidth: 1.5, borderColor: couleurs.ligneChamp, borderRadius: rayons.champ,
    backgroundColor: couleurs.panneau, paddingHorizontal: 14, fontFamily: polices.texte, fontSize: tailles.champ, color: couleurs.encre,
  },
  choix: { flexDirection: "row", alignItems: "center", gap: espaces.s },
  liste: { flex: 1, backgroundColor: couleurs.panneau },
  listeEntete: { flexDirection: "row", alignItems: "center", paddingHorizontal: espaces.l, paddingVertical: espaces.m, gap: espaces.m },
  ligneListe: {
    minHeight: cible.action, justifyContent: "center", paddingHorizontal: espaces.l, paddingVertical: espaces.s,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: couleurs.ligneForte,
  },
  bandeau: { flexDirection: "row", alignItems: "center", gap: espaces.m, padding: espaces.m, borderRadius: rayons.champ, borderLeftWidth: 4 },
  croix: { minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" },
  pastille: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: rayons.pastille, backgroundColor: "rgba(249, 248, 245, 0.12)",
  },
  point: { width: 8, height: 8, borderRadius: 4 },
  segment: { flexDirection: "row", backgroundColor: couleurs.panneau3, borderRadius: rayons.carte, padding: 4, gap: 4 },
  onglet: {
    flex: 1, minHeight: cible.min, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: rayons.champ,
  },
  ongletActif: { backgroundColor: couleurs.panneau, borderWidth: 1.5, borderColor: couleurs.foret },
  compte: { minWidth: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center" },
  feuille: { backgroundColor: couleurs.panneau, borderRadius: rayons.carte, borderWidth: 1, borderColor: couleurs.ligne, padding: espaces.l, gap: espaces.m },
});
