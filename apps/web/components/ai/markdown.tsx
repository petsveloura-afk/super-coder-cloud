import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown for AI answers: **bold**, *italic*, `code`, [links](https://…),
 * headings (#), bullet lists (- * •), numbered lists (1.) and paragraphs.
 * Builds React elements only — never HTML strings — so model output cannot inject markup.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]*)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[2] || m[3]) out.push(<strong key={k}>{m[2] ?? m[3]}</strong>);
    else if (m[4]) out.push(<em key={k}>{m[4]}</em>);
    else if (m[5]) out.push(<code key={k} className="rounded bg-elevated px-1 py-0.5 text-[12.5px]" dir="ltr">{m[5]}</code>);
    else if (m[6] && m[7]) out.push(<a key={k} href={m[7]} target={m[7].startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className="text-accent underline underline-offset-2">{m[6]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k} className="leading-7">
          {para.map((l, i) => (
            <Fragment key={i}>
              {i ? <br /> : null}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k} className={list.ordered ? "list-decimal space-y-1 ps-5" : "list-disc space-y-1 ps-5"}>
          {list.items.map((it, i) => (
            <li key={i} className="leading-7">{inline(it, `${k}-${i}`)}</li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•])\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet?.[1] ?? numbered?.[1] ?? "").trim());
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(<p key={`h${blocks.length}`} className="font-semibold">{inline(heading[1]!, `h${blocks.length}`)}</p>);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2 break-words" dir="auto">{blocks}</div>;
}
