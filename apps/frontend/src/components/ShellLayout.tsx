import { NavLink } from 'react-router-dom';
import { ReactNode, useState } from 'react';
import clsx from 'clsx';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/prompts', label: 'Prompts' },
  { to: '/prompt-hints', label: 'Itens do Prompt' },
  { to: '/prompt-lists', label: 'Lista de Prompts' },
  { to: '/products', label: 'Cadastro de Produtos' },
  { to: '/environments', label: 'Ambientes' },
  { to: '/problems', label: 'Problemas' },
  { to: '/logs', label: 'Interpretador de Logs' },
  { to: '/codex', label: 'Codex' },
  { to: '/construir-com-persona', label: 'Construir com Persona' },
  { to: '/codex-chatgpt', label: 'Codex ChatGPT' },
  { to: '/codex-chatgpt-mkt', label: 'Codex ChatGPT MKT' },
  { to: '/codex-chatgpt-sandbox', label: 'Codex ChatGPT Sandbox' },
  { to: '/codex/models', label: 'Modelos Codex' },
  { to: '/source-repository-config', label: 'Config. Repositório' },
  { to: '/audit', label: 'Audit Log' },
  { to: '/admin/system-health', label: 'Saúde do sistema' }
];

export default function ShellLayout({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = (onNavigate?: () => void) => (
    <nav className="space-y-2">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'block rounded-md px-3 py-2 text-sm font-medium',
              isActive
                ? 'bg-emerald-600 text-white'
                : 'text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800'
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className={clsx('min-h-screen', dark ? 'dark' : '')}>
      <div className="flex min-h-screen bg-slate-100 dark:bg-slate-900">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white/80 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/40 md:block">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">AI Hub 6</h1>
            <button
              onClick={() => setDark((prev) => !prev)}
              className="text-xs px-2 py-1 border rounded-md border-slate-300 dark:border-slate-700"
            >
              {dark ? 'Claro' : 'Escuro'}
            </button>
          </div>
          {navigation()}
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:hidden">
            <h1 className="font-bold text-slate-800 dark:text-slate-100">AI Hub 6</h1>
            <div className="flex items-center gap-2">
              <button onClick={() => setDark((prev) => !prev)} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700">{dark ? 'Claro' : 'Escuro'}</button>
              <button onClick={() => setMobileMenuOpen(true)} aria-label="Abrir menu" aria-expanded={mobileMenuOpen} className="rounded-md border border-slate-300 px-3 py-1 text-lg leading-5 dark:border-slate-700">☰</button>
            </div>
          </header>
          {mobileMenuOpen ? <div className="fixed inset-0 z-[60] md:hidden">
            <button type="button" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} className="absolute inset-0 bg-slate-950/50" />
            <aside className="absolute inset-y-0 right-0 w-[min(320px,86vw)] overflow-y-auto bg-white p-4 shadow-2xl dark:bg-slate-950">
              <div className="mb-5 flex items-center justify-between"><h2 className="font-bold">Navegação</h2><button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu" className="rounded-md border px-3 py-1.5 text-sm dark:border-slate-700">Fechar</button></div>
              {navigation(() => setMobileMenuOpen(false))}
            </aside>
          </div> : null}
          <main className="p-4 sm:p-6 md:p-8">
          <div className="mx-auto max-w-6xl space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
