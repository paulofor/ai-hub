package com.aihub.hub.repository;

import com.aihub.hub.domain.PromptListRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface PromptListRepository extends JpaRepository<PromptListRecord, Long> {
    @Query("select distinct pl from PromptListRecord pl left join fetch pl.items order by pl.createdAt desc")
    List<PromptListRecord> findAllWithItemsOrderByCreatedAtDesc();

    @Query("select distinct pl from PromptListRecord pl left join fetch pl.items where lower(pl.name) = lower(:name)")
    Optional<PromptListRecord> findByNameWithItems(String name);
}
