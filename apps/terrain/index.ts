/**
 * Entrée de l'application. La tâche d'envoi en arrière-plan se déclare avant tout écran : Android
 * réveille l'application sans interface pour envoyer la file, et la tâche doit alors exister.
 */
import "./src/sync/arrierePlan";
import "expo-router/entry";
