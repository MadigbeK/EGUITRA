import { ScrollView, StyleSheet, View } from "react-native";
import type { Referentials } from "../api/types";
import { fmtDate, fmtM3, fmtVolume, pluriel, quand } from "../format";
import type { QueuedItem } from "../store/types";
import { Bandeau, Bouton, Feuille, Texte, demanderConfirmation } from "../ui/elements";
import { couleurs, espaces, rayons } from "../ui/theme";
import { STATE_LABEL } from "./form";
import type { Rotations } from "./useRotations";

function nom(refs: Referentials | null | undefined, kind: "vehicles" | "clients" | "routes", id: unknown): string {
  const list: Array<{ id: number; name: string }> = refs?.[kind] ?? [];
  return list.find((x) => x.id === Number(id))?.name ?? "–";
}

/** Saisies en attente de l'utilisateur : envoi à la demande, correction, suppression. */
export function ListeAttente({ rot, onCorriger }: { rot: Rotations; onCorriger: (item: QueuedItem) => void }) {
  const aEnvoyer = rot.mine.length;
  async function supprimer(item: QueuedItem) {
    if (!(await demanderConfirmation("Supprimer cette saisie de l'appareil ? Elle ne sera pas transmise.", { action: "Supprimer", danger: true }))) return;
    await rot.supprimer(item.client_uuid);
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.entete}>
        <Texte variante="aide" ton="discret" style={{ flex: 1 }}>
          {rot.lastSync ? `Dernier envoi : ${quand(rot.lastSync)}` : "Les saisies partent seules dès que le réseau revient."}
        </Texte>
        <Bouton titre="Envoyer" variante="secondaire" chargement={rot.syncing} desactive={!rot.online || !aEnvoyer} onPress={() => void rot.sync("envoi")} />
      </View>
      {aEnvoyer === 0 ? <Texte ton="discret" style={styles.vide}>Toutes vos saisies ont été transmises.</Texte> : null}
      {rot.mine.map((item) => {
        const refusee = item.status === "error";
        return (
          <Feuille key={item.client_uuid} style={refusee ? styles.refusee : undefined}>
            <View style={styles.ligne}>
              <View style={{ flex: 1 }}>
                <Texte variante="fort">{nom(rot.refs, "vehicles", item.payload.vehicle_id)}, {fmtDate(item.payload.date_loading)}</Texte>
                <Texte variante="aide" ton="discret">{nom(rot.refs, "clients", item.payload.partner_id)}, {nom(rot.refs, "routes", item.payload.route_id)}</Texte>
              </View>
              <Etat texte={refusee ? "Refusée" : "En attente"} ton={refusee ? "danger" : "attention"} />
            </View>
            <Texte variante="chiffre" style={{ fontSize: 26 }}>{fmtM3(item.payload.volume_loaded ?? item.payload.volume_delivered)}</Texte>
            {item.message ? <Texte variante="fort" ton="danger">{item.message}</Texte> : null}
            <View style={styles.actions}>
              <Bouton titre="Corriger" variante="discret" desactive={!rot.refs} onPress={() => onCorriger(item)} />
              <Bouton titre="Supprimer" variante="danger" onPress={() => void supprimer(item)} />
            </View>
          </Feuille>
        );
      })}
      {rot.others > 0 ? (
        <Texte variante="aide" ton="discret">
          {pluriel(rot.others, "saisie")} d'un autre utilisateur {rot.others > 1 ? "restent sur cet appareil : elles partiront" : "reste sur cet appareil : elle partira"} à sa prochaine connexion.
        </Texte>
      ) : null}
    </ScrollView>
  );
}

/** Dernières rotations reçues au bureau, gardées pour la consultation sans réseau. */
export function ListeEnvoyees({ rot }: { rot: Rotations }) {
  const sent = rot.sent;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {!rot.online ? <Bandeau ton="attention" texte="Hors réseau : dernière liste connue." /> : null}
      {sent === null ? (
        rot.sentIndisponible
          ? <Bandeau ton="attention" texte="Liste indisponible : le bureau n'a pas pu être joint. Elle s'affichera au retour du réseau." />
          : <Texte ton="discret" style={styles.vide}>Chargement des rotations…</Texte>
      ) : sent.length === 0 ? (
        <Texte ton="discret" style={styles.vide}>Aucune rotation.</Texte>
      ) : (
        <Feuille style={{ paddingVertical: 0, gap: 0 }}>
          {sent.map((r, i) => (
            <View key={r.id} style={[styles.envoyee, i > 0 && styles.separateur]}>
              <View style={{ flex: 1 }}>
                <Texte variante="fort">{r.vehicle?.name ?? "–"}, {fmtDate(r.date_loading)}</Texte>
                <Texte variante="aide" ton="discret">{r.client?.name ?? "–"}, {r.route?.name ?? "–"}{r.name ? `, ${r.name}` : ""}</Texte>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Texte variante="chiffre" style={{ fontSize: 19 }}>{fmtVolume(r.volume_delivered || r.volume_loaded)} m³</Texte>
                <Etat texte={STATE_LABEL[r.state]} ton={r.state === "cancelled" ? "danger" : r.state === "draft" ? "attention" : "ok"} />
              </View>
            </View>
          ))}
        </Feuille>
      )}
    </ScrollView>
  );
}

const ETAT = {
  ok: [couleurs.okDoux, couleurs.okTexte],
  attention: [couleurs.attentionDoux, couleurs.attention],
  danger: [couleurs.dangerDoux, couleurs.danger],
} as const;

/** Tampon d'état d'une saisie ou d'une rotation. */
function Etat({ texte, ton }: { texte: string; ton: keyof typeof ETAT }) {
  const [fond, encre] = ETAT[ton];
  return (
    <View style={[styles.etat, { backgroundColor: fond }]}>
      <Texte variante="libelle" style={{ color: encre }}>{texte}</Texte>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: espaces.l, gap: espaces.m, paddingBottom: espaces.xxl },
  entete: { flexDirection: "row", alignItems: "center", gap: espaces.m },
  vide: { paddingVertical: espaces.xxl, textAlign: "center" },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: espaces.m },
  refusee: { borderColor: couleurs.danger, borderWidth: 2 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: espaces.s, borderTopWidth: 1, borderTopColor: couleurs.ligne, paddingTop: espaces.m },
  envoyee: { flexDirection: "row", alignItems: "flex-start", gap: espaces.m, paddingVertical: 14 },
  separateur: { borderTopWidth: 1, borderTopColor: couleurs.ligne },
  etat: { borderRadius: rayons.pastille, paddingHorizontal: 10, paddingVertical: 3 },
});
