package com.aihub.hub.repository;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexSavedConversation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CodexSavedConversationRepository extends JpaRepository<CodexSavedConversation, Long> {
    List<CodexSavedConversation> findByProfileOrderByUpdatedAtDescCreatedAtDesc(CodexIntegrationProfile profile);
}
