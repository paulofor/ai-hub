package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexRequest;
import com.aihub.hub.domain.CodexRequestStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CodexRequestRepository extends JpaRepository<CodexRequest, Long> {
    List<CodexRequest> findAllByOrderByCreatedAtDesc();
    Page<CodexRequest> findAllByOrderByCreatedAtDesc(Pageable pageable);
    Page<CodexRequest> findAllByRatingOrderByCreatedAtDesc(Integer rating, Pageable pageable);
    List<CodexRequest> findAllByRatingOrderByCreatedAtDesc(Integer rating);
    List<CodexRequest> findByProblemIdOrderByCreatedAtDesc(Long problemId);
    List<CodexRequest> findByWorkBatchKeyOrderByCreatedAtAsc(String workBatchKey);
    Optional<CodexRequest> findByExternalId(String externalId);
    boolean existsByProfileAndStatusInAndExternalIdIsNotNull(CodexIntegrationProfile profile, Collection<CodexRequestStatus> statuses);
    Optional<CodexRequest> findFirstByProfileAndStatusAndExternalIdIsNullOrderByCreatedAtAsc(CodexIntegrationProfile profile, CodexRequestStatus status);
}
