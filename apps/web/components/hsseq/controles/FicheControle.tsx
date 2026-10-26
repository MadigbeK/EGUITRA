"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Etat, Loading, Notice, Tag, cx } from "@/components/ui";
import { MotifCode, NATURE_CONTROLE, REPONSE_POINT, RESULTAT_CONTROLE, STATUT_NON_CONFORMITE, Tampon, TYPE_VEHICULE, nomRotation } from "@/components/hsseq/commun";
import { useApi } from "@/lib/api-client";
import { fmtDateTime, pluriel } from "@/lib/format";
import type { Check, CheckAnswer, Nonconformity } from "@/lib/hsseq-types";
import { Definitions, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { DUREE_CIBLE_S, PhotoManquante, fmtDuree } from "./elements";
import { LeverNonConformite } from "./Levee";

/** Coordonnées GPS lisibles, précision en mètres. */
function position(c: Check): string | null {
  if (c.latitude === null || c.longitude === null) return null;
  const f = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  return `${f(c.latitude)}, ${f(c.longitude)}${c.gps_accuracy !== null ? ` (à ${Math.round(c.gps_accuracy)} m près)` : ""}`;
}

/**
 * Fiche d'un contrôle avant départ : réponses point par point (points bloquants marqués, photos),
 * saisie de terrain (heure de saisie et de réception, hors ligne, durée, position, signature),
 * non-conformités et leur levée. Une non-conformité bloquante ouverte bloque le véhicule (V02).
 */
export function FicheControle({ id, onFermer }: { id: number; onFermer: () => void }) {
  const { data: c, error, mutate } = useApi<Check>(`/hsseq/checks/${id}`);
  const [levee, setLevee] = useState<Nonconformity | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!c) {
    return (
      <Panneau etiquette="Contrôle" titre="Contrôle" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement du contrôle…" />}
      </Panneau>
    );
  }

  const lieu = position(c);
  const ncOuvertes = c.nonconformities.filter((n) => n.status === "open");
  const bloquantesOuvertes = ncOuvertes.filter((n) => n.item.blocking);
  const signature = c.signature;
  const points = [...c.answers];
  const nonConformes = points.filter((p) => p.answer === "not_ok").length;

  return (
    <Panneau
      etiquette={NATURE_CONTROLE[c.kind]}
      titre={c.reference}
      onFermer={onFermer}
      sousTitre={`${c.template.name}, version ${c.template.version}, ${TYPE_VEHICULE[c.vehicle_kind].toLocaleLowerCase("fr")}`}
      tampons={
        <>
          <Tampon mot={RESULTAT_CONTROLE[c.result]} />
          {bloquantesOuvertes.length > 0 && <MotifCode code="V02" />}
          {c.photos_missing && <PhotoManquante pluriel />}
          {c.offline && <Tag>Saisi hors ligne</Tag>}
        </>
      }
    >
      {message && <Notice tone="ok">{message}</Notice>}
      {bloquantesOuvertes.length > 0 && (
        <Notice tone="danger">
          Départ de {c.vehicle.name} bloqué (motif V02) : {pluriel(bloquantesOuvertes.length, "non-conformité bloquante ouverte", "non-conformités bloquantes ouvertes")}. Le blocage suit le véhicule d&apos;une rotation à l&apos;autre, jusqu&apos;à la levée, avec une photo de la correction, par le chef de parc du site, le Responsable HSSEQ ou l&apos;administration.
        </Notice>
      )}
      {c.photos_missing && <Notice tone="warn">Photos manquantes : au moins une non-conformité attend encore sa photo, envoyée par NIMOVA Terrain après le contrôle. La photo reste exigée.</Notice>}
      {c.complement_of && (
        <Notice>
          Contrôle complémentaire de{" "}
          <Link href={`/hsseq/controles?controle=${c.complement_of.id}`} className="font-semibold underline-offset-2 hover:underline">
            {c.complement_of.reference}
          </Link>
          {" "}: il répond aux points ajoutés à la grille après la saisie du contrôle d&apos;origine.
        </Notice>
      )}
      {c.awaiting_items.length > 0 && (
        <Notice tone={c.awaiting_items.some((a) => a.blocking) ? "danger" : "warn"}>
          {pluriel(c.awaiting_items.length, "point ajouté", "points ajoutés")} à la grille après la saisie, à répondre par un contrôle complémentaire dans NIMOVA Terrain
          {c.awaiting_items.some((a) => a.blocking) ? " ; tant que les points bloquants n'ont pas de réponse, le départ reste retenu (motif V01)" : ""} : {c.awaiting_items.map((a) => `${a.label}${a.blocking ? " (bloquant)" : ""}`).join(", ")}.
        </Notice>
      )}

      <Definitions
        lignes={[
          ["Véhicule", `${c.vehicle.name}${c.vehicle.plate ? ` (${c.vehicle.plate})` : ""}, ${TYPE_VEHICULE[c.vehicle.vehicle_kind].toLocaleLowerCase("fr")}`],
          ["Rotation", c.rotation ? `${nomRotation(c.rotation)}${c.rotation.route_name ? `, ${c.rotation.route_name}` : ""}` : "Sans rotation"],
          ["Conducteur", c.driver?.name ?? "Non renseigné"],
          ["Grille", `${c.template.name}, version ${c.template.version}`],
          ["Saisi par", c.author?.name ?? "Non renseigné"],
          c.site && ["Site", c.site.name],
          ["Saisi sur l'appareil", fmtDateTime(c.reported_at)],
          ["Reçu par le serveur", `${fmtDateTime(c.synced_at)}${c.offline ? ", après une saisie hors ligne" : ""}`],
          c.duration_s !== null && [
            "Durée de saisie",
            <span key="d" className={cx(c.duration_s > DUREE_CIBLE_S && "font-semibold text-warn")}>
              {fmtDuree(c.duration_s)}
              {c.duration_s > DUREE_CIBLE_S && <span className="font-normal text-muted">, au-delà de l&apos;objectif de 4 minutes</span>}
            </span>,
          ],
          lieu && ["Position", lieu],
          [
            "Signature",
            signature ? (
              <Pieces key="s" pieces={[signature]} />
            ) : (
              "Sans signature"
            ),
          ],
        ]}
      />

      <Rubrique titre={`Réponses point par point (${points.length})`}>
        <p className="mb-2.5 text-[12.5px] text-muted">
          {nonConformes ? `${pluriel(nonConformes, "point non conforme", "points non conformes")} sur ${points.length}.` : "Tous les points répondus sont conformes."} Les points critiques sont bloquants : non conformes, ils bloquent le départ.
        </p>
        <ol className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
          {points.map((p) => (
            <Point key={p.item_id} p={p} />
          ))}
        </ol>
      </Rubrique>

      {c.complements.length > 0 && (
        <Rubrique titre={`Contrôles complémentaires (${c.complements.length})`}>
          <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
            {c.complements.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[13px]">
                <Link href={`/hsseq/controles?controle=${k.id}`} className="font-semibold text-accent underline-offset-2 hover:underline">
                  {k.reference}
                </Link>
                <span className="text-muted">{fmtDateTime(k.reported_at)}</span>
                <Tampon mot={RESULTAT_CONTROLE[k.result]} />
              </li>
            ))}
          </ul>
        </Rubrique>
      )}

      {c.nonconformities.length > 0 && (
        <Rubrique titre={`Non-conformités (${c.nonconformities.length})`}>
          <ul className="space-y-3">
            {c.nonconformities.map((n) => (
              <LigneNc key={n.id} n={n} onLever={() => setLevee(n)} />
            ))}
          </ul>
        </Rubrique>
      )}

      {levee && (
        <LeverNonConformite
          nc={levee}
          onClose={() => setLevee(null)}
          onLevee={(maj) => {
            setLevee(null);
            void mutate(maj, { revalidate: false });
            setMessage(!maj.nonconformities.some((x) => x.status === "open" && x.item.blocking) && levee.item.blocking ? `Non-conformité levée : plus aucune non-conformité bloquante ouverte sur ${maj.vehicle.name} dans ce contrôle.` : "Non-conformité levée.");
          }}
        />
      )}
    </Panneau>
  );
}

/** Un point de la grille : réponse en tampon, point critique marqué, commentaire et photos. */
function Point({ p }: { p: CheckAnswer }) {
  const bloque = p.blocking && p.answer === "not_ok";
  return (
    <li className={cx("px-3.5 py-2.5", bloque && "bg-danger-doux/60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] leading-snug text-ink">{p.label}</p>
          {p.blocking && <p className="mt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">Point critique</p>}
        </div>
        <span className="flex-none">{bloque ? <Tampon mot="Bloquant" /> : <Tampon mot={REPONSE_POINT[p.answer]} />}</span>
      </div>
      {p.comment && <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{p.comment}</p>}
      {p.photos.length > 0 && (
        <div className="mt-2">
          <Pieces pieces={p.photos} />
        </div>
      )}
      {bloque && <span className="sr-only">Point critique non conforme : départ bloqué (V02).</span>}
    </li>
  );
}

/** Non-conformité d'un contrôle : constat, photos, levée. */
function LigneNc({ n, onLever }: { n: Nonconformity; onLever: () => void }) {
  return (
    <li className="rounded-[12px] border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold leading-snug text-ink">{n.item.label}</p>
          <p className="mt-0.5 text-[12px] text-muted">Constatée le {fmtDateTime(n.found_at)}</p>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          {n.item.blocking && n.status === "open" && <Tampon mot="Bloquante" />}
          <Tampon mot={STATUT_NON_CONFORMITE[n.status]} />
        </span>
      </div>
      {n.comment && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{n.comment}</p>}
      <div className="mt-2">
        <Pieces pieces={n.photos} vide={<PhotoManquante />} />
      </div>
      {n.status === "lifted" && (
        <div className="mt-2.5 space-y-1.5 border-t border-line pt-2.5 text-[12.5px]">
          <p className="text-ink-2">
            Levée le {fmtDateTime(n.lifted_at)}
            {n.lifted_by ? ` par ${n.lifted_by.name}` : ""}
            {n.lift_comment ? ` : ${n.lift_comment}` : ""}
          </p>
          <Pieces pieces={n.lift_photos} />
        </div>
      )}
      {(n.action || (n.status === "open" && n.rights.can_close)) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {n.status === "open" && n.rights.can_close && (
            <Button size="sm" variant="primary" onClick={onLever} aria-label={`Lever la non-conformité « ${n.item.label} »`}>
              Lever
            </Button>
          )}
          {n.action && (
            <Link href={`/hsseq/actions?action=${n.action.id}`} className="text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline">
              Action {n.action.name}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
