import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import MarkdownFileReference, { isFileReferenceHref } from './MarkdownFileReference';

interface StructuredResponse {
  titulo: string;
  comentario: string;
  alterouCodigoRepositorio?: boolean;
  resumoCodigoPr: string;
  orientacaoProximaAcao: string;
  sugestaoMelhoriaAmbiente: string;
}

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('document.execCommand(copy) retornou falso');
  }
};

const stripModelThinking = (content: string): string => {
  const trimmed = content.trim();
  if (!trimmed) return content;
  const validationIndex = trimmed.search(/(?:^|\n)Valida(?:ç|c)[aã]o executada com sucesso:/i);
  if (validationIndex > 0) {
    const beforeValidation = trimmed.slice(0, validationIndex).trimEnd();
    const paragraphStart = beforeValidation.lastIndexOf('\n\n');
    if (paragraphStart >= 0) {
      return `${beforeValidation.slice(paragraphStart + 2).trim()}\n\n${trimmed.slice(validationIndex).trimStart()}`;
    }
  }
  return trimmed;
};

const renderFileReference = (label: string, href: string, key: string) => {
  return <MarkdownFileReference key={key} label={label} href={href} />;
};

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined && match[3] !== undefined) {
      if (isFileReferenceHref(match[3])) {
        nodes.push(renderFileReference(match[2], match[3], `${keyPrefix}-file-${match.index}`));
      } else {
        nodes.push(<a key={`${keyPrefix}-link-${match.index}`} href={match[3]} className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-100" target="_blank" rel="noreferrer">{match[2]}</a>);
      }
    } else if (match[4] !== undefined) {
      nodes.push(<code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.95em] text-slate-900 dark:bg-slate-800 dark:text-slate-100">{match[4]}</code>);
    } else if (match[5] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[5]}</strong>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

const renderMarkdownListItem = (item: string, keyPrefix: string) => {
  const filePrefixMatch = item.match(/^\[([^\]]+)\]\(([^)\s]+)\):\s*(.*)$/);
  if (filePrefixMatch && isFileReferenceHref(filePrefixMatch[2])) {
    return (
      <div className="space-y-1">
        <div>{renderFileReference(filePrefixMatch[1], filePrefixMatch[2], `${keyPrefix}-file-reference`)}</div>
        {filePrefixMatch[3] ? <div>{renderInlineMarkdown(filePrefixMatch[3], `${keyPrefix}-description`)}</div> : null}
      </div>
    );
  }

  return renderInlineMarkdown(item, keyPrefix);
};

const splitMarkdownTableRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

const isMarkdownTableDivider = (line: string) => {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const parseMarkdownTable = (paragraph: string) => {
  const lines = paragraph.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2 || !lines.every((line) => line.includes('|')) || !isMarkdownTableDivider(lines[1])) {
    return null;
  }

  const headers = splitMarkdownTableRow(lines[0]);
  const rows = lines.slice(2).map(splitMarkdownTableRow);
  if (headers.length < 2 || rows.some((row) => row.length !== headers.length)) {
    return null;
  }

  return { headers, rows };
};

const headingClasses: Record<number, string> = {
  1: 'text-xl font-semibold',
  2: 'text-lg font-semibold',
  3: 'text-base font-semibold',
  4: 'text-sm font-semibold',
  5: 'text-sm font-semibold',
  6: 'text-sm font-semibold'
};

const renderMarkdownTable = (table: NonNullable<ReturnType<typeof parseMarkdownTable>>, key: string) => (
  <div key={key} className="overflow-x-auto">
    <table className="min-w-full border-collapse text-left text-sm">
      <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        <tr>{table.headers.map((header, cellIndex) => <th key={cellIndex} className="border border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">{renderInlineMarkdown(header, `${key}-th-${cellIndex}`)}</th>)}</tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => <tr key={rowIndex} className="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900 dark:even:bg-slate-950/40">
          {row.map((cell, cellIndex) => <td key={cellIndex} className="border border-slate-200 px-3 py-2 align-top dark:border-slate-700">{renderInlineMarkdown(cell, `${key}-td-${rowIndex}-${cellIndex}`)}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>
);

const renderMarkdownTextBlock = (block: string, blockIndex: number): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const paragraphLines: string[] = [];
  const lines = block.split('\n');

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const paragraph = paragraphLines.join('\n').trim();
    if (paragraph) {
      const key = `p-${blockIndex}-${nodes.length}`;
      nodes.push(<p key={key} className="whitespace-pre-wrap">{renderInlineMarkdown(paragraph, key)}</p>);
    }
    paragraphLines.length = 0;
  };

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const line = lines[lineIndex];
    if (!line.trim()) {
      flushParagraph();
      lineIndex += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const key = `heading-${blockIndex}-${lineIndex}`;
      const content = renderInlineMarkdown(headingMatch[2], key);
      if (level === 1) nodes.push(<h1 key={key} className={headingClasses[level]}>{content}</h1>);
      else if (level === 2) nodes.push(<h2 key={key} className={headingClasses[level]}>{content}</h2>);
      else if (level === 3) nodes.push(<h3 key={key} className={headingClasses[level]}>{content}</h3>);
      else if (level === 4) nodes.push(<h4 key={key} className={headingClasses[level]}>{content}</h4>);
      else if (level === 5) nodes.push(<h5 key={key} className={headingClasses[level]}>{content}</h5>);
      else nodes.push(<h6 key={key} className={headingClasses[level]}>{content}</h6>);
      lineIndex += 1;
      continue;
    }

    if (line.includes('|') && lineIndex + 1 < lines.length && isMarkdownTableDivider(lines[lineIndex + 1])) {
      flushParagraph();
      const tableLines = [line, lines[lineIndex + 1]];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].includes('|') && lines[lineIndex].trim()) {
        tableLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      const table = parseMarkdownTable(tableLines.join('\n'));
      if (table) {
        nodes.push(renderMarkdownTable(table, `table-${blockIndex}-${nodes.length}`));
      } else {
        paragraphLines.push(...tableLines);
      }
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      const items: string[] = [];
      while (lineIndex < lines.length) {
        const itemMatch = lines[lineIndex].match(/^\s*[-*]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        lineIndex += 1;
      }
      nodes.push(<ul key={`ul-${blockIndex}-${nodes.length}`} className="list-disc space-y-2 pl-5">
        {items.map((item, itemIndex) => <li key={itemIndex}>{renderMarkdownListItem(item, `ul-${blockIndex}-${nodes.length}-${itemIndex}`)}</li>)}
      </ul>);
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      const items: string[] = [];
      while (lineIndex < lines.length) {
        const itemMatch = lines[lineIndex].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        lineIndex += 1;
      }
      nodes.push(<ol key={`ol-${blockIndex}-${nodes.length}`} className="list-decimal space-y-2 pl-5">
        {items.map((item, itemIndex) => <li key={itemIndex}>{renderMarkdownListItem(item, `ol-${blockIndex}-${nodes.length}-${itemIndex}`)}</li>)}
      </ol>);
      continue;
    }

    paragraphLines.push(line);
    lineIndex += 1;
  }

  flushParagraph();
  return nodes;
};

const tryParseStructuredResponseRecord = (candidate: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'string') {
      return tryParseStructuredResponseRecord(parsed);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const extractJsonObjectCandidate = (content: string): string | null => {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const parsedString = (() => {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  })();
  if (parsedString) {
    return extractJsonObjectCandidate(parsedString);
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  if (candidate !== trimmed) {
    return extractJsonObjectCandidate(candidate);
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
};

const readStructuredResponseString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
};

const readStructuredResponseBoolean = (record: Record<string, unknown>, keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'sim', 'yes', '1'].includes(normalized)) return true;
      if (['false', 'nao', 'não', 'no', '0'].includes(normalized)) return false;
    }
  }
  return undefined;
};

export const parseCodexStructuredResponse = (content?: string): StructuredResponse | null => {
  if (!content) return null;
  const candidate = extractJsonObjectCandidate(content);
  if (!candidate) return null;

  const record = tryParseStructuredResponseRecord(candidate);
  if (!record) {
    return null;
  }

  const titulo = readStructuredResponseString(record, ['titulo', 'título', 'title']).trim();
  const comentario = readStructuredResponseString(record, ['comentario', 'comentário', 'comment', 'resposta']).trim();
  const alterouCodigoRepositorio = readStructuredResponseBoolean(record, [
    'alterouCodigoRepositorio',
    'alterou_codigo_repositorio',
    'codigoAlterado',
    'codeChanged',
    'changedRepositoryCode'
  ]);
  const resumoCodigoPr = readStructuredResponseString(record, [
    'resumoCodigoPr',
    'resumo_codigo_pr',
    'resumoPr',
    'prSummary',
    'codePrSummary'
  ]).trim();
  const orientacaoProximaAcao = readStructuredResponseString(record, [
    'orientacaoProximaAcao',
    'orientaçãoProximaAção',
    'orientacao_proxima_acao',
    'orientacao',
    'orientação',
    'nextActionGuidance'
  ]).trim();
  const sugestaoMelhoriaAmbiente = readStructuredResponseString(record, [
    'sugestaoMelhoriaAmbiente',
    'sugestãoMelhoriaAmbiente',
    'sugestao_melhoria_ambiente',
    'sugestaoAmbiente',
    'sugestãoAmbiente',
    'environmentImprovementSuggestion'
  ]).trim();
  if (!titulo && !comentario && alterouCodigoRepositorio === undefined && !resumoCodigoPr && !orientacaoProximaAcao && !sugestaoMelhoriaAmbiente) {
    return null;
  }
  return { titulo, comentario, alterouCodigoRepositorio, resumoCodigoPr, orientacaoProximaAcao, sugestaoMelhoriaAmbiente };
};

export const MarkdownMessage = ({ content }: { content: string }) => {
  const normalized = stripModelThinking(content);
  const blocks = normalized.split(/(```[\s\S]*?```)/g).filter((block) => block.length > 0);
  return <div className="space-y-2 whitespace-normal break-words">
    {blocks.map((block, blockIndex) => {
      const codeMatch = block.match(/^```([^\n`]*)\n?([\s\S]*?)```$/);
      if (codeMatch) {
        return <pre key={`code-${blockIndex}`} className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-xs text-slate-50 dark:border-slate-700"><code>{codeMatch[2].trimEnd()}</code></pre>;
      }
      return renderMarkdownTextBlock(block, blockIndex);
    })}
  </div>;
};

const CopyIcon = ({ copied }: { copied: boolean }) => (
  copied
    ? <span aria-hidden="true" className="text-sm font-semibold">✓</span>
    : (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    )
);

const CodeGeneratedIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
    <path d="m14.5 4-5 16" />
  </svg>
);

const CODE_FILE_PATTERN = /\b[\w./@+-]+\.(?:adoc|asc|css|dockerfile|env|gradle|graphql|html|java|js|json|jsx|kt|md|mdx|mjs|properties|py|rs|scss|sh|sql|ts|tsx|vue|xml|yaml|yml)\b/i;
const CODE_CHANGE_PATTERN = /\b(?:ajuste|alteracao|alteração|arquivo|componente|correcao|correção|implementacao|implementação|mudanca|mudança|teste|validacao|validação)s?\s+(?:aplicad[oa]s?|atualizad[oa]s?|criad[oa]s?|executad[oa]s?|implementad[oa]s?|incluid[oa]s?|passaram|realizad[oa]s?|removid[oa]s?)\b/i;
const CODE_COMMAND_PATTERN = /\b(?:docker|git|mvn|npm|pnpm|yarn|node|playwright|tsc|vite)\s+(?:--prefix\s+\S+\s+)?(?:run\s+)?[\w:.-]+/i;

export const hasCodeGenerationSignal = (content: string): boolean => {
  const normalized = content.trim();
  if (!normalized) return false;
  return (CODE_FILE_PATTERN.test(normalized) && CODE_CHANGE_PATTERN.test(normalized)) || CODE_COMMAND_PATTERN.test(normalized);
};

const CodeGeneratedBadge = () => (
  <span
    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
    title="Esta resposta indica que foram geradas ou alteradas mudanças no repositório"
  >
    <CodeGeneratedIcon />
    <span>Gerou código</span>
  </span>
);

interface StructuredCardProps {
  label: string;
  content: string;
  copyField: 'comentario' | 'orientacao' | 'melhoria';
  copied: boolean;
  accentClassName: string;
  showCodeGeneratedBadge?: boolean;
  onCopy: (field: 'comentario' | 'orientacao' | 'melhoria', text: string) => void;
}

const StructuredCard = ({ label, content, copyField, copied, accentClassName, showCodeGeneratedBadge = false, onCopy }: StructuredCardProps) => (
  <section className={`rounded-lg border p-4 shadow-sm ${accentClassName}`}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide">{label}</h4>
        {showCodeGeneratedBadge ? <CodeGeneratedBadge /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onCopy(copyField, content)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-current bg-white/70 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-current dark:bg-slate-950/30"
          title={`Copiar ${label.toLowerCase()}`}
          aria-label={`Copiar ${label.toLowerCase()}`}
        >
          <CopyIcon copied={copied} />
        </button>
      </div>
    </div>
    <MarkdownMessage content={content} />
  </section>
);

export default function CodexResponseBody({ content }: { content: string }) {
  const structured = parseCodexStructuredResponse(content);
  const [copiedField, setCopiedField] = useState<'comentario' | 'orientacao' | 'melhoria' | null>(null);
  const copiedTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedTimeoutRef.current) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
  }, []);

  const handleCopyStructuredText = useCallback(async (field: 'comentario' | 'orientacao' | 'melhoria', text: string) => {
    await copyTextToClipboard(text);
    setCopiedField(field);
    if (copiedTimeoutRef.current) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => setCopiedField(null), 2000);
  }, []);

  if (!structured) {
    return <MarkdownMessage content={content} />;
  }

  return <div className="space-y-3">
    {structured.titulo ? <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-950 shadow-sm dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Título</h4>
      <p className="text-sm font-semibold">{structured.titulo}</p>
    </section> : null}
    {structured.comentario ? <StructuredCard
      label="Comentário"
      content={structured.comentario}
      copyField="comentario"
      copied={copiedField === 'comentario'}
      accentClassName="border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      showCodeGeneratedBadge={structured.alterouCodigoRepositorio === true}
      onCopy={handleCopyStructuredText}
    /> : null}
    {structured.orientacaoProximaAcao ? <StructuredCard
      label="Falta fazer"
      content={structured.orientacaoProximaAcao}
      copyField="orientacao"
      copied={copiedField === 'orientacao'}
      accentClassName="border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
      onCopy={handleCopyStructuredText}
    /> : null}
    {structured.sugestaoMelhoriaAmbiente ? <StructuredCard
      label="Sugestão"
      content={structured.sugestaoMelhoriaAmbiente}
      copyField="melhoria"
      copied={copiedField === 'melhoria'}
      accentClassName="border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
      onCopy={handleCopyStructuredText}
    /> : null}
  </div>;
}
