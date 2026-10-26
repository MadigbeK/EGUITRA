import { createContext, useContext, useState } from "react";
import { View } from "react-native";
import { adresseValide, CHOIX_SERVEUR, enSimulation, libelleServeur, type Serveur } from "../serveur";
import { Bandeau, Bouton, Champ, Texte } from "../ui/elements";
import { espaces } from "../ui/terrain";

/** Changement de serveur, fourni par la racine (app/_layout.tsx) : la session repart de zéro. */
const Contexte = createContext<(s: Serveur) => Promise<void>>(async () => undefined);
export const FournisseurServeur = Contexte.Provider;

/**
 * Choix du serveur à l'écran de connexion, en version de démonstration seulement : le bureau simulé
 * embarqué, ou l'adresse d'un bureau (la recette, dès que son entrée native est prête). Chaque
 * serveur garde ses saisies et sa session à part sur l'appareil (src/serveur.ts).
 */
export function ChoixDuServeur() {
  const changer = useContext(Contexte);
  const [ouvert, setOuvert] = useState(false);
  const [adresse, setAdresse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [travail, setTravail] = useState(false);
  if (!CHOIX_SERVEUR) return null;

  async function utiliser(s: Serveur) {
    if (travail) return;
    setTravail(true);
    setErreur(null);
    try {
      await changer(s);
    } catch {
      setErreur("Ce serveur n'a pas pu être enregistré sur l'appareil : réessayez.");
      setTravail(false);
    }
  }

  const valide = adresseValide(adresse);
  return (
    <View style={{ gap: espaces[3] }}>
      <Texte variante="service" ton="second">Serveur : {libelleServeur()}</Texte>
      {!ouvert ? (
        <Bouton titre="Changer de serveur" variante="discret" onPress={() => setOuvert(true)} />
      ) : (
        <>
          {erreur ? <Bandeau ton="danger" texte={erreur} /> : null}
          {!enSimulation() ? (
            <Bouton titre="Démonstration (bureau simulé)" variante="secondaire" chargement={travail} onPress={() => void utiliser({ mode: "simulation" })} />
          ) : null}
          <Champ
            libelle="Adresse d'un bureau"
            aide="Fournie par l'administrateur, par exemple https://recette.exemple.com/api/natif."
            value={adresse}
            onChangeText={setAdresse}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            erreur={adresse.trim() && !valide ? "Adresse en https:// attendue." : undefined}
          />
          <Bouton titre="Utiliser cette adresse" variante="secondaire" desactive={!valide} chargement={travail} onPress={() => valide && void utiliser({ mode: "bureau", url: valide })} />
          <Bouton titre="Fermer" variante="discret" onPress={() => setOuvert(false)} />
        </>
      )}
    </View>
  );
}
