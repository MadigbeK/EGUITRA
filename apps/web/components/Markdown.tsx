/**
 * Rendu des guides Markdown dans l'application, sur la même grammaire que la conversion en Word
 * (docs/outils/md-docx.js) : titre (#), sections (##, ###), paragraphes, listes à puces et
 * numérotées (deux niveaux), tableaux, gras (**…**), code (`…`) et liens ([texte](cible)). Le texte
 * est rendu en éléments React, jamais en HTML brut.
 */

import { Fragment, type ReactNode } from "react";

export interface Section {
  id: string;
  title: string;
}

/** Identifiant d'ancre d'un titre : « Où saisir quoi » -> « ou-saisir-quoi ». */
export function ancre(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-ink">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-panel-3 px-1 py-px font-mono text-[0.92em]">{t.slice(1, -1)}</code>);
    else {
      const lien = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      const cible = lien?.[2] ?? "";
      // Seuls les liens internes à l'application deviennent cliquables.
      out.push(cible.startsWith("/") ? <a key={k++} href={cible} className="font-medium text-accent underline-offset-2 hover:underline">{lien?.[1]}</a> : <Fragment key={k++}>{lien?.[1]}</Fragment>);
    }
    last = i + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isList = (l: string) => /^\s*(- |\d+\. )/.test(l);

/** Sections (##) du texte, pour la table des matières. */
export function sections(markdown: string): Section[] {
  return markdown
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => ({ id: ancre(l.slice(3)), title: l.slice(3) }));
}

export function Markdown({ source, sansTitre }: { source: string; sansTitre?: boolean }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      if (!sansTitre) out.push(<h1 key={k++} className="mb-4 text-[24px] font-bold text-ink">{inline(line.slice(2))}</h1>);
      i += 1;
    } else if (line.startsWith("### ")) {
      out.push(<h3 key={k++} id={ancre(line.slice(4))} className="mb-2 mt-5 scroll-mt-24 text-[15px] font-semibold text-accent">{inline(line.slice(4))}</h3>);
      i += 1;
    } else if (line.startsWith("## ")) {
      out.push(<h2 key={k++} id={ancre(line.slice(3))} className="mb-3 mt-8 scroll-mt-24 border-b border-line pb-2 text-[18px] font-semibold text-ink first:mt-0">{inline(line.slice(3))}</h2>);
      i += 1;
    } else if (line.startsWith("|")) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2; // ligne de séparation |---|
      while (i < lines.length && lines[i]!.startsWith("|")) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      out.push(
        <div key={k++} className="mb-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-panel-2">
                {head.map((h, c) => (
                  <th key={c} scope="col" className="border-b border-line px-3 py-2 text-left text-[12.5px] font-semibold text-ink-2">{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-line/70 last:border-0 align-top">
                  {head.map((_h, c) => (
                    <td key={c} className={c === 0 ? "px-3 py-2 font-medium text-ink" : "px-3 py-2 text-ink-2"}>{inline(r[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1;
      out.push(<pre key={k++} className="mb-4 overflow-x-auto rounded-xl bg-panel-2 p-3 font-mono text-[12.5px]">{code.join("\n")}</pre>);
    } else if (isList(line)) {
      const items: Array<{ text: string; ordered: boolean; level: number; n: string | undefined }> = [];
      while (i < lines.length && isList(lines[i]!)) {
        const m = /^(\s*)(- |(\d+)\. )(.*)$/.exec(lines[i]!)!;
        let text = m[4] ?? "";
        i += 1;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !isList(lines[i]!)) {
          text += ` ${lines[i]!.trim()}`;
          i += 1;
        }
        items.push({ text, ordered: Boolean(m[3]), level: (m[1] ?? "").length >= 2 ? 1 : 0, n: m[3] });
      }
      const ordered = items[0]?.ordered;
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={k++} className="mb-4 space-y-1.5 text-[14px] leading-relaxed text-ink-2">
          {items.map((it, j) => (
            <li key={j} className={it.level ? "ml-10 flex gap-2.5" : "flex gap-2.5"}>
              <span aria-hidden className="mt-[1px] w-5 flex-none text-right font-semibold text-accent">{it.ordered ? `${it.n}.` : "•"}</span>
              <span className="min-w-0">{inline(it.text)}</span>
            </li>
          ))}
        </List>,
      );
    } else {
      let text = line.trim();
      i += 1;
      while (i < lines.length && lines[i]!.trim() && !/^(#|\||```)/.test(lines[i]!) && !isList(lines[i]!)) {
        text += ` ${lines[i]!.trim()}`;
        i += 1;
      }
      out.push(<p key={k++} className="mb-3 text-[14px] leading-relaxed text-ink-2">{inline(text)}</p>);
    }
  }
  return <div>{out}</div>;
}
