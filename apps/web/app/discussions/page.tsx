"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Messagerie, type Vue } from "@/components/discussions/Messagerie";
import { Loading, PageHeader } from "@/components/ui";

/**
 * Discussion interne en pleine page : liste des conversations et fil côte à côte sur grand écran, une
 * vue à la fois sur le téléphone. ?c=<conversation> ouvre une conversation (lien « Pleine page » du
 * panneau de l'en-tête).
 */
export default function DiscussionsPage() {
  return (
    <div>
      <PageHeader
        title="Discussion"
        subtitle="Conversations entre collègues : à deux, en groupe, ou sur une fiche. Seuls les membres d'une conversation la lisent, l'administration comprise."
      />
      <Suspense fallback={<Loading label="Chargement des conversations…" />}>
        <Discussions />
      </Suspense>
    </div>
  );
}

function vueInitiale(c: string | null): Vue {
  const id = Number(c);
  return Number.isInteger(id) && id > 0 ? { ecran: "fil", id } : { ecran: "liste" };
}

function Discussions() {
  const params = useSearchParams();
  const router = useRouter();
  const [vue, setVue] = useState<Vue>(() => vueInitiale(params.get("c")));

  function changer(v: Vue) {
    setVue(v);
    // L'adresse suit la conversation ouverte (retour arrière, lien à garder), sans recharger l'écran.
    const id = v.ecran === "fil" || v.ecran === "membres" ? v.id : null;
    router.replace(id ? `/discussions?c=${id}` : "/discussions", { scroll: false });
  }

  return <Messagerie mode="page" vue={vue} onVue={changer} />;
}
