import { useRouter } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { revenir } from "../accueil/retour";
import { fmtDate, pluriel } from "../format";
import { useEnvoi } from "../sync/Envoi";
import { Bandeau, Bouton, EnTete, Ecran, Feuille, Tampon, Texte } from "../ui/elements";
import { Cadenas } from "../ui/icones";
import { espaces, mesures, textes, traits } from "../ui/terrain";
import { Module, useTerrain } from "../ui/useTerrain";
import type { MyFile, MyQualification } from "./types";
import { useMonDossier } from "./useHsseq";

const APTITUDE: Record<NonNullable<MyFile["fitness"]>, { mot: string; ton: "ok" | "warn" | "danger" }> = {
  fit: { mot: "Apte", ton: "ok" },
  review: { mot: "À revoir", ton: "warn" },
  unfit: { mot: "Inapte", ton: "danger" },
};

const STATUT: Record<NonNullable<MyQualification["status"]>, { mot: string; ton: "ok" | "warn" | "danger" | "neutre" }> = {
  valid: { mot: "Valide", ton: "ok" },
  to_renew: { mot: "À renouveler", ton: "warn" },
  expired: { mot: "Expirée", ton: "danger" },
  missing: { mot: "Absente", ton: "danger" },
};

/** Échéance d'une habilitation, en mots simples. */
function echeance(q: MyQualification): string {
  if (q.status === "missing") return q.mandatory ? "Obligatoire pour conduire : à obtenir." : "Pas encore obtenue.";
  const parties = [q.obtained_on ? `obtenue le ${fmtDate(q.obtained_on)}` : null];
  if (q.expires_on) {
    if (q.days_left !== null && q.days_left < 0) parties.push(`expirée depuis le ${fmtDate(q.expires_on)}`);
    else if (q.days_left !== null && q.days_left <= 60) parties.push(`expire le ${fmtDate(q.expires_on)}, dans ${pluriel(q.days_left, "jour")}`);
    else parties.push(`expire le ${fmtDate(q.expires_on)}`);
  } else {
    parties.push("sans échéance");
  }
  const texte = parties.filter(Boolean).join(", ");
  return texte.charAt(0).toUpperCase() + texte.slice(1) + ".";
}

/**
 * Mon dossier (conducteur) : aptitude médicale en statut seul, habilitations avec leurs échéances,
 * et ce qui bloque le départ (V04). Gardé sur l'appareil pour une consultation sans réseau ; le
 * détail médical reste au service de santé, jamais sur le téléphone.
 */
export function Dossier() {
  return (
    <Module nom="hsseq">
      <Contenu />
    </Module>
  );
}

function Contenu() {
  const router = useRouter();
  const envoi = useEnvoi();
  const { c } = useTerrain();
  const { liste: dossier, chargement, recharger } = useMonDossier();

  const entete = (
    <EnTete
      titre="Mon dossier"
      sousTitre={dossier?.employee ? `${dossier.employee.name}${dossier.employee.matricule ? `, matricule ${dossier.employee.matricule}` : ""}` : "Habilitations et aptitude"}
      gauche={(
        <Pressable accessibilityRole="button" accessibilityLabel="Retour à Ma journée" onPress={() => revenir(router)} style={styles.retour}>
          <Text style={[textes.libelle, { color: c.enteteEncre }]}>‹</Text>
        </Pressable>
      )}
    />
  );

  if (dossier === undefined) return <Ecran>{entete}<Texte ton="second" style={styles.vide}>Chargement de votre dossier…</Texte></Ecran>;
  if (dossier === null) {
    return (
      <Ecran>
        {entete}
        <View style={styles.page}>
          <Bandeau ton="attention" texte="Dossier indisponible : le bureau n'a pas pu être joint. Il s'affichera au retour du réseau." />
          <Bouton titre="Réessayer" variante="secondaire" onPress={recharger} />
        </View>
      </Ecran>
    );
  }

  const obligatoires = dossier.qualifications.filter((q) => q.mandatory);
  const autres = dossier.qualifications.filter((q) => !q.mandatory);
  const aptitude = dossier.fitness ? APTITUDE[dossier.fitness] : null;
  return (
    <Ecran>
      {entete}
      <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={chargement} onRefresh={recharger} />}>
        {!envoi.online ? <Bandeau ton="attention" texte="Hors réseau : dernière version connue de votre dossier." /> : null}
        {!dossier.employee ? (
          <Bandeau ton="attention" texte="Votre compte n'est relié à aucun dossier salarié : voyez le service RH." />
        ) : null}
        {dossier.departure_blocked ? (
          <Feuille style={{ borderColor: c.danger, borderWidth: traits.fort, backgroundColor: c.dangerDoux }}>
            <View style={styles.ligne}>
              <Cadenas taille={32} couleur={c.dangerTexte} />
              <Texte variante="titre" ton="dangerTexte" style={{ flex: 1 }}>Votre dossier bloque le départ</Texte>
            </View>
            <Texte>Une habilitation obligatoire manque ou a expiré, ou l'aptitude médicale n'est plus valable (V04). Voyez le Responsable HSSEQ ou le service RH.</Texte>
          </Feuille>
        ) : null}
        {dossier.employee ? (
          <Feuille>
            <View style={styles.ligne}>
              <Texte variante="libelle" style={{ flex: 1 }}>Aptitude médicale</Texte>
              {aptitude ? <Tampon mot={aptitude.mot} ton={aptitude.ton} /> : <Tampon mot="Non renseignée" ton="warn" />}
            </View>
            <Texte variante="service" ton="second">Statut seul : le détail médical reste au service de santé.</Texte>
          </Feuille>
        ) : null}
        {obligatoires.length ? <Texte variante="libelle">Habilitations obligatoires pour conduire</Texte> : null}
        {obligatoires.map((q) => <Ligne key={q.code} q={q} />)}
        {autres.length ? <Texte variante="libelle">Autres habilitations</Texte> : null}
        {autres.map((q) => <Ligne key={q.code} q={q} />)}
        {dossier.employee && !dossier.qualifications.length ? <Texte ton="second" style={styles.vide}>Aucune habilitation enregistrée.</Texte> : null}
      </ScrollView>
    </Ecran>
  );
}

function Ligne({ q }: { q: MyQualification }) {
  const { c } = useTerrain();
  const statut = q.status ? STATUT[q.status] : { mot: "Inconnue", ton: "neutre" as const };
  // Une habilitation facultative absente n'alarme pas.
  const ton = q.status === "missing" && !q.mandatory ? "neutre" : statut.ton;
  return (
    <Feuille style={ton === "danger" ? { borderColor: c.danger, borderWidth: traits.champ } : undefined}>
      <View style={styles.ligne}>
        <Texte variante="texteDemi" style={{ flex: 1 }}>{q.name}</Texte>
        <Tampon mot={statut.mot} ton={ton} />
      </View>
      <Texte variante="service" ton={ton === "danger" ? "dangerTexte" : "second"}>{echeance(q)}</Texte>
    </Feuille>
  );
}

const styles = StyleSheet.create({
  retour: { minWidth: mesures.cible, minHeight: mesures.cible, alignItems: "center", justifyContent: "center" },
  page: { padding: espaces[4], gap: espaces[4], paddingBottom: espaces[8] },
  vide: { padding: espaces[8], textAlign: "center" },
  ligne: { flexDirection: "row", alignItems: "center", gap: espaces[3] },
});
