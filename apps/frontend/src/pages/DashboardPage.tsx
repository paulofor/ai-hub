import { useFetch } from '../hooks/useFetch';
import client from '../api/client';
import { formatDuration } from '../lib/codex';

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
  day: CodexDashboardMetricWindow;
  week: CodexDashboardMetricWindow;
  month: CodexDashboardMetricWindow;
  series: {
    daily: CodexDashboardMetricWindow[];
    weekly: CodexDashboardMetricWindow[];
    monthly: CodexDashboardMetricWindow[];
  };
  salesImpactDay?: SalesImpactScore;
  salesImpactWeek?: SalesImpactScore;
  salesImpactMonth?: SalesImpactScore;
}

interface SalesImpactScore {
  muitoBaixo: number;
  baixo: number;
  medio: number;
  alto: number;
  muitoAlto: number;
  total: number;
}

const SALES_IMPACT_LEVELS = [
  { key: 'muitoBaixo', label: 'Muito baixo', color: 'bg-slate-400' },
  { key: 'baixo', label: 'Baixo', color: 'bg-rose-400' },
  { key: 'medio', label: 'Médio', color: 'bg-amber-400' },
  { key: 'alto', label: 'Alto', color: 'bg-emerald-500' },
  { key: 'muitoAlto', label: 'Muito alto', color: 'bg-teal-600' }
] as const;

function formatModuleDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : 'indisponível';
}

function formatMetricNumber(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—';
}

function formatChartDate(value: string, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('pt-BR', {
    ...options,
    timeZone: 'America/Sao_Paulo'
  });
}

function formatShortDuration(milliseconds?: number) {
  if (milliseconds === undefined || milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return '0min';
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  if (totalSeconds > 0 && totalSeconds < 60) {
    return '<1min';
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`;
  }
  if (minutes > 0) {
    return `${minutes}min`;
  }
  return '0min';
}

export default function DashboardPage() {
  const { data: sourceModules } = useFetch<SourceModuleChange[]>(
    () => client.get('/source-modules/changes').then((res) => res.data),
    []
  );

  const { data: metrics } = useFetch<CodexDashboardMetrics>(
    () => client.get('/codex/requests/metrics').then((res) => res.data),
    []
  );

  const { data: salesMetrics } = useFetch<CodexDashboardMetrics>(
    () => client.get('/codex/requests/metrics', { params: { profile: 'CHATGPT_CODEX_MKT' } }).then((res) => res.data),
    []
  );

  const last14Days = metrics?.series.daily.slice(-14) ?? [];
  const last10Weeks = metrics?.series.weekly.slice(-10) ?? [];

  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold">Visão geral</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <MetricCard
          title="Solicitações"
          dayValue={formatMetricNumber(metrics?.day.requestCount)}
          weekValue={formatMetricNumber(metrics?.week.requestCount)}
          monthValue={formatMetricNumber(metrics?.month.requestCount)}
        />
        <MetricCard
          title="Interações"
          dayValue={formatMetricNumber(metrics?.day.interactionCount)}
          weekValue={formatMetricNumber(metrics?.week.interactionCount)}
          monthValue={formatMetricNumber(metrics?.month.interactionCount)}
        />
        <MetricCard
          title="Tempo de processamento"
          dayValue={formatDuration(metrics?.day.durationMs)}
          weekValue={formatDuration(metrics?.week.durationMs)}
          monthValue={formatDuration(metrics?.month.durationMs)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <MetricSeriesPanel
          title="Últimos 14 dias"
          emptyMessage="Sem dados diários para exibir."
          buckets={last14Days}
          labelForBucket={(bucket, index) => {
            if (index === 0 || index === last14Days.length - 1 || index % 4 === 0) {
              return formatChartDate(bucket.startsAt);
            }
            return '';
          }}
        />
        <MetricSeriesPanel
          title="Últimas 10 semanas"
          emptyMessage="Sem dados semanais para exibir."
          buckets={last10Weeks}
          labelForBucket={(bucket, index) => {
            if (index === 0 || index === last10Weeks.length - 1 || index % 3 === 0) {
              return formatChartDate(bucket.startsAt);
            }
            return '';
          }}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-5">
        <div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Relevância estimada em vendas</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Distribuição das entregas do perfil de Marketing por potencial declarado de impacto comercial.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SalesImpactChart title="Hoje" score={salesMetrics?.salesImpactDay} />
          <SalesImpactChart title="Esta semana" score={salesMetrics?.salesImpactWeek} />
          <SalesImpactChart title="Este mês" score={salesMetrics?.salesImpactMonth} />
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Estes contadores representam relevância estimada pelo modelo, não vendas confirmadas.
        </p>
      </section>

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

    </section>
  );
}

function SalesImpactChart({ title, score }: { title: string; score?: SalesImpactScore }) {
  const total = score?.total ?? 0;

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4>
        <span className="text-2xl font-bold text-emerald-600">{formatMetricNumber(total)}</span>
      </div>
      <p className="text-xs text-slate-500">entregas avaliadas</p>
      {total > 0 ? (
        <div className="mt-4 space-y-3">
          {SALES_IMPACT_LEVELS.map(({ key, label, color }) => {
            const value = score?.[key] ?? 0;
            const percentage = Math.round((value / total) * 100);
            return (
              <div key={key}>
                <div className="mb-1 flex justify-between gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{label}</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{value} · {percentage}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
          Sem avaliações no período.
        </div>
      )}
    </div>
  );
}

function MetricSeriesPanel({
  title,
  emptyMessage,
  buckets,
  labelForBucket
}: {
  title: string;
  emptyMessage: string;
  buckets: CodexDashboardMetricWindow[];
  labelForBucket: (bucket: CodexDashboardMetricWindow, index: number) => string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Gráficos de volume, uso e tempo por período.
          </p>
        </div>
      </div>
      {buckets.length > 0 ? (
        <div className="mt-4 space-y-5">
          <MiniBarChart
            title="Tempo"
            buckets={buckets}
            getValue={(bucket) => bucket.durationMs}
            formatValue={formatShortDuration}
            labelForBucket={labelForBucket}
            barClassName="bg-amber-500"
          />
          <MiniBarChart
            title="Solicitações"
            buckets={buckets}
            getValue={(bucket) => bucket.requestCount}
            formatValue={formatMetricNumber}
            labelForBucket={labelForBucket}
            barClassName="bg-emerald-500"
          />
          <MiniBarChart
            title="Interações"
            buckets={buckets}
            getValue={(bucket) => bucket.interactionCount}
            formatValue={formatMetricNumber}
            labelForBucket={labelForBucket}
            barClassName="bg-sky-500"
          />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

function MiniBarChart({
  title,
  buckets,
  getValue,
  formatValue,
  labelForBucket,
  barClassName
}: {
  title: string;
  buckets: CodexDashboardMetricWindow[];
  getValue: (bucket: CodexDashboardMetricWindow) => number;
  formatValue: (value: number) => string;
  labelForBucket: (bucket: CodexDashboardMetricWindow, index: number) => string;
  barClassName: string;
}) {
  const values = buckets.map((bucket) => getValue(bucket));
  const maxValue = Math.max(1, ...values);
  const periodLabel =
    buckets.length > 0
      ? `${formatChartDate(buckets[0].startsAt)} a ${formatChartDate(buckets[buckets.length - 1].startsAt)}`
      : '';

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4>
          <div className="mt-0.5 text-[10px] leading-none text-slate-500 sm:hidden">{periodLabel}</div>
        </div>
      </div>
      <div className="flex h-36 items-end gap-1 rounded-lg border border-slate-100 bg-slate-50/80 px-2 pb-7 pt-3 dark:border-slate-800 dark:bg-slate-950/40">
        {buckets.map((bucket, index) => {
          const value = getValue(bucket);
          const height = value > 0 ? Math.max(8, Math.round((value / maxValue) * 100)) : 2;
          const label = labelForBucket(bucket, index);
          const fullLabel = formatChartDate(bucket.startsAt, { day: '2-digit', month: '2-digit', year: '2-digit' });
          return (
            <div key={`${bucket.startsAt}-${index}`} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
              <div
                className={`w-full max-w-8 rounded-t-sm ${barClassName}`}
                style={{ height: `${height}%` }}
                title={`${fullLabel}: ${formatValue(value)}`}
                aria-label={`${fullLabel}: ${formatValue(value)}`}
              />
              <span className="absolute top-full mt-1 hidden w-12 -translate-x-1/2 left-1/2 truncate text-center text-[10px] leading-none text-slate-500 sm:block">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({
  title,
  dayValue,
  weekValue,
  monthValue
}: {
  title: string;
  dayValue: string;
  weekValue: string;
  monthValue: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-5">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="text-xs font-medium uppercase text-slate-500">Dia</div>
          <div className="mt-2 whitespace-nowrap text-xl font-bold leading-tight text-emerald-600 sm:text-[clamp(1.0625rem,1.2vw,1.25rem)]">
            {dayValue}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="text-xs font-medium uppercase text-slate-500">Semana</div>
          <div className="mt-2 whitespace-nowrap text-xl font-bold leading-tight text-emerald-600 sm:text-[clamp(1.0625rem,1.2vw,1.25rem)]">
            {weekValue}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/40 sm:col-span-2">
          <div className="text-xs font-medium uppercase text-slate-500">Mês</div>
          <div className="mt-2 whitespace-nowrap text-xl font-bold leading-tight text-emerald-600 sm:text-[clamp(1.0625rem,1.2vw,1.25rem)]">
            {monthValue}
          </div>
        </div>
      </div>
    </div>
  );
}
