"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, Field, Input, Notice, PageHeader } from "@/components/ui";
import type { AppCode } from "@/lib/config";

export function PasswordForm({ app, required = false }: { app: AppCode; required?: boolean }) {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError("Les deux saisies du nouveau mot de passe diffèrent.");
    if (newPassword.length < 10) return setError("Le mot de passe doit contenir au moins 10 caractères.");
    setBusy(true);
    const res = await fetch("/api/session/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return setError(data.message ?? "Modification impossible.");
    window.location.href = `/login?app=${app}&message=password_changed`;
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="Mot de passe" subtitle="10 caractères minimum. Toutes vos sessions seront fermées." />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {required && <Notice tone="warn">Votre mot de passe est provisoire : choisissez le vôtre pour continuer.</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Mot de passe actuel">
            <Input type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required />
          </Field>
          <Field label="Nouveau mot de passe">
            <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} required />
          </Field>
          <Field label="Confirmation">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Enregistrer le nouveau mot de passe
          </Button>
        </form>
      </Card>
    </div>
  );
}
