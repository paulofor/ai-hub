import { useState } from 'react';
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
  recentSalesImpact?: SalesImpactPoint[];
}

interface SalesImpactPoint {
  requestId: number;
  createdAt: string;
  score: number | null;
}

interface SalesImpactScore {
  muitoBaixo: number;
  baixo: number;
  medio: number;
  alto: number;
  muitoAlto: number;
  total: number;
}

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
  const [salesView, setSalesView] = useState<'daily' | 'weekly'>('daily');
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Notas de venda</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Evolução das notas declaradas pelo perfil de Marketing, considerando o dia operacional (03h–03h).
          </p>
          </div>
          <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800" aria-label="Período do gráfico de notas de venda">
            {(['daily', 'weekly'] as const).map((view) => (
              <button key={view} type="button" onClick={() => setSalesView(view)} aria-pressed={salesView === view}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${salesView === view ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-300'}`}>
                {view === 'daily' ? 'Diário' : 'Semanal'}
              </button>
            ))}
          </div>
        </div>
        <SalesImpactTimeline view={salesView} metrics={salesMetrics} />
        <p className="mt-4 text-xs text-slate-500">
          As notas representam relevância estimada pelo modelo, não vendas confirmadas.
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

function SalesImpactTimeline({ view, metrics }: { view: 'daily' | 'weekly'; metrics?: CodexDashboardMetrics | null }) {
  const points = (metrics?.recentSalesImpact ?? []).filter((point): point is SalesImpactPoint & { score: number } =>
    typeof point.score === 'number' && point.score >= 1 && point.score <= 5
  );
  const start = new Date(view === 'daily' ? metrics?.day?.startsAt ?? 0 : metrics?.week?.startsAt ?? 0).getTime();
  const visiblePoints = points.filter((point) => new Date(point.createdAt).getTime() >= start);

  if (visiblePoints.length === 0) {
    return <div className="mt-5 rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-slate-800">Sem avaliações no período.</div>;
  }

  const operationalDateKey = (value: string) => {
    const date = new Date(value);
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(date.getTime() - 3 * 60 * 60 * 1000));
  };
  const dailyAverages = Array.from(visiblePoints.reduce((groups, point) => {
    const key = operationalDateKey(point.createdAt);
    const values = groups.get(key) ?? [];
    values.push(point.score);
    groups.set(key, values);
    return groups;
  }, new Map<string, number[]>())).map(([date, scores]) => ({ date, average: scores.reduce((sum, score) => sum + score, 0) / scores.length }));
  const average = visiblePoints.reduce((sum, point) => sum + point.score, 0) / visiblePoints.length;

  return (
    <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex items-end justify-between gap-3">
        <div><h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{view === 'daily' ? 'Notas do dia operacional' : 'Média diária da semana operacional'}</h4>
          <p className="text-xs text-slate-500">{view === 'daily' ? 'Cada barra é uma nota de venda.' : 'Cada tick é a média geral das notas daquele dia.'}</p></div>
        <div className="text-right"><span className="text-2xl font-bold text-emerald-600">{average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span><p className="text-xs text-slate-500">média geral</p></div>
      </div>
      <div className="mt-5 flex h-52 gap-3" role="img" aria-label={view === 'daily' ? 'Gráfico diário com uma barra por nota de venda' : 'Gráfico semanal com um tick de média por dia operacional'}>
        <div className="flex flex-col justify-between pb-6 text-xs text-slate-400">{[5, 4, 3, 2, 1].map((tick) => <span key={tick}>{tick}</span>)}</div>
        <div className="relative flex min-w-0 flex-1 items-end gap-2 border-b border-l border-slate-200 px-2 pb-6 dark:border-slate-700">
          {view === 'daily' ? visiblePoints.map((point) => (
            <div key={point.requestId} className="flex min-w-[12px] flex-1 flex-col items-center justify-end" style={{ height: '100%' }} title={`Nota ${point.score} · ${new Date(point.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`}>
              <span className="mb-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">{point.score}</span>
              <div className="w-full max-w-10 rounded-t bg-emerald-500" style={{ height: `${point.score * 20}%` }} />
            </div>
          )) : dailyAverages.map((point) => (
            <div key={point.date} className="relative h-full flex-1 text-center" title={`${formatChartDate(`${point.date}T12:00:00Z`)} · média ${point.average.toFixed(1)}`}>
              <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: `calc(${point.average * 20}% - 6px)` }}>
                <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs font-bold text-emerald-700 dark:text-emerald-300">{point.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>
                <div className="h-3 w-3 rounded-full border-2 border-white bg-emerald-500 shadow" />
              </div>
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-slate-500">{formatChartDate(`${point.date}T12:00:00Z`, { weekday: 'short' }).replace('.', '')}</span>
            </div>
          ))}
        </div>
      </div>
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
