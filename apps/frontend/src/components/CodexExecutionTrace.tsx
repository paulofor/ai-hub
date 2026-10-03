import { useState } from 'react';
import type { ExecutionTrace, TraceEvent, TracePlan, TraceStatus } from '../lib/executionTrace';

const statusLabels: Record<TraceStatus, string> = { pending: 'Pendente', running: 'Executando', completed: 'Concluído', failed: 'Falha', cancelled: 'Interrompido' };
const statusStyles: Record<TraceStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  running: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  cancelled: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
};
const statusIcons: Record<TraceStatus, string> = { pending: '○', running: '◉', completed: '✓', failed: '×', cancelled: '−' };
const when = (date: string) => new Date(date).toLocaleString('pt-BR');
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
const eventAnchor = (id: string) => `trace-event-${encodeURIComponent(id)}`;

function Status({ value }: { value: TraceStatus }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyles[value]}`}>
    <span aria-hidden>{statusIcons[value]}</span>{statusLabels[value]}
  </span>;
}

function PlanSteps({ plan, events, plans, onEvidence }: {
  plan: TracePlan; events: TraceEvent[]; plans: TracePlan[]; onEvidence: () => void;
}) {
  return <ol className="mt-3 space-y-3" data-testid="execution-checklist">
    {plan.steps.map((step, index) => {
      const observations = events.filter((event) => event.stepIndex !== undefined && event.kind !== 'plan'
        && plans.find((snapshot) => snapshot.id === event.planId)?.steps[event.stepIndex]?.step === step.step);
      const results = observations.filter((event) => event.status !== 'running' && event.status !== 'pending');
      const failures = results.filter((event) => event.status === 'failed').length;
      const evidenceLink = (event: TraceEvent) => <a key={event.id} href={`#${eventAnchor(event.id)}`} onClick={onEvidence}
        className="font-semibold text-sky-700 underline dark:text-sky-300">Ver {event.label.toLocaleLowerCase('pt-BR')} · {statusLabels[event.status]}</a>;
      return <li key={`${index}-${step.step}`} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0 flex-1 break-words text-sm">{step.step}</span><Status value={step.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{results.length ? `${results.length} resultado(s) observado(s) durante esta etapa${failures ? ` · ${failures} com falha` : ''}` : 'Sem resultado observado para esta etapa'}</span>
          {observations.slice(-3).map(evidenceLink)}
        </div>
        {observations.length > 3 ? <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-sky-700 dark:text-sky-300">Todas as evidências ({observations.length})</summary>
          <ul className="mt-2 space-y-2">{observations.map((event) => <li key={event.id}>{evidenceLink(event)}</li>)}</ul>
        </details> : null}
      </li>;
    })}
  </ol>;
}

export default function CodexExecutionTrace({ trace, legacySteps = [] }: { trace?: ExecutionTrace; legacySteps?: TracePlan['steps'] }) {
  const [visibleCount, setVisibleCount] = useState(40);
  const plans = trace?.plans ?? [];
  const plan = plans[plans.length - 1];
  const events = trace?.events ?? [];
  const active = events.filter((event) => event.status === 'running');
  const legacy: TracePlan = { id: 'legacy', turnId: '', receivedAt: '', steps: legacySteps };
  const shown = events.slice(-visibleCount);
  return <div className="min-w-0 space-y-4" data-testid="codex-execution-trace">
    <section className="rounded-lg border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/60" aria-labelledby="execution-checklist-title">
      <h4 id="execution-checklist-title" className="text-sm font-semibold">Checklist da execução</h4>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Os estados do plano são declarados pelo modelo. Consulte os resultados das operações para verificar as evidências.</p>
      {plan ? <>
        <p className="mt-2 text-xs text-slate-500">Atualizado em {when(plan.receivedAt)}</p>
        <PlanSteps plan={plan} plans={plans} events={events} onEvidence={() => setVisibleCount(events.length)} />
      </> : legacySteps.length ? <>
        <p className="mt-2 text-xs text-slate-500">Checklist antigo: o registro não distingue pendente de executando.</p>
        <PlanSteps plan={legacy} plans={[]} events={[]} onEvidence={() => {}} />
      </> : <p className="mt-3 text-sm text-slate-500">Nenhum checklist publicado nesta solicitação.</p>}
      {plans.length > 1 ? <details className="mt-3 text-xs" data-testid="execution-plan-history">
        <summary className="cursor-pointer font-semibold text-sky-700 dark:text-sky-300">Histórico do checklist ({plans.length} versões)</summary>
        <ol className="mt-3 space-y-3">{plans.map((snapshot) => <li key={snapshot.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
          <p>{when(snapshot.receivedAt)} · Turno {snapshot.turnId}</p>
          {snapshot.explanation ? <p className="mt-1 break-words">{snapshot.explanation}</p> : null}
          <ul className="mt-1 space-y-1">{snapshot.steps.map((step, index) => <li key={index} className="flex flex-wrap items-start gap-2"><Status value={step.status} /><span className="min-w-0 flex-1 break-words">{step.step}</span></li>)}</ul>
        </li>)}</ol>
      </details> : null}
    </section>
    <section className="rounded-lg border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/20" aria-labelledby="execution-timeline-title">
      <h4 id="execution-timeline-title" className="text-sm font-semibold">Linha do tempo</h4>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{events.length} eventos · {events.filter((event) => event.status === 'failed').length} com falha · {active.length} em execução</p>
      {active.length ? <p role="status" className="mt-2 break-words text-sm font-semibold text-sky-800 dark:text-sky-200">Em execução: {active.map((event) => event.label).join(', ')}</p> : null}
      {(trace?.droppedEvents || trace?.droppedPlans) ? <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">Limite de histórico: {trace.droppedEvents} evento(s) e {trace.droppedPlans} versão(ões) anterior(es) omitidos.</p> : null}
      {!events.length ? <p className="mt-3 text-sm text-slate-500">Eventos estruturados indisponíveis para esta solicitação.</p> : <>
        {events.length > shown.length ? <button type="button" className="mt-3 text-xs font-semibold text-sky-700 underline dark:text-sky-300" onClick={() => setVisibleCount((count) => count + 40)}>Mostrar eventos anteriores ({events.length - shown.length})</button> : null}
        <ol className="mt-3 space-y-3" data-testid="execution-timeline">
          {shown.map((event) => <li key={event.id} id={eventAnchor(event.id)} className="min-w-0 scroll-mt-24 rounded-md border border-sky-100 bg-white/80 p-3 dark:border-sky-900 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 flex-1 break-words text-sm font-semibold">{event.label}</span><Status value={event.status} /></div>
            <p className="mt-1 text-xs text-slate-500"><time dateTime={event.receivedAt}>Recebido em {when(event.receivedAt)}</time>{event.durationMs !== undefined ? ` · ${duration(event.durationMs)} (${event.durationSource === 'provider' ? 'informado pelo executor' : 'medido entre eventos'})` : ''}</p>
            {event.result ? <p className="mt-2 break-words text-sm">{event.result}</p> : <p className="mt-2 text-xs text-slate-500">Aguardando resultado da operação.</p>}
            {event.evidence.length ? <ul className="mt-2 flex flex-wrap gap-3 text-xs">{event.evidence.map((link) => <li key={link.url}><a className="break-all font-semibold text-sky-700 underline dark:text-sky-300" href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a></li>)}</ul> : null}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-600 dark:text-slate-300">Detalhes técnicos</summary>
              <p className="mt-2 break-all text-slate-500">Turno: {event.turnId}{event.itemId ? ` · Item: ${event.itemId}` : ''}{event.planId ? ` · Checklist: ${event.planId}` : ''}</p>
              {event.finishedAt ? <p className="mt-1">Encerrado em {when(event.finishedAt)}</p> : null}
              {event.details?.command ? <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 dark:bg-slate-950">{event.details.command}</pre> : null}
              {event.details?.output ? <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 dark:bg-slate-950">{event.details.output}</pre> : null}
              {event.details?.files?.length ? <ul className="mt-2 space-y-1">{event.details.files.map((path) => <li key={path} className="break-all font-mono">{path}</li>)}</ul> : null}
              {event.kind === 'plan' ? <ul className="mt-2 space-y-1">{plans.find((snapshot) => snapshot.id === event.planId)?.steps.map((step, index) => <li key={index}>{statusLabels[step.status]} · {step.step}</li>)}</ul> : null}
            </details>
          </li>)}
        </ol>
      </>}
    </section>
  </div>;
}
