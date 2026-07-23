package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import com.aihub.hub.dto.CodexRequestSummary;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CodexRequestRepository extends JpaRepository<CodexRequest, Long> {
    List<CodexRequest> findAllByOrderByCreatedAtDesc();
    @Query("""
        select new com.aihub.hub.dto.CodexRequestSummary(
            cr.id, cr.environment, cr.model, cr.version, cr.profile,
            cr.prompt, cr.status, cr.rating, cr.externalId,
            cr.pullRequestUrl, cr.workBranch, cr.workBatchKey,
            cr.promptTokens, cr.cachedPromptTokens, cr.completionTokens, cr.totalTokens,
            cr.promptCost, cr.cachedPromptCost, cr.completionCost, cr.cost,
            cr.timeoutCount, cr.httpGetCount, cr.httpGetSuccessCount, cr.dbQueryCount,
            cr.startedAt, cr.finishedAt, cr.durationMs, cr.createdAt, cr.interactionCount,
            problem.id, problem.title, cr.responseText, ''
        )
        from CodexRequest cr
        left join cr.problem problem
        order by cr.createdAt desc
        """)
    Page<CodexRequestSummary> findSummariesByOrderByCreatedAtDesc(Pageable pageable);

    @Query("""
        select new com.aihub.hub.dto.CodexRequestSummary(
            cr.id, cr.environment, cr.model, cr.version, cr.profile,
            cr.prompt, cr.status, cr.rating, cr.externalId,
            cr.pullRequestUrl, cr.workBranch, cr.workBatchKey,
            cr.promptTokens, cr.cachedPromptTokens, cr.completionTokens, cr.totalTokens,
            cr.promptCost, cr.cachedPromptCost, cr.completionCost, cr.cost,
            cr.timeoutCount, cr.httpGetCount, cr.httpGetSuccessCount, cr.dbQueryCount,
            cr.startedAt, cr.finishedAt, cr.durationMs, cr.createdAt, cr.interactionCount,
            problem.id, problem.title, cr.responseText, ''
        )
        from CodexRequest cr
        left join cr.problem problem
        where cr.rating = :rating
        order by cr.createdAt desc
        """)
    Page<CodexRequestSummary> findSummariesByRatingOrderByCreatedAtDesc(Integer rating, Pageable pageable);
    @Query("""
        select count(cr), coalesce(sum(cr.interactionCount), 0), coalesce(sum(cr.durationMs), 0)
        from CodexRequest cr
        where cr.createdAt >= :start
        """)
    Object[] summarizeMetricsSince(@Param("start") Instant start);
    @Query("""
        select cr.createdAt, coalesce(cr.interactionCount, 0), coalesce(cr.durationMs, 0)
        from CodexRequest cr
        where cr.createdAt >= :start
        order by cr.createdAt asc
        """)
    List<Object[]> findMetricRowsSince(@Param("start") Instant start);
    List<CodexRequest> findAllByRatingOrderByCreatedAtDesc(Integer rating);
    List<CodexRequest> findByProblemIdOrderByCreatedAtDesc(Long problemId);
    List<CodexRequest> findByWorkBatchKeyOrderByCreatedAtAsc(String workBatchKey);
    Optional<CodexRequest> findByExternalId(String externalId);
    boolean existsByProfileAndStatusInAndExternalIdIsNotNull(CodexIntegrationProfile profile, Collection<CodexRequestStatus> statuses);
    Optional<CodexRequest> findFirstByProfileAndStatusAndExternalIdIsNullOrderByCreatedAtAsc(CodexIntegrationProfile profile, CodexRequestStatus status);
}
