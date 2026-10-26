/**
 * Gestes que le verrou de la tablette ne voit pas : la frappe au clavier du système ne passe pas par
 * les touchers de l'écran. Les champs de saisie la signalent ici (auth/Verrou.tsx l'écoute).
 */
const auditeurs = new Set<() => void>();

export function signalerActivite(): void {
  for (const f of auditeurs) f();
}

export function ecouterActivite(f: () => void): () => void {
  auditeurs.add(f);
  return () => {
    auditeurs.delete(f);
  };
}
