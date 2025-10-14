package com.aihub.hub.repository;

import com.aihub.hub.domain.ResponseRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ResponseRepository extends JpaRepository<ResponseRecord, Long> {
    List<ResponseRecord> findTop10ByRepoOrderByCreatedAtDesc(String repo);
}
