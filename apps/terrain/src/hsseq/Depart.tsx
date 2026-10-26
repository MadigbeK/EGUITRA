import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "../api/errors";
import type { Utilisateur } from "../auth/coffre";
import { useSession } from "../auth/session";
import { DELAI_LISTE } from "../config";
import { fmtDate, heure, pluriel } from "../format";
import { useEnvoi } from "../sync/Envoi";
import { signalerActivite } from "../ui/activite";
import { BarreAction, Bandeau, Bouton, EnTete, Ecran, Feuille, Tampon, Texte, vibrer } from "../ui/elements";
import { Cadenas } from "../ui/icones";
import { espaces, mesures, polices, rayons, textes, traits } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import type { LockEvaluation, LockReason, MyRotation, MyRotations } from "./types";
import { derogeables, etatDepart, JAMAIS_DEROGEABLES, JUSTIFICATION_MIN, motifsOuverts, TAMPON_DEPART, titreMotif } from "./verrou";

const CLE = "hsseq.me.rotations";

interface Garde {
  liste: MyRotations;
  /** Heure de la dernière réponse du bureau, en millisecondes. */
  at: number;
}

/**
 * Départs du jour et verrou (système « terrain », § 3.8 ; contrat HSSEQ, § 9). Le conducteur voit
 * si son départ est bloqué et pourquoi ; le chef de parc le passe « en route » ou demande une
 * dérogation. Hors réseau, la dernière réponse du bureau reste affichée avec son heure, jamais
 * comme une autorisation.
 */
export function Depart({ user }: { user: Utilisateur }) {
  return (
    <Module nom="hsseq">
      <Contenu user={user} />
    </Module>
  );
}

function Contenu({ user }: { user: Utilisateur }) {
  const router = useRouter();
  const { api, store } = useSession();
  const envoi = useEnvoi();
  const { echanger } = envoi;
  const { c } = useTerrain();
  const chefDeParc = user.profiles.includes("exploitation");
  const [garde, setGarde] = useState<Garde | null | undefined>(undefined);
  const [choisie, setChoisie] = useState<number | null>(null);
  const [chargement, setChargement] = useState(false);
  const [action, setAction] = useState(false);
  const [retour, setRetour] = useState<{ ton: "ok" | "attention" | "danger"; texte: string } | null>(null);
  const [derogation, setDerogation] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    const cache = await store.cache.get<Garde>(CLE).catch(() => undefined);
    if (cache) setGarde((g) => g ?? cache);
    try {
      const liste = await echanger(() => api.appel<MyRotations>("GET", "/hsseq/me/rotations", { timeout: DELAI_LISTE }));
      const frais = { liste, at: Date.now() };
      setGarde(frais);
      await store.cache.set(CLE, frais);
    } catch {
      if (!cache) setGarde(null);
    } finally {
      setChargement(false);
    }
  }, [api, store, echanger]);

  // Au retour d'un contrôle ou d'un alcootest fait depuis le verrou, les départs se rechargent.
  useFocusEffect(
    useCallback(() => {
      void charger();
    }, [charger]),
  );

  const rotation = garde?.liste.items.find((r) => r.id === choisie) ?? null;

  /** Remplace une rotation de la liste gardée, après une réponse du bureau. */
  const remplacer = async (r: MyRotation) => {
    if (!garde) return;
    const suite = { liste: { ...garde.liste, items: garde.liste.items.map((x) => (x.id === r.id ? r : x)) }, at: Date.now() };
    setGarde(suite);
    await store.cache.set(CLE, suite).catch(() => undefined);
  };

  /** Nouvelle évaluation du verrou ; `garder` : le message en place (dérogation envoyée) reste affiché. */
  async function verifier(r: MyRotation, garder = false) {
    if (action) return;
    setAction(true);
    if (!garder) setRetour(null);
    try {
      const ev = await echanger(() => api.appel<LockEvaluation>("POST", "/hsseq/lock/evaluate", { body: { rotation_id: r.id } }));
      await remplacer({ ...r, lock: { allowed: ev.allowed, pending_checks_only: ev.pending_checks_only, reasons: ev.reasons, warnings: ev.warnings ?? [], lock_active: ev.lock_active } });
      if (ev.allowed) vibrer.succes();
      else vibrer.erreur();
    } catch (e) {
      setRetour({ ton: "attention", texte: e instanceof ApiError ? e.message : "Départ non vérifié : le bureau n'a pas pu être joint. Nouvel essai au retour du réseau." });
    } finally {
      setAction(false);
    }
  }

  async function partir(r: MyRotation) {
    if (action) return;
    setAction(true);
    setRetour(null);
    try {
      await echanger(() => api.appel("POST", `/transport/rotations/${r.id}/depart`));
      await remplacer({ ...r, state: "en_route", lock: null });
      vibrer.succes();
      setRetour({ ton: "ok", texte: `${r.vehicle?.name ?? "Rotation"} en route.` });
    } catch (e) {
      vibrer.erreur();
      if (e instanceof ApiError && e.code === "departure_blocked") {
        const blockers = (e.extra.blockers as LockReason[] | undefined) ?? [];
        await remplacer({ ...r, lock: { allowed: false, pending_checks_only: false, reasons: blockers.map((b) => ({ ...b, pending: b.pending ?? false, waiver_id: null })), warnings: [], lock_active: true } });
        setRetour({ ton: "danger", texte: `Départ refusé par le bureau : ${pluriel(blockers.length, "motif")}.` });
      } else {
        setRetour({ ton: "attention", texte: e instanceof ApiError ? e.message : "Départ impossible sans réseau : le bureau doit le confirmer." });
      }
    } finally {
      setAction(false);
    }
  }

  const entete = (
    <EnTete
      titre="Départ"
      sousTitre={rotation ? `${rotation.vehicle?.name ?? "Rotation"}${rotation.route_name ? `, ${rotation.route_name}` : ""}` : `Départs du ${fmtDate(garde?.liste.date ?? "")}`}
      gauche={(
        <Pressable accessibilityRole="button" accessibilityLabel={rotation ? "Retour aux départs du jour" : "Retour à Ma journée"} onPress={() => (rotation ? setChoisie(null) : router.back())} style={styles.retour}>
          <Text style={[textes.libelle, { color: c.enteteEncre }]}>‹</Text>
        </Pressable>
      )}
    />
  );

  if (garde === undefined) return <Ecran>{entete}<Texte ton="second" style={styles.vide}>Chargement des départs du jour…</Texte></Ecran>;
  if (garde === null) {
    return (
      <Ecran>
        {entete}
        <View style={styles.page}>
          <Bandeau ton="attention" texte="Départs du jour indisponibles : le bureau n'a pas pu être joint. Ils s'afficheront au retour du réseau." />
          <Bouton titre="Réessayer" variante="secondaire" onPress={() => void charger()} />
        </View>
      </Ecran>
    );
  }

  // Liste des départs du jour.
  if (!rotation) {
    return (
      <Ecran>
        {entete}
        <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={chargement} onRefresh={() => void charger()} />}>
          {!envoi.online ? <Bandeau ton="attention" texte={`Hors réseau : dernière réponse du bureau à ${heure(new Date(garde.at).toISOString())}. Aucun départ n'est vérifié.`} /> : null}
          {garde.liste.items.length === 0 ? (
            <Texte ton="second" style={styles.vide}>{chefDeParc ? "Aucun départ prévu aujourd'hui sur vos sites." : "Aucune rotation à votre nom aujourd'hui."}</Texte>
          ) : null}
          {garde.liste.items.map((r) => {
            const etat = TAMPON_DEPART[etatDepart(r, envoi.online, garde.at)];
            const ouverts = r.lock ? motifsOuverts(r.lock.reasons).length : 0;
            return (
              <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`${r.vehicle?.name ?? "Rotation"}, ${etat.mot}`} onPress={() => { setRetour(null); setChoisie(r.id); }} android_ripple={{ color: c.voile }}>
                <Feuille>
                  <View style={styles.ligne}>
                    <View style={{ flex: 1 }}>
                      <Texte variante="libelle">{r.vehicle?.name ?? "Rotation"}{r.name ? `, ${r.name}` : ""}</Texte>
                      <Texte variante="service" ton="second">
                        {[r.route_name, chefDeParc ? r.driver?.name : null, r.site?.name].filter(Boolean).join(", ") || fmtDate(r.date_loading)}
                      </Texte>
                    </View>
                    <Tampon mot={etat.mot} ton={etat.ton} />
                  </View>
                  {ouverts ? <Texte variante="service" ton="dangerTexte">{pluriel(ouverts, "motif ouvert", "motifs ouverts")}</Texte> : null}
                </Feuille>
              </Pressable>
            );
          })}
        </ScrollView>
        <BarreAction etat={`Vérifié à ${heure(new Date(garde.at).toISOString())}. Seul le bureau autorise le départ.`}>
          <Bouton style={{ flex: 1 }} titre="Vérifier à nouveau" chargement={chargement} desactive={!envoi.online} onPress={() => void charger()} />
        </BarreAction>
      </Ecran>
    );
  }

  // Fiche d'un départ.
  const etat = etatDepart(rotation, envoi.online, garde.at);
  const lock = rotation.lock;
  const ouverts = lock ? motifsOuverts(lock.reasons) : [];
  const levables = lock ? derogeables(lock.reasons) : [];
  const avertissements = lock ? [...lock.warnings, ...lock.reasons.filter((r) => r.severity === "warn")] : [];
  return (
    <Ecran>
      {entete}
      <ScrollView contentContainerStyle={styles.page}>
        {retour ? <Bandeau ton={retour.ton} texte={retour.texte} onFermer={() => setRetour(null)} /> : null}
        {etat === "bloque" ? (
          <Feuille style={{ borderColor: c.danger, borderWidth: traits.fort, backgroundColor: c.dangerDoux }}>
            <View style={styles.ligne}>
              <Cadenas taille={40} couleur={c.dangerTexte} />
              <Texte variante="titreFort" ton="dangerTexte" style={{ flex: 1 }}>Départ bloqué</Texte>
            </View>
            <Texte>{pluriel(ouverts.length, "motif")} à lever avant le départ.</Texte>
          </Feuille>
        ) : etat === "autorise" ? (
          <Feuille style={{ borderColor: c.ok, borderWidth: traits.fort, backgroundColor: c.okDoux }}>
            <Texte variante="titreFort" ton="ok">Départ autorisé</Texte>
            <Texte>Le bureau a vérifié le départ à {heure(new Date(garde.at).toISOString())}.</Texte>
          </Feuille>
        ) : etat === "a_controler" ? (
          <Feuille style={{ borderColor: c.warn, borderWidth: traits.fort, backgroundColor: c.warnDoux }}>
            <Texte variante="titreFort" ton="warn">À contrôler</Texte>
            <Texte>Des saisies de terrain restent à faire : contrôle avant départ ou alcootest.</Texte>
          </Feuille>
        ) : etat === "en_route" ? (
          <Feuille>
            <Texte variante="titreFort">En route</Texte>
            <Texte>La rotation est partie.</Texte>
          </Feuille>
        ) : (
          <Feuille style={{ borderColor: c.warn, borderWidth: traits.fort, backgroundColor: c.warnDoux }}>
            <Texte variante="titreFort" ton="warn">Départ non vérifié</Texte>
            <Texte>Dernière réponse du bureau à {heure(new Date(garde.at).toISOString())}. Sans réponse récente, le départ n'est pas autorisé.</Texte>
          </Feuille>
        )}
        {lock && lock.lock_active === false ? (
          <Bandeau ton="attention" texte="Le verrou HSSEQ n'est pas encore en service : ses motifs sont affichés, ils ne bloquent pas le départ." />
        ) : null}

        {ouverts.map((r) => (
          <Feuille key={r.code}>
            <View style={styles.ligne}>
              <View style={[styles.code, { backgroundColor: c.encre }]}>
                <Text style={[textes.service, { color: c.surface }]}>{r.code}</Text>
              </View>
              <Texte variante="libelle" style={{ flex: 1 }}>{titreMotif(r)}</Texte>
            </View>
            {r.detail ? <Texte>{r.detail}</Texte> : null}
            {r.resolution ? <Texte variante="service" ton="second">Lève ce motif : {r.resolution}</Texte> : null}
            {r.code === "V01" ? (
              <Bouton titre="Faire le contrôle avant départ" variante="secondaire" onPress={() => router.push({ pathname: "/controle", params: rotation.vehicle ? { vehicule: String(rotation.vehicle.id) } : {} })} />
            ) : null}
            {r.code === "V03" && r.pending ? (
              <Bouton titre="Faire l'alcootest" variante="secondaire" onPress={() => router.push("/alcootest")} />
            ) : null}
          </Feuille>
        ))}
        {lock?.reasons.filter((r) => r.waiver_id).map((r) => (
          <Feuille key={`d-${r.code}`}>
            <View style={styles.ligne}>
              <Texte variante="texteDemi" style={{ flex: 1 }}>{r.code}, {titreMotif(r)}</Texte>
              <Tampon mot="Sous dérogation" ton="warn" />
            </View>
          </Feuille>
        ))}
        {avertissements.map((r, i) => (
          <Feuille key={`w-${r.code}-${i}`}>
            <View style={styles.ligne}>
              <Texte variante="texteDemi" style={{ flex: 1 }}>{titreMotif(r)}</Texte>
              <Tampon mot="À surveiller" ton="warn" />
            </View>
            {r.detail ? <Texte variante="service" ton="second">{r.detail}</Texte> : null}
          </Feuille>
        ))}

        {chefDeParc && levables.length && etat !== "en_route" ? (
          <Bouton titre="Demander une dérogation" variante="secondaire" desactive={!envoi.online} onPress={() => setDerogation(true)} />
        ) : null}
        {!chefDeParc && etat === "autorise" ? <Texte ton="second">Le chef de parc passe la rotation en route.</Texte> : null}
      </ScrollView>
      {etat !== "en_route" ? (
        <BarreAction etat={envoi.online ? `Vérifié à ${heure(new Date(garde.at).toISOString())}. Seul le bureau autorise le départ.` : "Hors réseau : le départ ne peut pas être vérifié."} tonEtat={envoi.online ? "second" : "warn"}>
          {chefDeParc && etat === "autorise" ? (
            <>
              <Bouton titre="Vérifier" variante="secondaire" chargement={action} desactive={!envoi.online} onPress={() => void verifier(rotation)} />
              <Bouton style={{ flex: 1 }} titre="Partir : passer en route" chargement={action} desactive={!envoi.online} onPress={() => void partir(rotation)} />
            </>
          ) : (
            <Bouton style={{ flex: 1 }} titre="Vérifier à nouveau" chargement={action} desactive={!envoi.online} onPress={() => void verifier(rotation)} />
          )}
        </BarreAction>
      ) : null}
      {chefDeParc ? (
        <Derogation
          visible={derogation}
          rotation={rotation}
          motifs={levables}
          jamais={ouverts.filter((r) => JAMAIS_DEROGEABLES.includes(r.code))}
          onFermer={() => setDerogation(false)}
          onEnvoyee={(texte) => {
            setDerogation(false);
            setRetour({ ton: "ok", texte });
            void verifier(rotation, true);
          }}
        />
      ) : null}
    </Ecran>
  );
}

/**
 * Demande de dérogation (§ 3.9 ; contrat HSSEQ, § 10) : une rotation, un seul motif, une justification
 * écrite de 30 caractères au moins. La demande du chef de parc vaut première validation ; la seconde
 * est donnée par le Responsable HSSEQ. V01 et V03 ne se dérogent jamais.
 */
function Derogation({
  visible, rotation, motifs, jamais, onFermer, onEnvoyee,
}: {
  visible: boolean;
  rotation: MyRotation;
  motifs: LockReason[];
  jamais: LockReason[];
  onFermer: () => void;
  onEnvoyee: (texte: string) => void;
}) {
  const { api } = useSession();
  const { c } = useTerrain();
  const [code, setCode] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const longueur = justification.trim().length;
  const pret = code !== null && longueur >= JUSTIFICATION_MIN;

  async function demander() {
    if (!pret || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await api.appel("POST", "/hsseq/waivers", { body: { rotation_id: rotation.id, reason_code: code, justification: justification.trim() } });
      vibrer.succes();
      setJustification("");
      setCode(null);
      onEnvoyee("Demande de dérogation envoyée : attente du Responsable HSSEQ.");
    } catch (e) {
      vibrer.erreur();
      setErreur(e instanceof ApiError ? e.message : "Demande impossible sans réseau : réessayez au retour du réseau.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onFermer}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.fond }}>
        <View style={[styles.fenetreEntete, { borderBottomColor: c.filet, backgroundColor: c.surface }]}>
          <Texte variante="titre" style={{ flex: 1 }}>Demander une dérogation</Texte>
          <Bouton titre="Fermer" variante="discret" onPress={onFermer} />
        </View>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          {erreur ? <Bandeau ton="danger" texte={erreur} /> : null}
          <Texte variante="libelle">Motif à déroger, un seul par demande</Texte>
          <View accessibilityRole="radiogroup" style={{ gap: espaces[3] }}>
            {motifs.map((r) => {
              const actif = code === r.code;
              return (
                <Pressable
                  key={r.code}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: actif }}
                  onPress={() => { vibrer.selection(); setCode(r.code); }}
                  style={[styles.radio, { borderColor: actif ? c.accentPlein : c.trait, backgroundColor: actif ? c.accentDoux : c.surface }]}
                >
                  <Texte variante="texteDemi">{r.code}, {titreMotif(r)}</Texte>
                </Pressable>
              );
            })}
          </View>
          {jamais.length ? (
            <Feuille>
              <View style={styles.ligne}>
                <Cadenas taille={24} couleur={c.dangerTexte} />
                <Texte variante="texteDemi" style={{ flex: 1 }}>{jamais.map((r) => r.code).join(" et ")} : jamais dérogeables</Texte>
              </View>
              <Texte variante="service" ton="second">Le contrôle avant départ et l'alcootest se font toujours.</Texte>
            </Feuille>
          ) : null}
          <View style={styles.ligne}>
            <Texte variante="texteDemi" ton="encre2" style={{ flex: 1 }}>Justification</Texte>
            <Texte variante="service" ton={longueur >= JUSTIFICATION_MIN ? "ok" : "second"}>{longueur} / {JUSTIFICATION_MIN} au moins</Texte>
          </View>
          <TextInput
            accessibilityLabel="Justification de la dérogation"
            multiline
            value={justification}
            onChangeText={(t) => {
              signalerActivite();
              setJustification(t);
            }}
            placeholderTextColor={c.second}
            style={[styles.texte, { borderColor: c.trait, backgroundColor: c.surface, color: c.encre }]}
          />
          <Feuille>
            <Texte>Pour cette seule rotation : la dérogation expire à l'arrivée.</Texte>
            <Texte>Deux validations : la vôtre, puis celle du Responsable HSSEQ.</Texte>
            <Texte>Le Directeur général est informé, et la dérogation compte dans les indicateurs.</Texte>
          </Feuille>
        </ScrollView>
        <BarreAction etat={!code ? "Choisissez le motif." : longueur < JUSTIFICATION_MIN ? `Encore ${JUSTIFICATION_MIN - longueur} caractères de justification.` : "Votre demande vaut première validation."}>
          <Bouton style={{ flex: 1 }} titre="Valider ma demande" desactive={!pret} chargement={envoi} onPress={() => void demander()} />
        </BarreAction>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  retour: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center" },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  vide: { padding: espaces[8], textAlign: "center" },
  ligne: { flexDirection: "row", alignItems: "center", gap: espaces[3] },
  code: { borderRadius: rayons.tampon, paddingHorizontal: 8, paddingVertical: 2 },
  fenetreEntete: { flexDirection: "row", alignItems: "center", gap: espaces[3], paddingHorizontal: espaces[4], paddingVertical: espaces[3], borderBottomWidth: traits.filet },
  radio: { minHeight: mesures.cibleForte, borderRadius: rayons.bouton, borderWidth: traits.champ, paddingHorizontal: espaces[4], justifyContent: "center" },
  texte: { minHeight: 120, borderWidth: traits.champ, borderRadius: rayons.champ, padding: 14, fontFamily: polices.texte, fontSize: 17, textAlignVertical: "top" },
});
