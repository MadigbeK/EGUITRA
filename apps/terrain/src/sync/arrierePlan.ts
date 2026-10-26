import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { ApiClient } from "../api/client";
import { coffreJeton, profilGarde } from "../auth/coffre";
import { API_URL } from "../config";
import { appareil } from "../hsseq/appareil";
import { envoyerFiches } from "../hsseq/envoi";
import { sqliteStore } from "../store/sqlite";
import { envoyerRotations } from "./outbox";

/**
 * Envoi en arrière-plan (système « terrain », § 3.7) : application fermée ou en veille, Android la
 * réveille au plus toutes les 15 minutes (WorkManager) et la file d'envoi part sous la session gardée
 * au coffre. Une session finie au bureau est oubliée, comme au premier plan ; les saisies restent.
 */
const TACHE = "nimova-terrain-envoi";

/** Un seul envoi à la fois, au premier plan (sync/Envoi.tsx) comme en arrière-plan. */
export const verrouEnvoi = { pris: false };

export async function envoyerEnArrierePlan(): Promise<void> {
  if (verrouEnvoi.pris || !API_URL) return;
  const user = (await coffreJeton.lire()) ? await profilGarde.lire() : null;
  if (!user) return;
  verrouEnvoi.pris = true;
  try {
    const store = sqliteStore();
    const api = new ApiClient({ base: API_URL, coffre: coffreJeton, surSessionPerdue: () => undefined });
    const rotations = await envoyerRotations(store, api, user.id);
    if (!rotations?.echec) await envoyerFiches(store, api, appareil, user.id);
  } finally {
    verrouEnvoi.pris = false;
  }
}

if (Platform.OS !== "web") {
  TaskManager.defineTask(TACHE, async () => {
    try {
      await envoyerEnArrierePlan();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Inscription de la tâche, une fois la session ouverte ; sans effet dans un navigateur. */
export async function inscrireEnvoiArrierePlan(): Promise<void> {
  if (Platform.OS === "web" || !API_URL) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(TACHE)) return;
    await BackgroundTask.registerTaskAsync(TACHE, { minimumInterval: 15 });
  } catch {
    // Appareil sans tâches de fond (mode économie d'énergie forcé) : l'envoi se fait au premier plan.
  }
}
