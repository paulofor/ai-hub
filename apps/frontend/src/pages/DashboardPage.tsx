import { useFetch } from '../hooks/useFetch';
import client from '../api/client';
import { formatDuration } from '../lib/codex';

interface Prompt {
  id: number;
  repo: string;
  createdAt: string;
  prompt: string;
}

interface SourceModuleChange {
  name: string;
  path: string;
  lastChangedAt: string | null;
  daysSinceLastChange: number | null;
}

interface CodexDashboardMetricWindow {
  startsAt: string;
  requestCount: number;
  interactionCount: number;
  durationMs: number;
}

interface CodexDashboardMetrics {
  week: CodexDashboardMetricWindow;
  month: CodexDashboardMetricWindow;
}

function formatModuleDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : 'indisponível';
}

function formatMetricNumber(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
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

  const { data: metrics } = useFetch<CodexDashboardMetrics>(
    () => client.get('/codex/requests/metrics').then((res) => res.data),
    []
  );

  const recentPrompts = prompts?.slice(-5).reverse() ?? [];

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Visão geral</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MetricCard
          title="Solicitações"
          weekValue={formatMetricNumber(metrics?.week.requestCount)}
          monthValue={formatMetricNumber(metrics?.month.requestCount)}
        />
        <MetricCard
          title="Interações"
          weekValue={formatMetricNumber(metrics?.week.interactionCount)}
          monthValue={formatMetricNumber(metrics?.month.interactionCount)}
        />
        <MetricCard
          title="Tempo de processamento"
          weekValue={formatDuration(metrics?.week.durationMs)}
          monthValue={formatDuration(metrics?.month.durationMs)}
        />
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
                {module.daysSinceLastChange === null
                  ? 'Sem dados'
                  : `${module.daysSinceLastChange} ${module.daysSinceLastChange === 1 ? 'dia' : 'dias'}`}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Última alteração: {formatModuleDate(module.lastChangedAt)}
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
            Use as métricas acima para acompanhar o volume de execução e continue compartilhando feedback sobre o que
            devemos priorizar nas próximas entregas.
          </p>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  title,
  weekValue,
  monthValue
}: {
  title: string;
  weekValue: string;
  monthValue: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="text-xs font-medium uppercase text-slate-500">Semana</div>
          <div className="mt-2 text-xl font-bold text-emerald-600 sm:text-2xl">{weekValue}</div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="text-xs font-medium uppercase text-slate-500">Mês</div>
          <div className="mt-2 text-xl font-bold text-emerald-600 sm:text-2xl">{monthValue}</div>
        </div>
      </div>
    </div>
  );
}
