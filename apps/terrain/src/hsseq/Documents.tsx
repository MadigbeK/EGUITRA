import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { revenir } from "../accueil/retour";
import type { Utilisateur } from "../auth/coffre";
import { useSession } from "../auth/session";
import { fmtDate, heure, pluriel } from "../format";
import { useEnvoi } from "../sync/Envoi";
import { BarreAction, Bandeau, Bouton, EnTete, Ecran, Feuille, Tampon, Texte, vibrer } from "../ui/elements";
import { espaces, mesures, textes } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import type { Lecture } from "./envoi";
import { documentSansFichier, ouvrirDocument } from "./ouvrirDocument";
import type { MyBulletin, MyDocuments, MyProcedure } from "./types";
import { useMesDocuments } from "./useHsseq";

const NATURE_ALERTE: Record<MyBulletin["kind"], string> = { flash_alert: "Alerte flash", lesson: "Retour d'expérience" };
const DOMAINE: Record<NonNullable<MyProcedure["domain"]>, string> = {
  safety: "Sécurité", health: "Santé", security: "Sûreté", environment: "Environnement", quality: "Qualité",
};

type Choix = { objet: "procedure" | "bulletin"; id: number };

/** Taille d'une pièce en mots courts. */
function taille(octets: number | null): string {
  if (!octets) return "";
  return octets < 1024 * 1024 ? `${Math.max(1, Math.round(octets / 1024))} Ko` : `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/**
 * Documents à lire (contrat HSSEQ, lot 3) : procédures en vigueur et alertes publiées qui visent le
 * compte. La lecture s'accuse d'un geste, avec l'heure de lecture sur l'appareil, même sans réseau :
 * l'accusé part par la file d'envoi. Une procédure se lit dans son document, ouvert d'abord.
 */
export function Documents({ user }: { user: Utilisateur }) {
  return (
    <Module nom="hsseq">
      <Contenu user={user} />
    </Module>
  );
}

function Contenu({ user }: { user: Utilisateur }) {
  const router = useRouter();
  const { api } = useSession();
  const envoi = useEnvoi();
  const { c } = useTerrain();
  const { liste, chargement, recharger, remplacer } = useMesDocuments();
  const [choisi, setChoisi] = useState<Choix | null>(null);
  const [ouverts, setOuverts] = useState<Set<number>>(new Set());
  const [ouverture, setOuverture] = useState<number | null>(null);
  const [retour, setRetour] = useState<{ ton: "ok" | "attention" | "danger"; texte: string } | null>(null);

  // Accusés encore dans la file d'envoi : la lecture est notée, le bureau ne l'a pas encore reçue.
  const enAttente = new Set(
    envoi.mine.filter((i) => i.kind === "lecture").map((i) => {
      const l = i.payload as unknown as Lecture;
      return `${l.objet}:${l.id}`;
    }),
  );

  // Retour Android sur un document : retour à la liste.
  useEffect(() => {
    if (!choisi) return;
    const abonnement = BackHandler.addEventListener("hardwareBackPress", () => {
      setChoisi(null);
      return true;
    });
    return () => abonnement.remove();
  }, [choisi]);

  /** Lecture accusée : file d'envoi, puis liste gardée mise à jour tout de suite. */
  async function accuser(objet: Choix["objet"], doc: MyProcedure | MyBulletin) {
    if (!liste) return;
    const maintenant = new Date().toISOString();
    const lecture: Lecture = objet === "procedure" ? { objet, id: doc.id, version_id: (doc as MyProcedure).version.id } : { objet, id: doc.id };
    try {
      await envoi.enregistrer({ client_uuid: randomUUID(), kind: "lecture", user_id: user.id, created_at: maintenant, status: "pending", payload: { ...lecture } });
    } catch {
      vibrer.erreur();
      setRetour({ ton: "danger", texte: "Enregistrement impossible sur cet appareil : réessayez. Si cela recommence, prévenez le bureau." });
      return;
    }
    const lu = <T extends MyProcedure | MyBulletin>(d: T): T => (d.id === doc.id ? { ...d, read: true, read_at: maintenant } : d);
    const suite: MyDocuments = {
      procedures: objet === "procedure" ? liste.procedures.map(lu) : liste.procedures,
      bulletins: objet === "bulletin" ? liste.bulletins.map(lu) : liste.bulletins,
      unread_count: Math.max(0, liste.unread_count - (doc.read ? 0 : 1)),
    };
    await remplacer(suite);
    vibrer.succes();
    setRetour({ ton: "ok", texte: envoi.online ? "Lecture notée." : "Lecture notée : elle partira au bureau dès que le réseau passe." });
    void envoi.sync("saisie");
  }

  async function ouvrir(p: MyProcedure, pieceId: number) {
    const piece = p.document.find((d) => d.id === pieceId);
    if (!piece || ouverture !== null) return;
    setOuverture(pieceId);
    setRetour(null);
    try {
      await ouvrirDocument(api, piece);
      setOuverts((o) => new Set(o).add(p.id));
    } catch (e) {
      vibrer.erreur();
      const sansFichier = documentSansFichier(e);
      setRetour({ ton: "attention", texte: sansFichier && e instanceof Error ? e.message : "Document pas encore sur l'appareil : il s'ouvre une première fois avec du réseau." });
      // Aperçu web, démonstration : la lecture reste possible pour essayer le parcours.
      if (sansFichier) setOuverts((o) => new Set(o).add(p.id));
    } finally {
      setOuverture(null);
    }
  }

  const procedure = choisi?.objet === "procedure" ? liste?.procedures.find((p) => p.id === choisi.id) ?? null : null;
  const bulletin = choisi?.objet === "bulletin" ? liste?.bulletins.find((b) => b.id === choisi.id) ?? null : null;

  const entete = (
    <EnTete
      titre="Documents"
      sousTitre={procedure ? procedure.code : bulletin ? NATURE_ALERTE[bulletin.kind] : "Procédures et alertes à lire"}
      gauche={(
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={choisi ? "Retour à la liste" : "Retour à Ma journée"}
          onPress={() => (choisi ? setChoisi(null) : revenir(router))}
          style={styles.retour}
        >
          <Text style={[textes.libelle, { color: c.enteteEncre }]}>‹</Text>
        </Pressable>
      )}
    />
  );

  if (liste === undefined) return <Ecran>{entete}<Texte ton="second" style={styles.vide}>Chargement des documents…</Texte></Ecran>;
  if (liste === null) {
    return (
      <Ecran>
        {entete}
        <View style={styles.page}>
          <Bandeau ton="attention" texte="Documents indisponibles : le bureau n'a pas pu être joint. Ils s'afficheront au retour du réseau." />
          <Bouton titre="Réessayer" variante="secondaire" onPress={recharger} />
        </View>
      </Ecran>
    );
  }

  // Lu : accusé reçu au bureau, ou noté sur l'appareil et encore dans la file d'envoi (une liste
  // fraîche du bureau peut arriver avant l'accusé).
  const estLu = (objet: Choix["objet"], d: MyProcedure | MyBulletin) => d.read || enAttente.has(`${objet}:${d.id}`);
  const tampon = (objet: Choix["objet"], d: MyProcedure | MyBulletin) =>
    estLu(objet, d)
      ? <Tampon mot={enAttente.has(`${objet}:${d.id}`) ? "Lu, à envoyer" : "Lu"} ton="ok" />
      : <Tampon mot="À lire" ton="warn" />;

  // Une alerte.
  if (bulletin) {
    const lu = estLu("bulletin", bulletin);
    return (
      <Ecran>
        {entete}
        <ScrollView contentContainerStyle={styles.page}>
          {retour ? <Bandeau ton={retour.ton} texte={retour.texte} onFermer={() => setRetour(null)} /> : null}
          <Feuille>
            <View style={styles.ligne}>
              <Tampon mot={NATURE_ALERTE[bulletin.kind]} ton={bulletin.kind === "flash_alert" ? "danger" : "neutre"} />
              {tampon("bulletin", bulletin)}
            </View>
            <Texte variante="titre">{bulletin.title}</Texte>
            <Texte variante="service" ton="second">{[bulletin.reference, bulletin.published_at ? `publiée le ${fmtDate(bulletin.published_at)}` : null].filter(Boolean).join(", ")}</Texte>
            <Texte>{bulletin.body}</Texte>
          </Feuille>
          {bulletin.key_messages ? (
            <Feuille>
              <Texte variante="libelle">À retenir</Texte>
              <Texte>{bulletin.key_messages}</Texte>
            </Feuille>
          ) : null}
        </ScrollView>
        <BarreAction
          etat={lu ? `Lu${bulletin.read_at ? ` à ${heure(bulletin.read_at)}, le ${fmtDate(bulletin.read_at)}` : ""}.` : "Votre lecture est notée avec son heure, même sans réseau."}
          tonEtat={lu ? "ok" : "second"}
        >
          <Bouton style={{ flex: 1 }} titre={lu ? "Lu" : "J'ai lu cette alerte"} fait={lu} desactive={lu} onPress={() => void accuser("bulletin", bulletin)} />
        </BarreAction>
      </Ecran>
    );
  }

  // Une procédure.
  if (procedure) {
    const ouvert = ouverts.has(procedure.id) || procedure.document.length === 0;
    const lue = estLu("procedure", procedure);
    return (
      <Ecran>
        {entete}
        <ScrollView contentContainerStyle={styles.page}>
          {retour ? <Bandeau ton={retour.ton} texte={retour.texte} onFermer={() => setRetour(null)} /> : null}
          <Feuille>
            <View style={styles.ligne}>
              {procedure.domain ? <Tampon mot={DOMAINE[procedure.domain]} ton="neutre" /> : null}
              {tampon("procedure", procedure)}
            </View>
            <Texte variante="titre">{procedure.title}</Texte>
            <Texte variante="service" ton="second">
              {[procedure.code, `version ${procedure.version.version}`, procedure.version.effective_date ? `en vigueur le ${fmtDate(procedure.version.effective_date)}` : null].filter(Boolean).join(", ")}
            </Texte>
          </Feuille>
          {procedure.version.change_summary ? (
            <Feuille>
              <Texte variante="libelle">Ce qui change dans cette version</Texte>
              <Texte>{procedure.version.change_summary}</Texte>
            </Feuille>
          ) : null}
          {procedure.document.length ? (
            <Feuille>
              <Texte variante="libelle">{pluriel(procedure.document.length, "document")}</Texte>
              {procedure.document.map((d) => (
                <Bouton
                  key={d.id}
                  titre={`Ouvrir : ${d.name}`}
                  variante="secondaire"
                  chargement={ouverture === d.id}
                  indice={taille(d.size) ? `Document de ${taille(d.size)}` : undefined}
                  onPress={() => void ouvrir(procedure, d.id)}
                />
              ))}
            </Feuille>
          ) : null}
        </ScrollView>
        <BarreAction
          etat={lue
            ? `Version ${procedure.version.version} lue${procedure.read_at ? ` le ${fmtDate(procedure.read_at)}` : ""}.`
            : !ouvert ? "Ouvrez le document pour en accuser lecture." : "Votre lecture est notée avec son heure, même sans réseau."}
          tonEtat={lue ? "ok" : "second"}
        >
          <Bouton
            style={{ flex: 1 }}
            titre={lue ? "Lue" : `J'ai lu la version ${procedure.version.version}`}
            fait={lue}
            desactive={lue || !ouvert}
            onPress={() => void accuser("procedure", procedure)}
          />
        </BarreAction>
      </Ecran>
    );
  }

  // La liste : à lire d'abord (ordre du bureau).
  const vide = !liste.bulletins.length && !liste.procedures.length;
  const aLire = liste.bulletins.filter((b) => !estLu("bulletin", b)).length + liste.procedures.filter((p) => !estLu("procedure", p)).length;
  return (
    <Ecran>
      {entete}
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={chargement} onRefresh={recharger} />}>
        {retour ? <Bandeau ton={retour.ton} texte={retour.texte} onFermer={() => setRetour(null)} /> : null}
        {!envoi.online ? <Bandeau ton="attention" texte="Hors réseau : dernière liste connue. Vos lectures partiront au retour du réseau." /> : null}
        {vide ? <Texte ton="second" style={styles.vide}>Aucun document ne vous est adressé pour l'instant.</Texte> : null}
        {aLire ? <Texte variante="service" ton="second">{pluriel(aLire, "document à lire", "documents à lire")}.</Texte> : null}
        {liste.bulletins.length ? <Texte variante="libelle">Alertes</Texte> : null}
        {liste.bulletins.map((b) => (
          <Pressable key={`b-${b.id}`} accessibilityRole="button" accessibilityLabel={`${NATURE_ALERTE[b.kind]} : ${b.title}${estLu("bulletin", b) ? ", lue" : ", à lire"}`} onPress={() => { setRetour(null); setChoisi({ objet: "bulletin", id: b.id }); }} android_ripple={{ color: c.voile }}>
            <Feuille>
              <View style={styles.ligne}>
                <Texte variante="texteDemi" style={{ flex: 1 }}>{b.title}</Texte>
                {tampon("bulletin", b)}
              </View>
              <Texte variante="service" ton="second">{[NATURE_ALERTE[b.kind], b.published_at ? `le ${fmtDate(b.published_at)}` : null].filter(Boolean).join(", ")}</Texte>
            </Feuille>
          </Pressable>
        ))}
        {liste.procedures.length ? <Texte variante="libelle">Procédures</Texte> : null}
        {liste.procedures.map((p) => (
          <Pressable key={`p-${p.id}`} accessibilityRole="button" accessibilityLabel={`Procédure ${p.code} : ${p.title}${estLu("procedure", p) ? ", lue" : ", à lire"}`} onPress={() => { setRetour(null); setChoisi({ objet: "procedure", id: p.id }); }} android_ripple={{ color: c.voile }}>
            <Feuille>
              <View style={styles.ligne}>
                <Texte variante="texteDemi" style={{ flex: 1 }}>{p.title}</Texte>
                {tampon("procedure", p)}
              </View>
              <Texte variante="service" ton="second">{[p.code, `version ${p.version.version}`, p.domain ? DOMAINE[p.domain] : null].filter(Boolean).join(", ")}</Texte>
            </Feuille>
          </Pressable>
        ))}
      </ScrollView>
    </Ecran>
  );
}

const styles = StyleSheet.create({
  retour: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center" },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  vide: { padding: espaces[8], textAlign: "center" },
  ligne: { flexDirection: "row", alignItems: "center", gap: espaces[3], flexWrap: "wrap" },
});
