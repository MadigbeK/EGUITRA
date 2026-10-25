import { ScrollView, StyleSheet, View } from "react-native";
import type { Referentials } from "../api/types";
import { fmtDate, fmtM3, fmtVolume, heure, pluriel, quand } from "../format";
import type { QueuedItem } from "../store/types";
import { Bandeau, Bouton, Feuille, Tampon, Texte, demanderConfirmation } from "../ui/elements";
import { espaces, traits } from "../ui/terrain";
import { useTerrain } from "../ui/useTerrain";
import { STATE_LABEL } from "./form";
import type { Rotations } from "./useRotations";

function nom(refs: Referentials | null | undefined, kind: "vehicles" | "clients" | "routes", id: unknown): string {
  const list: Array<{ id: number; name: string }> = refs?.[kind] ?? [];
  return list.find((x) => x.id === Number(id))?.name ?? "–";
}

/** Saisies en attente de l'utilisateur : envoi à la demande, correction, suppression. */
export function ListeAttente({ rot, onCorriger }: { rot: Rotations; onCorriger: (item: QueuedItem) => void }) {
  const { c } = useTerrain();
  const aEnvoyer = rot.mine.length;
  async function supprimer(item: QueuedItem) {
    if (!(await demanderConfirmation("Supprimer cette saisie de l'appareil ? Elle ne sera pas transmise.", { action: "Supprimer", danger: true }))) return;
    await rot.supprimer(item.client_uuid);
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.entete}>
        <Texte variante="service" ton="second" style={{ flex: 1 }}>
          {!rot.online
            ? "Hors réseau : l'envoi partira seul au retour du réseau."
            : rot.lastSync ? `Dernier envoi : ${quand(rot.lastSync)}` : "Les saisies partent seules dès que le réseau passe."}
        </Texte>
        <Bouton titre="Envoyer maintenant" variante="secondaire" chargement={rot.syncing} desactive={!rot.online || !aEnvoyer} onPress={() => void rot.sync("envoi")} />
      </View>
      {rot.lectureImpossible ? (
        <Bandeau ton="danger" texte="Les saisies de cet appareil ne se lisent pas. Fermez puis rouvrez l'application ; si cela recommence, prévenez le bureau avant toute nouvelle saisie." />
      ) : aEnvoyer === 0 ? (
        <Texte ton="second" style={styles.vide}>Toutes vos saisies ont été transmises.</Texte>
      ) : null}
      {rot.mine.map((item) => {
        const refusee = item.status === "error";
        return (
          <Feuille key={item.client_uuid} style={refusee ? { borderColor: c.danger, borderWidth: traits.fort } : undefined}>
            <View style={styles.ligne}>
              <View style={{ flex: 1 }}>
                <Texte variante="texteDemi">{nom(rot.refs, "vehicles", item.payload.vehicle_id)}, {fmtDate(item.payload.date_loading)}</Texte>
                <Texte variante="service" ton="second">{nom(rot.refs, "clients", item.payload.partner_id)}, {nom(rot.refs, "routes", item.payload.route_id)}</Texte>
              </View>
              <Tampon mot={refusee ? "Refusée" : "En attente"} ton={refusee ? "danger" : "warn"} />
            </View>
            <Texte variante="titre">{fmtM3(item.payload.volume_loaded ?? item.payload.volume_delivered)}</Texte>
            <Texte variante="service" ton="second">Saisi {heure(item.created_at)}, envoi : {refusee ? "refusé par le bureau" : "en attente"}</Texte>
            {item.message ? <Texte variante="texteDemi" ton="dangerTexte">{item.message}</Texte> : null}
            <View style={[styles.actions, { borderTopColor: c.filet }]}>
              <Bouton titre="Corriger" variante="secondaire" desactive={!rot.refs} onPress={() => onCorriger(item)} />
              <Bouton titre="Supprimer" variante="danger" onPress={() => void supprimer(item)} />
            </View>
          </Feuille>
        );
      })}
      {rot.others > 0 ? (
        <Texte variante="service" ton="second">
          {pluriel(rot.others, "saisie")} d'un autre utilisateur {rot.others > 1 ? "restent sur cet appareil : elles partiront" : "reste sur cet appareil : elle partira"} à sa prochaine connexion.
        </Texte>
      ) : null}
    </ScrollView>
  );
}

/** Dernières rotations reçues au bureau, gardées pour la consultation sans réseau. */
export function ListeEnvoyees({ rot }: { rot: Rotations }) {
  const { c } = useTerrain();
  const sent = rot.sent;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {!rot.online ? <Bandeau ton="attention" texte="Hors réseau : dernière liste connue." /> : null}
      {sent === null ? (
        rot.sentIndisponible
          ? <Bandeau ton="attention" texte="Liste indisponible : le bureau n'a pas pu être joint. Elle s'affichera au retour du réseau." />
          : <Texte ton="second" style={styles.vide}>Chargement des rotations…</Texte>
      ) : sent.length === 0 ? (
        <Texte ton="second" style={styles.vide}>Aucune rotation.</Texte>
      ) : (
        <Feuille style={{ paddingVertical: 0, gap: 0 }}>
          {sent.map((r, i) => (
            <View key={r.id} style={[styles.envoyee, i > 0 && { borderTopWidth: traits.filet, borderTopColor: c.filet }]}>
              <View style={{ flex: 1 }}>
                <Texte variante="texteDemi">{r.vehicle?.name ?? "–"}, {fmtDate(r.date_loading)}</Texte>
                <Texte variante="service" ton="second">{r.client?.name ?? "–"}, {r.route?.name ?? "–"}{r.name ? `, ${r.name}` : ""}</Texte>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Texte variante="libelle">{fmtVolume(r.volume_delivered || r.volume_loaded)} m³</Texte>
                <Tampon mot={STATE_LABEL[r.state]} ton={r.state === "cancelled" ? "danger" : r.state === "draft" ? "warn" : "ok"} />
              </View>
            </View>
          ))}
        </Feuille>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: espaces[4], gap: espaces[3], paddingBottom: espaces[8] },
  entete: { flexDirection: "row", alignItems: "center", gap: espaces[3], flexWrap: "wrap" },
  vide: { paddingVertical: espaces[8], textAlign: "center" },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: espaces[3] },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: espaces[3], borderTopWidth: traits.filet, paddingTop: espaces[3] },
  envoyee: { flexDirection: "row", alignItems: "flex-start", gap: espaces[3], paddingVertical: 14 },
});
