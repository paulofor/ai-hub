package com.aihub.hub.service;

import com.aihub.hub.domain.GrowthMissionRecord;
import com.aihub.hub.dto.GrowthMissionView;
import com.aihub.hub.dto.UpsertGrowthMissionRequest;
import com.aihub.hub.repository.GrowthMissionRepository;
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

    public GrowthMissionService(GrowthMissionRepository repository) {
        this.repository = repository;
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
            return "Modo Operador de Crescimento ativo (fonte de verdade do servidor): produto=%s; objetivo=%s; meta=%d vendas; limite=R$ %s; visitantes=%d; cliques CTA=%d; checkouts=%d; vendas=%d; briefings=%d; entregas=%d; reembolsos=%d; receita=R$ %s; gasto=R$ %s; gargalo=%s; próxima decisão=%s. Use eventos reais, não impacto estimado, solicitações ou PRs, para priorizar. Respeite o limite e as confirmações humanas."
                .formatted(view.product(), view.objective(), view.targetSales(), view.budgetLimit(), view.visitors(), view.ctaClicks(),
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
        BigDecimal cac = mission.getSalesApproved() > 0
            ? mission.getSpend().divide(BigDecimal.valueOf(mission.getSalesApproved()), 2, RoundingMode.HALF_UP)
            : null;
        BigDecimal conversion = mission.getVisitors() > 0
            ? BigDecimal.valueOf(mission.getSalesApproved() * 100d / mission.getVisitors()).setScale(2, RoundingMode.HALF_UP)
            : null;
        Decision decision = decide(mission);
        return new GrowthMissionView(mission.getId(), mission.getProduct(), mission.getObjective(), mission.getTargetSales(),
            mission.getBudgetLimit(), mission.getEndsAt(), mission.getStatus(), mission.getVisitors(), mission.getCtaClicks(),
            mission.getCheckoutsStarted(), mission.getSalesApproved(), mission.getBriefingsCompleted(), mission.getDeliveriesCompleted(),
            mission.getRefunds(), mission.getRevenue(), mission.getSpend(), cac, conversion, decision.bottleneck(), decision.action(), mission.getUpdatedAt());
    }

    private Decision decide(GrowthMissionRecord m) {
        if (m.getSalesApproved() >= m.getTargetSales()) return new Decision("META_ATINGIDA", "Preservar entrega e consolidar aprendizados antes de escalar.");
        if (m.getSpend().compareTo(m.getBudgetLimit()) >= 0) return new Decision("ORCAMENTO_ESGOTADO", "Pausar aquisição paga e pedir autorização antes de novo gasto.");
        if (m.getSalesApproved() > m.getDeliveriesCompleted()) return new Decision("ENTREGA", "Corrigir briefing e entrega antes de aumentar aquisição.");
        if (m.getCheckoutsStarted() >= 5 && m.getSalesApproved() * 100 < m.getCheckoutsStarted() * 20) return new Decision("PAGAMENTO", "Investigar confiança, preço e falhas no pagamento/checkout.");
        if (m.getCtaClicks() >= 20 && m.getCheckoutsStarted() * 100 < m.getCtaClicks() * 20) return new Decision("CHECKOUT", "Reduzir fricção entre CTA e início do checkout.");
        if (m.getVisitors() >= 100 && m.getCtaClicks() * 100 < m.getVisitors() * 3) return new Decision("OFERTA", "Melhorar promessa, prova e CTA da página antes de comprar mais tráfego.");
        if (m.getVisitors() == 0) return new Decision("INSTRUMENTACAO", "Validar rastreamento e obter tráfego mensurável antes de otimizar conversão.");
        return new Decision("TRAFEGO", "Executar um experimento de aquisição controlado e medir o funil completo.");
    }

    private record Decision(String bottleneck, String action) { }
}
