package com.aihub.hub.repository;

import com.aihub.hub.domain.ProcessRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ProcessRepository extends JpaRepository<ProcessRecord, Long> {
    List<ProcessRecord> findAllByOrderByNumberAsc();
    boolean existsByNumberIgnoreCase(String number);
    boolean existsByNumberIgnoreCaseAndIdNot(String number, Long id);
}
