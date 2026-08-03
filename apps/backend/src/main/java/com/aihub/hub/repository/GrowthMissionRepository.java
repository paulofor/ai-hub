package com.aihub.hub.repository;

import com.aihub.hub.domain.GrowthMissionRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface GrowthMissionRepository extends JpaRepository<GrowthMissionRecord, Long> {
    Optional<GrowthMissionRecord> findFirstByStatusOrderByUpdatedAtDesc(String status);
}
