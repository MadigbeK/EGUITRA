/** Assemblage de classes CSS, utilisable côté serveur comme côté client. */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
