"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Building2, KeyRound, Lock, Mail, Send, Smartphone, UserCog } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, cx, type Tone } from "@/components/ui";
import { EnTete } from "@/components/portail/commun";
import { usePortail } from "@/components/portail/PortailShell";
import { erreurLisible } from "@/components/portail/projet/outils";
import { apiSend, useApi } from "@/lib/api-client";
import type { DossierRef, Profil } from "@/lib/portail-types";

type Contact = { phone: string; email: string };
type Fiche = { phone: string; email: string; street: string; city: string; website: string };

const LIBELLES_FICHE: Record<keyof Fiche, string> = { phone: "Téléphone", email: "Courriel", street: "Adresse", city: "Ville", website: "Site internet" };
const ETAT: Record<DossierRef["state"], { tone: Tone; label: string }> = {
  open: { tone: "ok", label: "En cours" },
  on_hold: { tone: "warn", label: "Suspendu" },
  closed: { tone: "neutral", label: "Clos" },
};

function contactDe(p: Profil): Contact {
  return { phone: p.user.phone ?? "", email: p.user.email ?? "" };
}

function ficheDe(p: Profil): Fiche {
  const e = p.entreprise;
  return { phone: e?.phone ?? "", email: e?.email ?? "", street: e?.street ?? "", city: e?.city ?? "", website: e?.website ?? "" };
}

const nettoie = (s: string) => s.trim().replace(/\s+/g, " ");
const courrielInvalide = (s: string) => Boolean(nettoie(s)) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nettoie(s));

/** Mon profil : mes coordonnées, la demande de mise à jour de la fiche de l'entreprise, mes dossiers. */
export default function MonProfil() {
  const router = useRouter();
  const { espace, dossier, choisir } = usePortail();
  const { data, error, mutate } = useApi<Profil>("/portail/profil");
  const [contact, setContact] = useState<Contact>({ phone: "", email: "" });
  const [fiche, setFiche] = useState<Fiche>({ phone: "", email: "", street: "", city: "", website: "" });
  const [envoi, setEnvoi] = useState<"contact" | "fiche" | null>(null);
  const [erreur, setErreur] = useState<{ ou: "contact" | "fiche"; e: unknown } | null>(null);
  const [retourContact, setRetourContact] = useState<"enregistre" | "transmis" | null>(null);
  const [demande, setDemande] = useState<{ envoyee: boolean; changements: string[] } | null>(null);

  useEffect(() => {
    if (!data) return;
    setContact(contactDe(data));
    setFiche(ficheDe(data));
  }, [data]);

  async function enregistrerContact(e: FormEvent) {
    e.preventDefault();
    if (courrielInvalide(contact.email)) return;
    setEnvoi("contact");
    setErreur(null);
    setRetourContact(null);
    try {
      const p = await apiSend<Profil>("PATCH", "/portail/profil", { user: { phone: nettoie(contact.phone), email: nettoie(contact.email) } });
      await mutate(p, false);
      setRetourContact(p.request_sent ? "transmis" : "enregistre");
    } catch (err) {
      setErreur({ ou: "contact", e: err });
    } finally {
      setEnvoi(null);
    }
  }

  async function demanderMiseAJour(e: FormEvent) {
    e.preventDefault();
    if (!data || courrielInvalide(fiche.email)) return;
    const avant = ficheDe(data);
    const changements = (Object.keys(LIBELLES_FICHE) as Array<keyof Fiche>)
      .filter((k) => nettoie(fiche[k]) !== nettoie(avant[k]))
      .map((k) => `${LIBELLES_FICHE[k]} : ${nettoie(fiche[k]) || "à effacer"}`);
    setEnvoi("fiche");
    setErreur(null);
    setDemande(null);
    try {
      const p = await apiSend<Profil>("PATCH", "/portail/profil", {
        entreprise: { phone: nettoie(fiche.phone), email: nettoie(fiche.email), street: nettoie(fiche.street), city: nettoie(fiche.city), website: nettoie(fiche.website) },
      });
      await mutate(p, false);
      setDemande({ envoyee: Boolean(p.request_sent), changements });
    } catch (err) {
      setErreur({ ou: "fiche", e: err });
    } finally {
      setEnvoi(null);
    }
  }

  if (error) return <ErrorBox error={erreurLisible(error)} onRetry={() => void mutate()} />;
  if (!data) return <Loading label="Chargement de votre profil…" />;

  const contactModifie = JSON.stringify(contact) !== JSON.stringify(contactDe(data));
  const ficheModifiee = (Object.keys(LIBELLES_FICHE) as Array<keyof Fiche>).some((k) => nettoie(fiche[k]) !== nettoie(ficheDe(data)[k]));
  const dossiers = espace?.dossiers ?? [];

  return (
    <div className="space-y-6">
      <EnTete surtitre="Outils" titre="Mon profil" texte="Vos coordonnées, la fiche de votre entreprise et vos dossiers suivis par MB AxisPro Consulting." />

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-7">
          <Card title="Mes coordonnées">
            <form onSubmit={(e) => void enregistrerContact(e)} className="space-y-4" noValidate>
              <div className="flex items-center gap-3 rounded-2xl bg-panel-2 px-4 py-3">
                <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent-doux text-accent">
                  <UserCog className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[14.5px] font-semibold text-ink">{data.user.name}</div>
                  <div className="truncate text-[12.5px] text-muted">Identifiant de connexion : {data.user.login}</div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Téléphone">
                  <Input type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="+224 6xx xx xx xx" />
                </Field>
                <Field label="Courriel" error={courrielInvalide(contact.email) ? "Adresse électronique incomplète." : undefined}>
                  <Input type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="nom@exemple.com" />
                </Field>
              </div>
              <p className="text-[12.5px] leading-snug text-muted">Le cabinet vous joint à ces coordonnées. Votre nom et votre identifiant se changent auprès de votre consultant.</p>
              {erreur?.ou === "contact" && <ErrorBox error={erreurLisible(erreur.e)} />}
              {retourContact === "enregistre" && <Notice tone="ok">Vos coordonnées sont enregistrées.</Notice>}
              {retourContact === "transmis" && <Notice tone="ok">Votre compte est celui de la fiche de l'entreprise : votre demande est transmise à votre consultant, qui mettra la fiche à jour.</Notice>}
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={envoi === "contact"} disabled={!contactModifie || courrielInvalide(contact.email)}>
                  Enregistrer mes coordonnées
                </Button>
              </div>
            </form>
          </Card>

          <Card title="Demander une mise à jour de la fiche de l'entreprise">
            {!data.entreprise ? (
              <Notice tone="neutral">Aucune entreprise n'est encore rattachée à votre dossier. Votre consultant la créera avec vous.</Notice>
            ) : (
              <form onSubmit={(e) => void demanderMiseAJour(e)} className="space-y-4" noValidate>
                <div className="flex items-center gap-3 rounded-2xl bg-panel-2 px-4 py-3">
                  <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[#f8efdc] text-[#7d5c17]">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-semibold text-ink">{data.entreprise.name}</div>
                    <div className="text-[12.5px] text-muted">Fiche tenue par le cabinet</div>
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-ink-2">
                  Cette fiche figure sur les documents du cabinet. Corrigez ce qui a changé : votre consultant reçoit la demande dans votre messagerie, la contrôle et met la fiche à jour.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Téléphone de l'entreprise">
                    <Input type="tel" autoComplete="off" value={fiche.phone} onChange={(e) => setFiche({ ...fiche, phone: e.target.value })} />
                  </Field>
                  <Field label="Courriel de l'entreprise" error={courrielInvalide(fiche.email) ? "Adresse électronique incomplète." : undefined}>
                    <Input type="email" autoComplete="off" value={fiche.email} onChange={(e) => setFiche({ ...fiche, email: e.target.value })} />
                  </Field>
                  <Field label="Adresse" className="sm:col-span-2">
                    <Input autoComplete="off" value={fiche.street} onChange={(e) => setFiche({ ...fiche, street: e.target.value })} placeholder="Quartier, rue, repère" />
                  </Field>
                  <Field label="Ville">
                    <Input autoComplete="off" value={fiche.city} onChange={(e) => setFiche({ ...fiche, city: e.target.value })} placeholder="Conakry" />
                  </Field>
                  <Field label="Site internet">
                    <Input type="url" inputMode="url" autoComplete="off" value={fiche.website} onChange={(e) => setFiche({ ...fiche, website: e.target.value })} placeholder="https://" />
                  </Field>
                </div>
                {erreur?.ou === "fiche" && <ErrorBox error={erreurLisible(erreur.e)} />}
                {demande?.envoyee && (
                  <Notice tone="ok">
                    <div className="font-semibold">Votre demande est transmise à votre consultant, qui mettra la fiche à jour.</div>
                    {demande.changements.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink-2">
                        {demande.changements.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    )}
                    <Link href="/portail/messages" className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
                      Voir dans la messagerie <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Notice>
                )}
                {demande && !demande.envoyee && <Notice tone="neutral">La fiche porte déjà ces informations : aucune demande n'a été envoyée.</Notice>}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {ficheModifiee && (
                    <Button variant="ghost" onClick={() => setFiche(ficheDe(data))}>
                      Annuler mes changements
                    </Button>
                  )}
                  <Button type="submit" variant="primary" loading={envoi === "fiche"} disabled={!ficheModifiee || courrielInvalide(fiche.email)}>
                    <Send className="h-4 w-4" /> Envoyer la demande
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-5">
          <Card title={dossiers.length > 1 ? "Mes dossiers" : "Mon dossier"}>
            {dossiers.length === 0 ? (
              <p className="text-[13.5px] text-muted">Aucun dossier n'est encore ouvert à votre nom.</p>
            ) : (
              <ul className="space-y-3">
                {dossiers.map((d) => {
                  const etat = ETAT[d.state];
                  const actif = d.id === dossier?.id;
                  return (
                    <li key={d.id} className={cx("rounded-2xl border p-4", actif ? "border-accent-vif/40 bg-accent-doux/40" : "border-line")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{d.reference}</span>
                        <Badge tone={etat.tone}>{etat.label}</Badge>
                        {d.unread_messages > 0 && <Badge tone="danger">{d.unread_messages} message{d.unread_messages > 1 ? "s" : ""} non lu{d.unread_messages > 1 ? "s" : ""}</Badge>}
                      </div>
                      <div className="mt-1.5 text-[15px] font-semibold leading-snug text-ink">{d.name}</div>
                      <div className="mt-0.5 text-[12.5px] text-muted">
                        {d.current_gate ? `Étape ${d.current_gate.code} : ${d.current_gate.name}` : "Étape à venir"}
                        {d.sector && ` · ${d.sector}`}
                      </div>
                      {d.consultant && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/70 pt-3 text-[12.5px] text-ink-2">
                          <span>Consultant : <b className="text-ink">{d.consultant.name}</b></span>
                          {d.consultant.phone && (
                            <a href={`tel:${d.consultant.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                              <Smartphone className="h-3.5 w-3.5" /> {d.consultant.phone}
                            </a>
                          )}
                          {d.consultant.email && (
                            <a href={`mailto:${d.consultant.email}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                              <Mail className="h-3.5 w-3.5" /> Courriel
                            </a>
                          )}
                        </div>
                      )}
                      {!actif && (
                        <button
                          type="button"
                          onClick={() => {
                            choisir(d.id);
                            router.push("/portail");
                          }}
                          className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline"
                        >
                          Ouvrir ce dossier <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Sécurité du compte">
            <Link href="/compte/mot-de-passe" className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-panel-2">
              <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-accent-doux text-accent">
                <KeyRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">Changer mon mot de passe</span>
                <span className="block text-[12.5px] text-muted">Choisissez une phrase longue, propre à ce portail.</span>
              </span>
              <ArrowRight className="h-4 w-4 text-muted" />
            </Link>
            <div className="mt-4 flex gap-3 rounded-2xl bg-panel-2 px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
              <Lock className="mt-0.5 h-4 w-4 flex-none text-accent" />
              <p>
                Vos informations et les pièces de votre dossier ne sont visibles que de vous et de l'équipe MB AxisPro Consulting qui vous accompagne. Gardez votre mot de passe pour vous : le cabinet ne vous le demandera jamais.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
