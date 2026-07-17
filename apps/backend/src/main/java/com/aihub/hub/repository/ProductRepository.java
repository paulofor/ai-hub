package com.aihub.hub.repository;

import com.aihub.hub.domain.ProductRecord;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ProductRepository extends JpaRepository<ProductRecord, Long> {

    List<ProductRecord> findAllByOrderByNameAsc();

    boolean existsBySlugIgnoreCase(String slug);

    boolean existsBySlugIgnoreCaseAndIdNot(String slug, Long id);

    boolean existsByExternalIdIgnoreCase(String externalId);

    boolean existsByExternalIdIgnoreCaseAndIdNot(String externalId, Long id);
}
