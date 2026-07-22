package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexDocumentAccessLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface CodexDocumentAccessRepository extends JpaRepository<CodexDocumentAccessLog, Long> {
    boolean existsBySandboxJobIdAndSandboxAccessId(String sandboxJobId, String sandboxAccessId);

    @Query("""
        select log.documentPath as documentPath, count(log.id) as accessCount
        from CodexDocumentAccessLog log
        where log.codexRequest.id = :codexRequestId
        group by log.documentPath
        order by count(log.id) desc, log.documentPath asc
        """)
    List<DocumentAccessCount> countDocumentAccessesByRequestId(Long codexRequestId);

    interface DocumentAccessCount {
        String getDocumentPath();
        long getAccessCount();
    }
}
