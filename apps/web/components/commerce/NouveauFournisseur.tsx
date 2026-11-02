"use client";

/**
 * Nouveau fournisseur depuis le bon de commande : nom obligatoire, NIF, RCCM, téléphone, courriel, adresse,
 * ville et contact facultatifs. Avant de créer, le noyau cherche un doublon probable (même nom une fois
 * réduit, ou même NIF) : la fenêtre propose de reprendre la fiche trouvée, ou de créer malgré tout. La fiche
 * créée est celle d'un fournisseur, enregistrée aussitôt et choisie dans le bon. Mêmes droits que la création
 * rapide d'un tiers (POST /finance/partners).
 */

import { useState, type ChangeEvent } from "react";
import { Button, Field, Input, Modal, Notice } from "@/components/ui";
import { ApiError, apiSend } from "@/lib/api-client";
import type { Partner } from "@/lib/finance-types";

interface Saisie {
  name: string;
  vat: string;
  rccm: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  contact: string;
}

export function NouveauFournisseur({ nom, onClose, onChoisi }: { nom: string; onClose: () => void; onChoisi: (p: { id: number; name: string }) => void }) {
  const [f, setF] = useState<Saisie>({ name: nom, vat: "", rccm: "", phone: "", email: "", street: "", city: "", contact: "" });
  const [doublons, setDoublons] = useState<Partner[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const courrielInvalide = f.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const pret = f.name.trim() !== "" && !courrielInvalide && !busy;

  async function creer(force: boolean) {
    if (!pret) return;
    setBusy(true);
    setErreur(null);
    try {
      const corps: Record<string, unknown> = { supplier: true, is_company: true, check_duplicates: true, force };
      for (const [cle, valeur] of Object.entries(f)) if (valeur.trim()) corps[cle] = valeur.trim();
      const partner = await apiSend<Partner>("POST", "/finance/partners", corps);
      onChoisi({ id: partner.id, name: partner.name });
    } catch (e) {
      const trouves = e instanceof ApiError && e.status === 409 ? (e.body as unknown as { duplicates?: Partner[] }).duplicates : undefined;
      if (trouves?.length) setDoublons(trouves);
      else setErreur(e instanceof ApiError ? `Création impossible : ${e.message}` : "Création impossible : vérifiez la connexion, puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  const champ = (cle: keyof Saisie) => ({ value: f[cle], onChange: (e: ChangeEvent<HTMLInputElement>) => { setF({ ...f, [cle]: e.target.value }); setDoublons(null); } });

  return (
    <Modal open wide title="Nouveau fournisseur" onClose={onClose} footer={
      <div className="flex flex-wrap gap-2">
        <Button onClick={onClose}>Annuler</Button>
        {doublons ? (
          <Button variant="primary" loading={busy} disabled={!pret} onClick={() => void creer(true)}>Créer quand même une nouvelle fiche</Button>
        ) : (
          <Button variant="primary" loading={busy} disabled={!pret} onClick={() => void creer(false)}>Enregistrer le fournisseur</Button>
        )}
      </div>
    }>
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        {doublons && (
          <Notice tone="warn">
            <div className="mb-2">Fournisseur probablement déjà enregistré (même nom ou même NIF). Reprenez la fiche existante plutôt que d&apos;en créer une seconde :</div>
            <ul className="space-y-1.5">
              {doublons.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{p.name}{p.vat ? ` · NIF ${p.vat}` : ""}{p.city ? ` · ${p.city}` : ""}{p.phone ? ` · ${p.phone}` : ""}</span>
                  <Button size="sm" onClick={() => onChoisi({ id: p.id, name: p.name })}>Reprendre cette fiche</Button>
                </li>
              ))}
            </ul>
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Raison sociale ou nom" className="md:col-span-2"><Input autoFocus {...champ("name")} /></Field>
          <Field label="NIF" hint="Facultatif"><Input {...champ("vat")} /></Field>
          <Field label="RCCM" hint="Facultatif"><Input {...champ("rccm")} /></Field>
          <Field label="Téléphone" hint="Facultatif"><Input inputMode="tel" {...champ("phone")} /></Field>
          <Field label="Courriel" hint="Facultatif : le bon de commande peut lui être envoyé." error={courrielInvalide ? "Adresse illisible." : undefined}><Input type="email" {...champ("email")} /></Field>
          <Field label="Adresse" hint="Facultatif"><Input {...champ("street")} /></Field>
          <Field label="Ville" hint="Facultatif"><Input {...champ("city")} /></Field>
          <Field label="Personne à contacter" hint="Facultatif" className="md:col-span-2"><Input {...champ("contact")} /></Field>
        </div>
        <p className="text-[12.5px] text-muted">La fiche est enregistrée tout de suite dans la base des fournisseurs et choisie dans le bon de commande. Les conditions de paiement du fournisseur restent tenues par la finance.</p>
      </div>
    </Modal>
  );
}
