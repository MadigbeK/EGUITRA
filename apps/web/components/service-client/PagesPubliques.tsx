"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Etoiles } from "@/components/service-client/commun";
import { Button, Field, Input, Notice, PasswordInput, Textarea, classesBouton } from "@/components/ui";

/** Appel d'une route publique du service client (relais /api/service-client, sans session). */
async function publier(chemin: string, corps?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`/api/service-client/${chemin}`, corps === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

const message = (data: Record<string, unknown>, defaut: string) => (typeof data.message === "string" ? data.message : defaut);

function Cadre({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-[480px] px-6 py-16 text-ink">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Espace client</p>
      <h1 className="mt-2 font-display text-[26px] font-bold leading-tight">{titre}</h1>
      <div className="mt-6 space-y-4">{children}</div>
    </main>
  );
}

/** Invitation à l'espace client : le client choisit son mot de passe (et donne son code s'il a déjà la double authentification). */
export function Invitation({ jeton }: { jeton: string }) {
  const [info, setInfo] = useState<{ name: string; login: string; company: string; kind: string; mfa_required: boolean } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [mdp, setMdp] = useState("");
  const [mdp2, setMdp2] = useState("");
  const [code, setCode] = useState("");
  const [fait, setFait] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    publier("invitation/verifier", { token: jeton }).then(({ ok, data }) => {
      if (ok) setInfo(data as unknown as typeof info);
      else setErreur(message(data, "Lien d'invitation inconnu ou expiré."));
    }).catch(() => setErreur("Service momentanément indisponible."));
  }, [jeton]);

  async function valider() {
    setEnvoi(true);
    setErreur(null);
    const { ok, data } = await publier("invitation/accepter", { token: jeton, password: mdp, code: code || undefined }).catch(() => ({ ok: false, status: 503, data: {} }));
    setEnvoi(false);
    if (ok) setFait(true);
    else setErreur(message(data, "Le mot de passe n'a pas pu être enregistré."));
  }

  if (fait) {
    return (
      <Cadre titre="Mot de passe enregistré">
        <Notice tone="ok">Votre mot de passe est enregistré. Connectez-vous avec votre identifiant {info?.login}.</Notice>
        <Link href="/login?app=espace-client" className={classesBouton("primary")}>Se connecter</Link>
      </Cadre>
    );
  }
  return (
    <Cadre titre={info?.kind === "reset" ? "Nouveau mot de passe" : "Bienvenue dans votre espace client"}>
      {info && <p className="text-[14px] text-ink-2">{info.name}, le service client de {info.company} vous ouvre un espace pour déposer et suivre vos demandes. Identifiant : <strong>{info.login}</strong>.</p>}
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {info && (
        <>
          <Field label="Mot de passe" hint="10 caractères au moins ; évitez votre nom et votre identifiant.">
            <PasswordInput value={mdp} onChange={(e) => setMdp(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Mot de passe, une seconde fois" error={mdp2 && mdp2 !== mdp ? "Les deux saisies diffèrent." : undefined}>
            <PasswordInput value={mdp2} onChange={(e) => setMdp2(e.target.value)} autoComplete="new-password" />
          </Field>
          {info.mfa_required && (
            <Field label="Code de votre application d'authentification" hint="Six chiffres, comme à la connexion.">
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={7} autoComplete="one-time-code" />
            </Field>
          )}
          <Button variant="primary" loading={envoi} disabled={mdp.length < 10 || mdp !== mdp2 || (info.mfa_required && code.replace(/\s/g, "").length !== 6)} onClick={valider}>
            Enregistrer mon mot de passe
          </Button>
          <p className="text-[12.5px] text-muted">À la première connexion, une application d&apos;authentification sur votre téléphone vous sera demandée pour sécuriser votre compte.</p>
        </>
      )}
    </Cadre>
  );
}

/** Satisfaction par le lien du courriel : une note de 1 à 5 et un commentaire, une fois. */
export function Satisfaction({ jeton }: { jeton: string }) {
  const [info, setInfo] = useState<{ name: string; subject: string; company: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [note, setNote] = useState<number | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [fait, setFait] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    publier(`satisfaction/${jeton}`).then(({ ok, data }) => {
      if (ok) setInfo(data as unknown as typeof info);
      else setErreur(message(data, "Lien inconnu ou expiré."));
    }).catch(() => setErreur("Service momentanément indisponible."));
  }, [jeton]);
  async function envoyer() {
    setEnvoi(true);
    setErreur(null);
    const { ok, data } = await publier(`satisfaction/${jeton}`, { score: note, comment: commentaire }).catch(() => ({ ok: false, status: 503, data: {} }));
    setEnvoi(false);
    if (ok) setFait(true);
    else setErreur(message(data, "Votre avis n'a pas pu être enregistré."));
  }
  if (fait) return <Cadre titre="Merci pour votre avis"><Notice tone="ok">Votre avis est enregistré. Le service client reste à votre écoute.</Notice></Cadre>;
  return (
    <Cadre titre="Votre avis sur notre réponse">
      {info && <p className="text-[14px] text-ink-2">Demande {info.name}, « {info.subject} », traitée par le service client de {info.company}.</p>}
      {erreur && <Notice tone="danger">{erreur}</Notice>}
      {info && (
        <>
          <Etoiles valeur={note} onChange={setNote} taille="text-[34px]" />
          <Textarea rows={3} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Un commentaire (facultatif)" maxLength={2000} />
          <Button variant="primary" disabled={!note} loading={envoi} onClick={envoyer}>
            Envoyer mon avis
          </Button>
        </>
      )}
    </Cadre>
  );
}
