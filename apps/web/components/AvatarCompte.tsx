"use client";

import { useState, type CSSProperties } from "react";
import { cx } from "@/components/ui";
import { initiales } from "@/lib/discussions";

/**
 * Photo d'un compte (discussion, agenda, bandeau du compte connecté), à défaut ses initiales.
 *
 * Le noyau joint à chaque compte cité la version de sa photo (« avatar ») : null sans vraie photo (l'avatar
 * dessiné que le noyau donne à tout compte n'en est pas une). L'image est lue par la passerelle
 * (/api/odoo/users/{id}/avatar), avec une empreinte et un cache privé revalidé à chaque affichage : les
 * droits sont revérifiés (même société, compte interne), sans retransférer une photo inchangée. La version
 * dans l'adresse change avec la photo. Image refusée ou introuvable : les initiales restent.
 *
 * La pastille garde les classes de chaque écran (dimensions, couleur, police des initiales) : la photo la
 * remplit exactement, sans rien changer à la mise en page.
 */

/** Adresse de la photo d'un compte (128 pixels : vignettes et pastilles ; 512 : grand format). */
export function cheminAvatar(id: number, version: string, taille: 128 | 512 = 128): string {
  return `/api/odoo/users/${id}/avatar?size=${taille}&v=${encodeURIComponent(version)}`;
}

export function AvatarCompte({
  id,
  nom,
  avatar,
  className,
  style,
  texte,
}: {
  /** Compte (null : contact ou adresse sans compte, initiales seules). */
  id?: number | null;
  nom: string;
  /** Version de la photo rendue par le noyau ; null ou absente : initiales. */
  avatar?: string | null;
  /** Classes de la pastille d'initiales de l'écran (dimensions, fond, police). */
  className?: string;
  style?: CSSProperties;
  /** Initiales calculées par l'écran, quand il a sa propre règle. */
  texte?: string;
}) {
  const src = id && avatar ? cheminAvatar(id, avatar) : null;
  const [echec, setEchec] = useState<string | null>(null);
  const photo = src !== null && echec !== src;
  return (
    <span aria-hidden className={cx("relative overflow-hidden", className)} style={style}>
      {texte ?? initiales(nom)}
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- photo servie par la passerelle (droits revérifiés), hors de l'optimiseur d'images
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setEchec(src)}
          className="absolute inset-0 h-full w-full rounded-[inherit] object-cover"
        />
      )}
    </span>
  );
}
