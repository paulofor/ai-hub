package com.aihub.hub.repository;

import com.aihub.hub.domain.GrowthEventRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface GrowthEventRepository extends JpaRepository<GrowthEventRecord, Long> {
    Optional<GrowthEventRecord> findBySourceAndExternalId(String source, String externalId);
    List<GrowthEventRecord> findByMissionIdOrderByOccurredAtAsc(Long missionId);
}
