/**
 * Maquette de la discussion interne (routes /chat/..., contrat : apps/web/lib/discussions.ts ; noyau :
 * addons/eguitra_chat). En mémoire, remise à zéro au redémarrage. Mêmes règles que le noyau, en plus
 * simple : comptes internes actifs seulement, sociétés partagées, membres seuls lecteurs, responsable
 * du groupe, retrait de son propre message, non-lus par membre. Un fil de démonstration est semé.
 */

const OBJETS = { "axispro.dossier": "Dossier", "eguitra.chantier": "Chantier", "eguitra.transport.rotation": "Rotation", "eguitra.property": "Bien" };
const MAX_FILE = 20 * 1048576;

export function enregistrerDiscussions({ route, ApiError, USERS, userById, DB, nowStamp, detectType, checkedName, fileReply, ACCEPTED }) {
  const C = { channels: [], members: [], messages: [], reads: new Map(), files: new Map(), seq: { channel: 0, message: 0, file: 0 } };
  const interne = (u) => u && u.active && !u.profiles.includes("porteur") && u.profiles.length > 0;
  const partage = (a, b) => a.companies.some((c) => b.companies.includes(c));
  const membres = (ch) => C.members.filter((m) => m.channel_id === ch.id).map((m) => userById(m.user_id)).filter(Boolean);
  const estMembre = (ch, uid) => C.members.some((m) => m.channel_id === ch.id && m.user_id === uid);
  const ref = (u) => (u ? { id: u.id, name: u.name } : null);
  const lu = (ch, uid) => C.reads.get(`${ch.id}-${uid}`) ?? 0;
  const lire = (ch, uid, id) => C.reads.set(`${ch.id}-${uid}`, Math.max(lu(ch, uid), id));
  const dernier = (ch) => C.messages.filter((m) => m.channel_id === ch.id).at(-1) ?? null;

  function moi(ctx) {
    const u = userById(ctx.user.id) ?? ctx.user;
    if (!interne(u)) throw new ApiError(403, "forbidden", "Accès non autorisé pour votre profil.");
    return u;
  }
  function collegue(ctx, id) {
    const me = moi(ctx);
    const u = userById(Number(id));
    if (!u || u.id === me.id || !interne(u)) throw new ApiError(422, "business_rule", "Ce compte ne reçoit pas de messages : seuls les comptes internes actifs participent à la discussion.");
    if (!partage(me, u)) throw new ApiError(403, "forbidden", `Vous ne partagez aucune société avec ${u.name} : la conversation est refusée.`);
    return u;
  }
  function conversation(ctx, id) {
    const me = moi(ctx);
    const ch = C.channels.find((c) => c.id === Number(id));
    if (!ch || !estMembre(ch, me.id)) throw new ApiError(404, "not_found", "Conversation introuvable.");
    return ch;
  }
  function ajouterMembre(ch, uid) {
    if (!estMembre(ch, uid)) C.members.push({ channel_id: ch.id, user_id: uid });
    const d = dernier(ch);
    if (d) lire(ch, uid, d.id);
  }
  function evenement(ch, texte, auteur = null) {
    C.messages.push({ id: ++C.seq.message, channel_id: ch.id, kind: "event", author_id: auteur, body: texte, date: nowStamp(), reply_to: null, files: [], withdrawn: false, withdrawn_date: null });
  }
  function nonLus(ch, uid) {
    const l = lu(ch, uid);
    return C.messages.filter((m) => m.channel_id === ch.id && m.kind === "message" && !m.withdrawn && m.author_id !== uid && m.id > l).length;
  }
  function extrait(m) {
    if (!m || m.withdrawn) return null;
    const t = (m.body || "").replace(/\s+/g, " ").trim() || (m.files.length ? `Pièce jointe : ${m.files.map((f) => C.files.get(f).name).join(", ")}` : "");
    return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  }
  function ligneMessage(m, me) {
    const r = m.reply_to ? C.messages.find((x) => x.id === m.reply_to) : null;
    return {
      id: m.id, kind: m.kind, author: ref(userById(m.author_id)), mine: m.author_id === me.id, date: m.date,
      body: m.withdrawn ? null : (m.body ?? ""), withdrawn: m.withdrawn, withdrawn_date: m.withdrawn_date,
      reply_to: r ? { id: r.id, author: userById(r.author_id)?.name ?? null, excerpt: extrait(r), withdrawn: r.withdrawn } : null,
      attachments: m.withdrawn ? [] : m.files.map((id) => { const f = C.files.get(id); return { id, name: f.name, mimetype: f.mimetype, size: f.data.length }; }),
    };
  }
  function titre(ch, me) {
    if (ch.kind === "direct") {
      const autre = userById(ch.pair.find((id) => id !== me.id));
      return autre ? `${autre.name}${autre.active ? "" : " (compte archivé)"}` : "Conversation";
    }
    if (ch.kind === "object") return `${OBJETS[ch.res_model] ?? "Fiche"} ${ch.name}`;
    return ch.name;
  }
  function ligne(ch, me) {
    const d = dernier(ch);
    const ms = membres(ch);
    return {
      id: ch.id, kind: ch.kind, title: titre(ch, me),
      object: ch.kind === "object" ? { model: ch.res_model, id: ch.res_id, type: OBJETS[ch.res_model] ?? "Fiche", label: ch.name } : null,
      members_count: ms.length, members: ms.slice(0, 6).map(ref), owner: ch.owner_id === me.id, unread: nonLus(ch, me.id),
      last_message: d ? { id: d.id, kind: d.kind, author: userById(d.author_id)?.name ?? null, mine: d.author_id === me.id, date: d.date, excerpt: extrait(d), withdrawn: d.withdrawn } : null,
      last_activity: d ? d.date : ch.created,
    };
  }
  function bloque(ch, me) {
    if (ch.kind !== "direct") return null;
    const autre = userById(ch.pair.find((id) => id !== me.id));
    if (!autre || !estMembre(ch, autre.id) || !interne(autre)) return "Votre correspondant ne participe plus à la discussion : la conversation reste lisible.";
    if (!partage(me, autre)) return `Vous ne partagez plus de société avec ${autre.name} : la conversation reste lisible.`;
    return null;
  }
  function detail(ch, me) {
    const responsable = ch.kind === "group" && ch.owner_id === me.id;
    const b = bloque(ch, me);
    return {
      ...ligne(ch, me),
      members: membres(ch).map((u) => ({ id: u.id, name: u.name, owner: u.id === ch.owner_id, me: u.id === me.id, archived: !u.active })),
      can: { post: !b, add: responsable, remove: responsable, rename: responsable, leave: ch.kind !== "direct" },
      post_blocked: b,
    };
  }
  function creer(kind, champs, ids) {
    const ch = { id: ++C.seq.channel, kind, created: nowStamp(), owner_id: null, name: null, ...champs };
    C.channels.push(ch);
    for (const id of ids) C.members.push({ channel_id: ch.id, user_id: id });
    return ch;
  }
  function libelleObjet(model, id) {
    if (model === "axispro.dossier") { const d = (DB.dossiers ?? []).find((x) => x.id === id); return d ? `${d.reference} ${d.name}` : null; }
    if (model === "eguitra.chantier") return (DB.chantiers ?? []).find((x) => x.id === id)?.name ?? null;
    if (model === "eguitra.transport.rotation") return (DB.rotations ?? []).find((x) => x.id === id)?.name ?? `n° ${id}`;
    if (model === "eguitra.property") return (DB.properties ?? []).find((x) => x.id === id)?.name ?? null;
    return null;
  }

  // Fil de démonstration : une conversation à deux et un groupe, quelques non-lus pour le compte complet (2).
  const a = 2, b = 5, k = 6;
  const direct = creer("direct", { pair: [a, b] }, [a, b]);
  const poster = (ch, auteur, body, minutes) => C.messages.push({ id: ++C.seq.message, channel_id: ch.id, kind: "message", author_id: auteur, body, date: new Date(Date.now() - minutes * 60000).toISOString().slice(0, 19) + "Z", reply_to: null, files: [], withdrawn: false, withdrawn_date: null });
  poster(direct, a, "Bonjour Ousmane, le relevé de septembre de la banque est-il arrivé ?", 95);
  poster(direct, b, "Oui, je l'importe ce matin et je vous préviens pour le rapprochement.", 80);
  lire(direct, a, C.seq.message);
  lire(direct, b, C.seq.message);
  poster(direct, b, "Import fait : trois lignes restent à rapprocher.", 12);
  lire(direct, b, C.seq.message);
  const groupe = creer("group", { name: "Clôture d'octobre", owner_id: k }, [k, a, b]);
  evenement(groupe, "Kadiatou Sylla a créé le groupe « Clôture d'octobre ».", k);
  poster(groupe, k, "Point demain 9 h sur les factures à établir et les dotations.", 40);
  lire(groupe, k, C.seq.message);

  route("GET", "/chat/unread", null, (ctx) => {
    const me = moi(ctx);
    const mes = C.channels.filter((ch) => estMembre(ch, me.id));
    const comptes = mes.map((ch) => nonLus(ch, me.id)).filter((n) => n > 0);
    return { unread: comptes.reduce((s, n) => s + n, 0), conversations: comptes.length };
  });
  route("GET", "/chat/conversations", null, (ctx) => {
    const me = moi(ctx);
    return C.channels.filter((ch) => estMembre(ch, me.id)).map((ch) => ligne(ch, me)).sort((x, y) => (y.last_message?.id ?? 0) - (x.last_message?.id ?? 0) || y.id - x.id);
  });
  route("GET", "/chat/users", null, (ctx) => {
    const me = moi(ctx);
    const q = String(ctx.query.q || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return USERS.filter((u) => u.id !== me.id && interne(u) && partage(me, u))
      .filter((u) => !q || `${u.name} ${u.login}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
      .sort((x, y) => x.name.localeCompare(y.name, "fr"))
      .slice(0, 20)
      .map((u) => ({ id: u.id, name: u.name, companies: u.companies.filter((c) => me.companies.includes(c)).map((c) => (c === 1 ? "EGUITRA GROUP SARLU (démo)" : "MB AxisPro Consulting (démo)")) }));
  });
  route("POST", "/chat/conversations", null, (ctx) => {
    const me = moi(ctx);
    if (ctx.body.kind === "direct") {
      const autre = collegue(ctx, ctx.body.user_id);
      let ch = C.channels.find((c) => c.kind === "direct" && c.pair.includes(me.id) && c.pair.includes(autre.id));
      if (!ch) ch = creer("direct", { pair: [me.id, autre.id] }, [me.id, autre.id]);
      else for (const id of [me.id, autre.id]) ajouterMembre(ch, id);
      return detail(ch, me);
    }
    if (ctx.body.kind === "group") {
      const nom = String(ctx.body.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!nom) throw new ApiError(422, "business_rule", "Donnez un nom au groupe.");
      const ids = [...new Set((ctx.body.user_ids || []).map(Number))].filter((id) => id !== me.id);
      const autres = ids.map((id) => collegue(ctx, id));
      if (!autres.length) throw new ApiError(422, "business_rule", "Choisissez au moins un collègue.");
      const ch = creer("group", { name: nom, owner_id: me.id }, [me.id, ...autres.map((u) => u.id)]);
      evenement(ch, `${me.name} a créé le groupe « ${nom} ».`, me.id);
      return detail(ch, me);
    }
    throw new ApiError(400, "invalid_parameter", "Sorte de conversation inconnue : direct ou group.");
  });
  route("POST", "/chat/objects", null, (ctx) => {
    const me = moi(ctx);
    const model = String(ctx.body.model || "");
    const id = Number(ctx.body.id);
    if (!OBJETS[model]) throw new ApiError(422, "business_rule", "Cette fiche ne porte pas de discussion.");
    let ch = C.channels.find((c) => c.kind === "object" && c.res_model === model && c.res_id === id);
    if (!ch) ch = creer("object", { res_model: model, res_id: id, name: libelleObjet(model, id) ?? `n° ${id}` }, []);
    ajouterMembre(ch, me.id);
    return detail(ch, me);
  });
  route("GET", "/chat/conversations/:id", null, (ctx) => detail(conversation(ctx, ctx.params[0]), moi(ctx)));
  route("PATCH", "/chat/conversations/:id", null, (ctx) => {
    const me = moi(ctx);
    const ch = conversation(ctx, ctx.params[0]);
    if (ch.kind !== "group" || ch.owner_id !== me.id) throw new ApiError(403, "forbidden", "Seul le responsable du groupe le renomme.");
    const nom = String(ctx.body.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!nom) throw new ApiError(422, "business_rule", "Donnez un nom au groupe.");
    if (nom !== ch.name) { ch.name = nom; evenement(ch, `${me.name} a renommé le groupe « ${nom} ».`, me.id); }
    return detail(ch, me);
  });
  route("POST", "/chat/conversations/:id/members", null, (ctx) => {
    const me = moi(ctx);
    const ch = conversation(ctx, ctx.params[0]);
    if (ch.kind !== "group" || ch.owner_id !== me.id) throw new ApiError(403, "forbidden", "Seul le responsable du groupe y ajoute des membres.");
    const nouveaux = (ctx.body.user_ids || []).map((id) => collegue(ctx, id)).filter((u) => !estMembre(ch, u.id));
    if (!nouveaux.length) throw new ApiError(422, "business_rule", "Ces comptes sont déjà membres de la conversation.");
    for (const u of nouveaux) ajouterMembre(ch, u.id);
    evenement(ch, `${me.name} a ajouté ${nouveaux.map((u) => u.name).join(", ")}.`, me.id);
    return detail(ch, me);
  });
  route("DELETE", "/chat/conversations/:id/members/:id", null, (ctx) => {
    const me = moi(ctx);
    const ch = conversation(ctx, ctx.params[0]);
    const uid = Number(ctx.params[1]);
    if (ch.kind === "direct") throw new ApiError(422, "business_rule", "Une conversation à deux ne se quitte pas.");
    if (!estMembre(ch, uid)) throw new ApiError(404, "not_found", "Ce compte n'est pas membre de la conversation.");
    const part = uid === me.id;
    if (!part && (ch.kind !== "group" || ch.owner_id !== me.id)) throw new ApiError(403, "forbidden", "Seul le responsable du groupe en retire des membres.");
    C.members = C.members.filter((m) => !(m.channel_id === ch.id && m.user_id === uid));
    if (ch.kind === "group") {
      evenement(ch, part ? `${me.name} a quitté la conversation.` : `${me.name} a retiré ${userById(uid)?.name ?? ""}.`, me.id);
      if (ch.owner_id === uid) ch.owner_id = membres(ch)[0]?.id ?? null;
    }
    return part ? { left: true } : detail(ch, me);
  });
  route("GET", "/chat/conversations/:id/messages", null, (ctx) => {
    const me = moi(ctx);
    const ch = conversation(ctx, ctx.params[0]);
    const avant = Number(ctx.query.before) || Infinity;
    const tous = C.messages.filter((m) => m.channel_id === ch.id && m.id < avant);
    const page = tous.slice(-50);
    return { messages: page.map((m) => ligneMessage(m, me)), has_more: tous.length > page.length, last_read_id: lu(ch, me.id), cursor: nowStamp() };
  });
  route("GET", "/chat/conversations/:id/updates", null, (ctx) => {
    const me = moi(ctx);
    const ch = conversation(ctx, ctx.params[0]);
    const apres = Number(ctx.query.after) || 0;
    const depuis = String(ctx.query.since || "");
    const du = C.messages.filter((m) => m.channel_id === ch.id);
    return {
      messages: du.filter((m) => m.id > apres).map((m) => ligneMessage(m, me)),
      changed: depuis ? du.filter((m) => m.id <= apres && m.withdrawn_date && m.withdrawn_date >= depuis).map((m) => ligneMessage(m, me)) : [],
      cursor: nowStamp(),
    };
  });
  route("POST", "/chat/conversations/:id/messages", null, (ctx) => {
    const me = moi(ctx);
    const ch = conversation(ctx, ctx.params[0]);
    const b = bloque(ch, me);
    if (b) throw new ApiError(422, "business_rule", b);
    const { fields, files } = ctx.multipart();
    const pieces = files.filter((f) => f.field === "file" && f.filename);
    const body = String(fields.body || "").trim();
    if (!body && !pieces.length) throw new ApiError(400, "missing_fields", "Écrivez un message ou joignez un fichier.", { fields: ["body"] });
    if (pieces.length > 5) throw new ApiError(422, "business_rule", "5 pièces jointes au plus par message.");
    const ids = [];
    for (const f of pieces) {
      if (f.data.length > MAX_FILE) throw new ApiError(413, "too_large", `${f.filename} : fichier trop volumineux (20 Mo au plus).`);
      const type = detectType(f.data);
      if (!type) throw new ApiError(415, "unsupported_type", `${f.filename} : format refusé. Formats acceptés : ${ACCEPTED}.`);
      ids.push({ name: checkedName(f.filename, type), mimetype: type, data: f.data });
    }
    const reponse = fields.reply_to ? C.messages.find((m) => m.id === Number(fields.reply_to) && m.channel_id === ch.id && m.kind === "message") : null;
    if (fields.reply_to && (!reponse || reponse.withdrawn)) throw new ApiError(422, "business_rule", "On ne répond pas à ce message.");
    const m = { id: ++C.seq.message, channel_id: ch.id, kind: "message", author_id: me.id, body, date: nowStamp(), reply_to: reponse?.id ?? null, files: [], withdrawn: false, withdrawn_date: null };
    for (const f of ids) { const fid = ++C.seq.file; C.files.set(fid, f); m.files.push(fid); }
    C.messages.push(m);
    lire(ch, me.id, m.id);
    return ligneMessage(m, me);
  });
  route("POST", "/chat/conversations/:id/read", null, (ctx) => {
    const me = moi(ctx);
    const ch = conversation(ctx, ctx.params[0]);
    const d = dernier(ch);
    lire(ch, me.id, Math.min(Number(ctx.body.message_id) || Infinity, d?.id ?? 0));
    const mes = C.channels.filter((c) => estMembre(c, me.id)).map((c) => nonLus(c, me.id)).filter((n) => n > 0);
    return { unread: mes.reduce((s, n) => s + n, 0), conversations: mes.length };
  });
  route("POST", "/chat/messages/:id/withdraw", null, (ctx) => {
    const me = moi(ctx);
    const m = C.messages.find((x) => x.id === ctx.params[0]);
    if (!m) throw new ApiError(404, "not_found", "Message introuvable.");
    conversation(ctx, m.channel_id);
    if (m.kind !== "message" || m.author_id !== me.id) throw new ApiError(403, "forbidden", "Seul l'auteur d'un message le retire.");
    if (m.withdrawn) throw new ApiError(422, "business_rule", "Ce message est déjà retiré.");
    m.withdrawn = true;
    m.withdrawn_date = nowStamp();
    return ligneMessage(m, me);
  });
  route("GET", "/chat/messages/:id/files/:id", null, (ctx) => {
    const m = C.messages.find((x) => x.id === ctx.params[0]);
    if (!m) throw new ApiError(404, "not_found", "Message introuvable.");
    conversation(ctx, m.channel_id);
    const f = !m.withdrawn && m.files.includes(ctx.params[1]) ? C.files.get(ctx.params[1]) : null;
    if (!f) throw new ApiError(404, "not_found", "Pièce jointe introuvable.");
    return fileReply(f.data, f.mimetype, f.name);
  });
  route("POST", "/chat/admin/users/:id/remove", ["admin"], (ctx) => {
    const u = userById(ctx.params[0]);
    if (!u) throw new ApiError(404, "not_found", "Utilisateur introuvable.");
    if (u.active) throw new ApiError(422, "business_rule", "Seul un compte archivé (désactivé) se retire des conversations : désactivez-le d'abord.");
    const leurs = C.channels.filter((ch) => estMembre(ch, u.id));
    C.members = C.members.filter((m) => m.user_id !== u.id);
    for (const ch of leurs) {
      if (ch.kind !== "object") evenement(ch, `${u.name} ne participe plus à la conversation (compte archivé).`);
      if (ch.owner_id === u.id) ch.owner_id = membres(ch)[0]?.id ?? null;
    }
    return { removed: leurs.length };
  });
}
