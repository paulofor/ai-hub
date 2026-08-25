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
import com.aihub.hub.dto.CodexTokenRankingItem;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CodexRequestRepository extends JpaRepository<CodexRequest, Long> {
    List<CodexRequest> findAllByOrderByCreatedAtDesc();
    @Query("""
        select new com.aihub.hub.dto.CodexRequestSummary(
            cr.id, cr.environment, cr.model, cr.reasoningEffort, cr.version, cr.profile,
            cr.prompt, cr.status, cr.rating, cr.externalId,
            cr.pullRequestUrl, cr.workBranch, cr.workBatchKey,
            cr.promptTokens, cr.cachedPromptTokens, cr.completionTokens, cr.totalTokens,
            cr.promptCost, cr.cachedPromptCost, cr.completionCost, cr.cost,
            cr.timeoutCount, cr.httpGetCount, cr.httpGetSuccessCount, cr.dbQueryCount,
            cr.startedAt, cr.finishedAt, cr.durationMs, cr.cloneDurationMs, cr.createdAt, cr.interactionCount,
            problem.id, problem.title,
            (select count(distinct log.documentPath) from CodexDocumentAccessLog log where log.codexRequest = cr),
            cr.responseText, ''
        )
        from CodexRequest cr
        left join cr.problem problem
        order by cr.createdAt desc
        """)
    Page<CodexRequestSummary> findSummariesByOrderByCreatedAtDesc(Pageable pageable);

    @Query("""
        select new com.aihub.hub.dto.CodexRequestSummary(
            cr.id, cr.environment, cr.model, cr.reasoningEffort, cr.version, cr.profile,
            cr.prompt, cr.status, cr.rating, cr.externalId,
            cr.pullRequestUrl, cr.workBranch, cr.workBatchKey,
            cr.promptTokens, cr.cachedPromptTokens, cr.completionTokens, cr.totalTokens,
            cr.promptCost, cr.cachedPromptCost, cr.completionCost, cr.cost,
            cr.timeoutCount, cr.httpGetCount, cr.httpGetSuccessCount, cr.dbQueryCount,
            cr.startedAt, cr.finishedAt, cr.durationMs, cr.cloneDurationMs, cr.createdAt, cr.interactionCount,
            problem.id, problem.title,
            (select count(distinct log.documentPath) from CodexDocumentAccessLog log where log.codexRequest = cr),
            cr.responseText, ''
        )
        from CodexRequest cr
        left join cr.problem problem
        where cr.rating = :rating
        order by cr.createdAt desc
        """)
    Page<CodexRequestSummary> findSummariesByRatingOrderByCreatedAtDesc(Integer rating, Pageable pageable);

    @Query("""
        select new com.aihub.hub.dto.CodexTokenRankingItem(
            cr.id, cr.environment, cr.model, cr.reasoningEffort, cr.profile, cr.status,
            cr.promptTokens, cr.cachedPromptTokens, cr.completionTokens, cr.totalTokens,
            cr.cost, cr.durationMs, cr.createdAt, cr.prompt, cr.responseText, ''
        )
        from CodexRequest cr
        where cr.totalTokens is not null
        order by cr.totalTokens desc, cr.id desc
        """)
    List<CodexTokenRankingItem> findTokenRanking(Pageable pageable);
    @Query("""
        select count(cr), coalesce(sum(cr.interactionCount), 0), coalesce(sum(cr.durationMs), 0)
        from CodexRequest cr
        where cr.createdAt >= :start
        """)
    Object[] summarizeMetricsSince(@Param("start") Instant start);
    @Query("""
        select count(cr), coalesce(sum(cr.interactionCount), 0), coalesce(sum(cr.durationMs), 0)
        from CodexRequest cr
        where cr.createdAt >= :start
          and cr.profile = :profile
        """)
    Object[] summarizeMetricsSinceAndProfile(@Param("start") Instant start, @Param("profile") CodexIntegrationProfile profile);
    @Query("""
        select cr.createdAt, coalesce(cr.interactionCount, 0), coalesce(cr.durationMs, 0)
        from CodexRequest cr
        where cr.createdAt >= :start
        order by cr.createdAt asc
        """)
    List<Object[]> findMetricRowsSince(@Param("start") Instant start);
    @Query("""
        select cr.createdAt, coalesce(cr.interactionCount, 0), coalesce(cr.durationMs, 0)
        from CodexRequest cr
        where cr.createdAt >= :start
          and cr.profile = :profile
        order by cr.createdAt asc
        """)
    List<Object[]> findMetricRowsSinceAndProfile(@Param("start") Instant start, @Param("profile") CodexIntegrationProfile profile);
    @Query("""
        select cr.responseText
        from CodexRequest cr
        where cr.createdAt >= :start
          and cr.responseText is not null
        """)
    List<String> findResponseTextsSince(@Param("start") Instant start);
    @Query("""
        select cr.responseText
        from CodexRequest cr
        where cr.createdAt >= :start
          and cr.profile = :profile
          and cr.responseText is not null
        """)
    List<String> findResponseTextsSinceAndProfile(@Param("start") Instant start, @Param("profile") CodexIntegrationProfile profile);
    @Query("""
        select cr.id, cr.createdAt, cr.responseText
        from CodexRequest cr
        where cr.profile = :profile
        order by cr.createdAt desc
        """)
    List<Object[]> findRecentSalesImpactRowsByProfile(@Param("profile") CodexIntegrationProfile profile, Pageable pageable);
    @Query("""
        select cr.id, cr.createdAt, cr.responseText
        from CodexRequest cr
        where cr.profile = :profile
          and cr.createdAt >= :start
          and cr.responseText is not null
        order by cr.createdAt asc
        """)
    List<Object[]> findSalesImpactRowsSinceAndProfile(@Param("start") Instant start, @Param("profile") CodexIntegrationProfile profile);
    @Query("""
        select cr.id, cr.createdAt, cr.responseText
        from CodexRequest cr
        where cr.profile = :profile
          and cr.responseText is not null
        order by cr.createdAt desc
        """)
    List<Object[]> findSalesImpactRowsByProfile(@Param("profile") CodexIntegrationProfile profile);
    List<CodexRequest> findAllByRatingOrderByCreatedAtDesc(Integer rating);
    List<CodexRequest> findByProblemIdOrderByCreatedAtDesc(Long problemId);
    List<CodexRequest> findByWorkBatchKeyOrderByCreatedAtAsc(String workBatchKey);
    @Query("""
        select cr
        from CodexRequest cr
        where cr.environment = :environment
          and cr.profile = :profile
          and (cr.workBatchKey is not null or cr.workBranch is not null)
          and (cr.pullRequestUrl is null or cr.pullRequestUrl = '')
        order by cr.createdAt desc
        """)
    List<CodexRequest> findOpenBatchCandidates(@Param("environment") String environment,
                                               @Param("profile") CodexIntegrationProfile profile,
                                               Pageable pageable);
    Optional<CodexRequest> findFirstByIdLessThanOrderByIdDesc(Long id);
    Optional<CodexRequest> findByExternalId(String externalId);
    List<CodexRequest> findByStatusInAndExternalIdIsNotNullOrderByCreatedAtAsc(Collection<CodexRequestStatus> statuses);
    boolean existsByProfileAndStatusInAndExternalIdIsNotNull(CodexIntegrationProfile profile, Collection<CodexRequestStatus> statuses);
    Optional<CodexRequest> findFirstByProfileAndStatusAndExternalIdIsNullOrderByCreatedAtAsc(CodexIntegrationProfile profile, CodexRequestStatus status);
}
