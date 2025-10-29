package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexRequestRecord;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CodexRequestRepository extends JpaRepository<CodexRequestRecord, Long> {
}
