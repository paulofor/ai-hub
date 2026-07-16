package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexDocumentAccessLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CodexDocumentAccessRepository extends JpaRepository<CodexDocumentAccessLog, Long> {
    boolean existsBySandboxJobIdAndSandboxAccessId(String sandboxJobId, String sandboxAccessId);
}
