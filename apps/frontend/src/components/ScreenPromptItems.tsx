import { CodexScreenPromptItem } from '../lib/codex';

export default function ScreenPromptItems({ items }: { items: CodexScreenPromptItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/30" aria-labelledby="screen-prompt-items-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="screen-prompt-items-title" className="text-sm font-semibold text-sky-950 dark:text-sky-100">Itens de tela usados</h3>
        <span className="text-xs text-sky-700 dark:text-sky-300">{items.length} {items.length === 1 ? 'item' : 'itens'}</span>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={`${item.id}-${item.label}`} className="rounded-lg border border-sky-100 bg-white/80 px-3 py-2 dark:border-sky-900 dark:bg-slate-950/50">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{item.phrase}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
