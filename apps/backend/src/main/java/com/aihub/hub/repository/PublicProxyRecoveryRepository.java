package com.aihub.hub.repository;

import com.aihub.hub.domain.PublicProxyRecovery;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PublicProxyRecoveryRepository extends JpaRepository<PublicProxyRecovery, Long> {
    Optional<PublicProxyRecovery> findByRequestId(String requestId);

    Optional<PublicProxyRecovery> findTopByOrderByRequestedAtDesc();
}
