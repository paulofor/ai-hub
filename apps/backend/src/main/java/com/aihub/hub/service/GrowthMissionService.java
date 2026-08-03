package com.aihub.hub.service;

import com.aihub.hub.domain.GrowthMissionRecord;
import com.aihub.hub.dto.GrowthMissionView;
import com.aihub.hub.dto.UpsertGrowthMissionRequest;
import com.aihub.hub.repository.GrowthMissionRepository;
import com.aihub.hub.repository.GrowthEventRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

@Service
public class GrowthMissionService {
    private static final Set<String> STATUSES = Set.of("ACTIVE", "PAUSED", "COMPLETED");
    private final GrowthMissionRepository repository;
    private final GrowthEventRepository events;

    public GrowthMissionService(GrowthMissionRepository repository, GrowthEventRepository events) {
        this.repository = repository;
        this.events = events;
    }

    @Transactional(readOnly = true)
    public GrowthMissionView current() {
        return repository.findFirstByStatusOrderByUpdatedAtDesc("ACTIVE")
            .or(() -> repository.findAll().stream().max((a, b) -> a.getUpdatedAt().compareTo(b.getUpdatedAt())))
            .map(this::toView)
            .orElse(null);
    }

    @Transactional(readOnly = true)
    public Optional<String> operatorContext() {
        return repository.findFirstByStatusOrderByUpdatedAtDesc("ACTIVE").map(mission -> {
            GrowthMissionView view = toView(mission);
            return "Modo Operador de Crescimento ativo (fonte automática do servidor: %s, %d eventos): produto=%s; objetivo=%s; meta=%d vendas; limite=R$ %s; visitantes=%d; cliques CTA=%d; checkouts=%d; vendas=%d; briefings=%d; entregas=%d; reembolsos=%d; receita=R$ %s; gasto=R$ %s; gargalo=%s; próxima decisão=%s. Use eventos reais, não impacto estimado, solicitações ou PRs, para priorizar. Se a fonte estiver aguardando eventos, investigue a instrumentação; não peça preenchimento manual. Respeite o limite e as confirmações humanas."
                .formatted(view.metricsSource(), view.receivedEvents(), view.product(), view.objective(), view.targetSales(), view.budgetLimit(), view.visitors(), view.ctaClicks(),
                    view.checkoutsStarted(), view.salesApproved(), view.briefingsCompleted(), view.deliveriesCompleted(), view.refunds(),
                    view.revenue(), view.spend(), view.bottleneck(), view.recommendedAction());
        });
    }

    @Transactional
    public GrowthMissionView save(UpsertGrowthMissionRequest request) {
        String status = request.status().trim().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Status deve ser ACTIVE, PAUSED ou COMPLETED");
        }
        if (request.ctaClicks() > request.visitors()
            || request.checkoutsStarted() > request.ctaClicks()
            || request.salesApproved() > request.checkoutsStarted()
            || request.briefingsCompleted() > request.salesApproved()
            || request.deliveriesCompleted() > request.salesApproved()
            || request.refunds() > request.salesApproved()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Métricas inconsistentes: cada etapa do funil não pode superar a etapa anterior, e briefing, entrega ou reembolso não podem superar vendas");
        }
        GrowthMissionRecord mission = repository.findFirstByStatusOrderByUpdatedAtDesc("ACTIVE")
            .orElseGet(GrowthMissionRecord::new);
        mission.setProduct(request.product().trim());
        mission.setObjective(request.objective().trim());
        mission.setTargetSales(request.targetSales());
        mission.setBudgetLimit(request.budgetLimit());
        mission.setEndsAt(request.endsAt());
        mission.setStatus(status);
        mission.setVisitors(request.visitors());
        mission.setCtaClicks(request.ctaClicks());
        mission.setCheckoutsStarted(request.checkoutsStarted());
        mission.setSalesApproved(request.salesApproved());
        mission.setBriefingsCompleted(request.briefingsCompleted());
        mission.setDeliveriesCompleted(request.deliveriesCompleted());
        mission.setRefunds(request.refunds());
        mission.setRevenue(request.revenue());
        mission.setSpend(request.spend());
        return toView(repository.save(mission));
    }

    GrowthMissionView toView(GrowthMissionRecord mission) {
        var eventList = mission.getId() == null ? java.util.List.<com.aihub.hub.domain.GrowthEventRecord>of()
            : events.findByMissionIdOrderByOccurredAtAsc(mission.getId());
        Metrics metrics = eventList.isEmpty() ? Metrics.fromLegacy(mission) : Metrics.fromEvents(eventList);
        BigDecimal cac = metrics.salesApproved() > 0
            ? metrics.spend().divide(BigDecimal.valueOf(metrics.salesApproved()), 2, RoundingMode.HALF_UP)
            : null;
        BigDecimal conversion = metrics.visitors() > 0
            ? BigDecimal.valueOf(metrics.salesApproved() * 100d / metrics.visitors()).setScale(2, RoundingMode.HALF_UP)
            : null;
        Decision decision = decide(mission, metrics);
        return new GrowthMissionView(mission.getId(), mission.getProduct(), mission.getObjective(), mission.getTargetSales(),
            mission.getBudgetLimit(), mission.getEndsAt(), mission.getStatus(), metrics.visitors(), metrics.ctaClicks(),
            metrics.checkoutsStarted(), metrics.salesApproved(), metrics.briefingsCompleted(), metrics.deliveriesCompleted(),
            metrics.refunds(), metrics.revenue(), metrics.spend(), cac, conversion, decision.bottleneck(), decision.action(),
            eventList.isEmpty() ? "AGUARDANDO_EVENTOS" : "EVENTOS_AUTOMATICOS", (long) eventList.size(),
            eventList.isEmpty() ? null : eventList.get(eventList.size() - 1).getOccurredAt(), mission.getUpdatedAt());
    }

    private Decision decide(GrowthMissionRecord mission, Metrics m) {
        if (m.salesApproved() >= mission.getTargetSales()) return new Decision("META_ATINGIDA", "Preservar entrega e consolidar aprendizados antes de escalar.");
        if (m.spend().compareTo(mission.getBudgetLimit()) >= 0) return new Decision("ORCAMENTO_ESGOTADO", "Pausar aquisição paga e pedir autorização antes de novo gasto.");
        if (m.salesApproved() > m.deliveriesCompleted()) return new Decision("ENTREGA", "Corrigir briefing e entrega antes de aumentar aquisição.");
        if (m.checkoutsStarted() >= 5 && m.salesApproved() * 100 < m.checkoutsStarted() * 20) return new Decision("PAGAMENTO", "Investigar confiança, preço e falhas no pagamento/checkout.");
        if (m.ctaClicks() >= 20 && m.checkoutsStarted() * 100 < m.ctaClicks() * 20) return new Decision("CHECKOUT", "Reduzir fricção entre CTA e início do checkout.");
        if (m.visitors() >= 100 && m.ctaClicks() * 100 < m.visitors() * 3) return new Decision("OFERTA", "Melhorar promessa, prova e CTA da página antes de comprar mais tráfego.");
        if (m.visitors() == 0) return new Decision("INSTRUMENTACAO", "Aguardar ou corrigir a integração automática de eventos antes de otimizar conversão.");
        return new Decision("TRAFEGO", "Executar um experimento de aquisição controlado e medir o funil completo.");
    }

    private record Metrics(long visitors, long ctaClicks, long checkoutsStarted, long salesApproved,
                           long briefingsCompleted, long deliveriesCompleted, long refunds,
                           BigDecimal revenue, BigDecimal spend) {
        static Metrics fromLegacy(GrowthMissionRecord m) {
            return new Metrics(m.getVisitors(), m.getCtaClicks(), m.getCheckoutsStarted(), m.getSalesApproved(),
                m.getBriefingsCompleted(), m.getDeliveriesCompleted(), m.getRefunds(), m.getRevenue(), m.getSpend());
        }

        static Metrics fromEvents(java.util.List<com.aihub.hub.domain.GrowthEventRecord> events) {
            long visitors = 0, clicks = 0, checkouts = 0, sales = 0, briefings = 0, deliveries = 0, refunds = 0;
            BigDecimal revenue = BigDecimal.ZERO, spend = BigDecimal.ZERO;
            for (var event : events) {
                switch (event.getType()) {
                    case "VISITOR" -> visitors++;
                    case "CTA_CLICK" -> clicks++;
                    case "CHECKOUT_STARTED" -> checkouts++;
                    case "SALE_APPROVED" -> { sales++; revenue = revenue.add(event.getAmount()); }
                    case "BRIEFING_COMPLETED" -> briefings++;
                    case "DELIVERY_COMPLETED" -> deliveries++;
                    case "REFUND" -> { refunds++; revenue = revenue.subtract(event.getAmount()); }
                    case "AD_SPEND" -> spend = spend.add(event.getAmount());
                    default -> { }
                }
            }
            return new Metrics(visitors, clicks, checkouts, sales, briefings, deliveries, refunds,
                revenue.max(BigDecimal.ZERO), spend);
        }
    }

    private record Decision(String bottleneck, String action) { }
}
