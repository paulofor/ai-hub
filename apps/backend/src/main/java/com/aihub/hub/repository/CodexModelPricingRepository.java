package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexModelPricing;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CodexModelPricingRepository extends JpaRepository<CodexModelPricing, Long> {

    Optional<CodexModelPricing> findByModelNameIgnoreCase(String modelName);

    List<CodexModelPricing> findByActiveTrueOrderByModelNameAsc();
}
