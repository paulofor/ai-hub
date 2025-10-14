package com.aihub.hub.repository;

import com.aihub.hub.domain.PromptRecord;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PromptRepository extends JpaRepository<PromptRecord, Long> {
}
