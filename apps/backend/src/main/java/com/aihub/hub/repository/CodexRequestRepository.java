package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexRequest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CodexRequestRepository extends JpaRepository<CodexRequest, Long> {
    List<CodexRequest> findAllByOrderByCreatedAtDesc();
}
