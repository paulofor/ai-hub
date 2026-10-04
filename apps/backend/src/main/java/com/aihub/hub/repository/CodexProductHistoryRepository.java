package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.dto.CodexProductRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface CodexProductHistoryRepository extends Repository<CodexRequest, Long> {
    interface ProductSummary {
        String getProductName();
        long getRequestCount();
        Instant getLatestRequestAt();
    }

    // Include historical names even after a catalog rename/deletion. Only MKT
    // contributes requests, counts and activity dates. UNION deduplicates names.
    @Query(value = """
        select names.product_name as productName, count(cr.id) as requestCount,
               max(cr.created_at) as latestRequestAt
        from (
            select name as product_name from products where trim(name) <> ''
            union
            select product_name from codex_requests
            where profile = :profile and product_name is not null and trim(product_name) <> ''
        ) names
        left join codex_requests cr on cr.product_name = names.product_name and cr.profile = :profile
        group by names.product_name
        order by case when max(cr.created_at) is null then 1 else 0 end,
                 max(cr.created_at) desc, names.product_name asc
        """, countQuery = """
        select count(*) from (
            select name as product_name from products where trim(name) <> ''
            union
            select product_name from codex_requests
            where profile = :profile and product_name is not null and trim(product_name) <> ''
        ) names
        """, nativeQuery = true)
    Page<ProductSummary> findProducts(@Param("profile") String profile, Pageable pageable);

    // Read immutable process snapshots and usage fields, never prompts, logs,
    // transcripts or full responses. Each card loads at most one page.
    @Query("""
        select new com.aihub.hub.dto.CodexProductRequest(
            cr.id, cr.status, cr.createdAt, cr.startedAt, cr.finishedAt,
            cr.durationMs, process.processNumber, process.processText, cr.cost, cr.totalTokens
        )
        from CodexRequest cr
        left join cr.processSnapshot process
        where cr.profile = :profile and cr.productName = :productName
        order by cr.createdAt desc, cr.id desc
        """)
    List<CodexProductRequest> findRequests(@Param("profile") CodexIntegrationProfile profile,
                                         @Param("productName") String productName, Pageable pageable);

    @Query("select count(cr) from CodexRequest cr where cr.profile = :profile and cr.productName = :productName")
    long countRequests(@Param("profile") CodexIntegrationProfile profile, @Param("productName") String productName);
}
