import { Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch';
import client from '../api/client';

interface Prompt {
  id: number;
  repo: string;
  createdAt: string;
  prompt: string;
}

interface SourceModuleChange {
  name: string;
  path: string;
  lastChangedAt: string;
  daysSinceLastChange: number;
}

export default function DashboardPage() {
  const { data: prompts } = useFetch<Prompt[]>(
    () => client.get('/prompts').then((res) => res.data),
    []
  );

  const { data: sourceModules } = useFetch<SourceModuleChange[]>(
    () => client.get('/source-modules/changes').then((res) => res.data),
    []
  );

  const recentPrompts = prompts?.slice(-5).reverse() ?? [];

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Visão geral</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardCard title="Prompts" description="Acompanhe análises de falhas e respostas do modelo">
          <Link to="/prompts" className="text-sm font-semibold text-emerald-600">
            Abrir análises →
          </Link>
        </DashboardCard>
        <DashboardCard title="Ambientes" description="Configure destinos e segredos para execuções">
          <Link to="/environments" className="text-sm font-semibold text-emerald-600">
            Gerenciar ambientes →
          </Link>
        </DashboardCard>
        <DashboardCard title="Codex" description="Central de modelos e requisições sob medida">
          <Link to="/codex" className="text-sm font-semibold text-emerald-600">
            Abrir Codex →
          </Link>
        </DashboardCard>
        <DashboardCard title="Codex ChatGPT" description="Fluxo managed com autenticação da conta ChatGPT">
          <Link to="/codex-chatgpt" className="text-sm font-semibold text-emerald-600">
            Abrir Codex ChatGPT →
          </Link>
        </DashboardCard>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Últimas alterações do código fonte</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Dias desde o último commit que alterou arquivos de cada módulo.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sourceModules?.map((module) => (
            <div key={module.path} className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 p-3">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{module.name}</div>
              <div className="mt-2 text-2xl font-bold text-emerald-600">
                {module.daysSinceLastChange} {module.daysSinceLastChange === 1 ? 'dia' : 'dias'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Última alteração: {new Date(module.lastChangedAt).toLocaleDateString()}
              </div>
              <div className="mt-1 text-xs font-mono text-slate-400">{module.path}</div>
            </div>
          )) ?? <div className="text-sm text-slate-500">Carregando módulos...</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4">
          <h3 className="text-lg font-semibold mb-4">Falhas recentes</h3>
          <ul className="space-y-3 text-sm">
            {recentPrompts.length > 0 ? (
              recentPrompts.map((prompt) => (
                <li key={prompt.id} className="border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div className="flex justify-between">
                    <span className="font-medium">{prompt.repo}</span>
                    <span className="text-xs text-slate-500">
                      {new Date(prompt.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-300 overflow-hidden text-ellipsis whitespace-nowrap">
                    {prompt.prompt}
                  </p>
                </li>
              ))
            ) : (
              <li className="text-sm text-slate-500">Sem análises registradas</li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 space-y-3">
          <h3 className="text-lg font-semibold">Próximos passos</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            O módulo de projetos foi removido. A interface passa a focar em prompts, análise de falhas
            e Codex enquanto preparamos novas funcionalidades.
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Use os atalhos acima para navegar e continue compartilhando feedback sobre o que devemos priorizar nas
            próximas entregas.
          </p>
        </div>
      </div>
    </section>
  );
}

function DashboardCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}
