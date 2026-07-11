package com.aihub.hub.service;

import com.aihub.hub.domain.CodexIntegrationProfile;
import com.aihub.hub.domain.CodexSavedConversation;
import com.aihub.hub.dto.CodexSavedConversationView;
import com.aihub.hub.dto.SaveCodexConversationRequest;
import com.aihub.hub.repository.CodexSavedConversationRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

@Service
public class CodexSavedConversationService {

    private static final int MAX_MESSAGES = 80;
    private static final int MAX_CONTENT_CHARS = 80_000;
    private static final int MAX_TITLE_CHARS = 255;
    private static final TypeReference<List<SaveCodexConversationRequest.Message>> MESSAGE_LIST_TYPE = new TypeReference<>() {
    };

    private final CodexSavedConversationRepository repository;
    private final ObjectMapper objectMapper;

    public CodexSavedConversationService(CodexSavedConversationRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper is required");
    }

    @Transactional(readOnly = true)
    public List<CodexSavedConversationView> list(CodexIntegrationProfile profile) {
        CodexIntegrationProfile resolvedProfile = resolveProfile(profile);
        return repository.findByProfileOrderByUpdatedAtDescCreatedAtDesc(resolvedProfile).stream()
            .map(record -> toView(record, false))
            .toList();
    }

    @Transactional(readOnly = true)
    public CodexSavedConversationView find(Long id) {
        return toView(findRecord(id), true);
    }

    @Transactional
    public CodexSavedConversationView create(SaveCodexConversationRequest request) {
        CodexSavedConversation record = new CodexSavedConversation();
        applyPayload(record, request);
        return toView(repository.save(record), true);
    }

    @Transactional
    public CodexSavedConversationView update(Long id, SaveCodexConversationRequest request) {
        CodexSavedConversation record = findRecord(id);
        applyPayload(record, request);
        return toView(repository.save(record), true);
    }

    private CodexSavedConversation findRecord(Long id) {
        return repository.findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversa salva não encontrada"));
    }

    private void applyPayload(CodexSavedConversation record, SaveCodexConversationRequest request) {
        List<SaveCodexConversationRequest.Message> messages = normalizeMessages(request.getMessages());
        if (messages.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe ao menos uma mensagem para salvar a conversa");
        }
        record.setTitle(resolveTitle(request.getTitle(), messages));
        record.setEnvironment(normalizeNullable(request.getEnvironment()));
        record.setModel(normalizeNullable(request.getModel()));
        record.setProfile(resolveProfile(request.getProfile()));
        record.setMessagesJson(serializeMessages(messages));
        record.setMessageCount(messages.size());
    }

    private List<SaveCodexConversationRequest.Message> normalizeMessages(List<SaveCodexConversationRequest.Message> messages) {
        if (messages == null) {
            return List.of();
        }
        return messages.stream()
            .filter(Objects::nonNull)
            .map(this::normalizeMessage)
            .filter(Objects::nonNull)
            .limit(MAX_MESSAGES)
            .toList();
    }

    private SaveCodexConversationRequest.Message normalizeMessage(SaveCodexConversationRequest.Message message) {
        String content = normalizeNullable(message.content());
        if (!StringUtils.hasText(content)) {
            return null;
        }
        String role = normalizeRole(message.role());
        String trimmedContent = content.length() > MAX_CONTENT_CHARS ? content.substring(0, MAX_CONTENT_CHARS) : content;
        String createdAt = normalizeInstantText(message.createdAt());
        return new SaveCodexConversationRequest.Message(role, trimmedContent, createdAt);
    }

    private String normalizeRole(String role) {
        if (!StringUtils.hasText(role)) {
            return "user";
        }
        String normalized = role.trim().toLowerCase(Locale.ROOT);
        if ("assistant".equals(normalized) || "model".equals(normalized) || "modelo".equals(normalized)) {
            return "assistant";
        }
        return "user";
    }

    private String normalizeInstantText(String value) {
        if (!StringUtils.hasText(value)) {
            return Instant.now().toString();
        }
        String trimmed = value.trim();
        try {
            return Instant.parse(trimmed).toString();
        } catch (RuntimeException ignored) {
            return Instant.now().toString();
        }
    }

    private String serializeMessages(List<SaveCodexConversationRequest.Message> messages) {
        try {
            return objectMapper.writeValueAsString(messages);
        } catch (JsonProcessingException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Não foi possível salvar o diálogo da conversa", ex);
        }
    }

    private List<SaveCodexConversationRequest.Message> deserializeMessages(String messagesJson) {
        if (!StringUtils.hasText(messagesJson)) {
            return List.of();
        }
        try {
            return objectMapper.readValue(messagesJson, MESSAGE_LIST_TYPE);
        } catch (JsonProcessingException ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível ler o diálogo salvo", ex);
        }
    }

    private String resolveTitle(String title, List<SaveCodexConversationRequest.Message> messages) {
        String normalizedTitle = normalizeNullable(title);
        if (StringUtils.hasText(normalizedTitle)) {
            return normalizedTitle.length() > MAX_TITLE_CHARS ? normalizedTitle.substring(0, MAX_TITLE_CHARS) : normalizedTitle;
        }
        String firstUserMessage = messages.stream()
            .filter(message -> "user".equals(message.role()))
            .map(SaveCodexConversationRequest.Message::content)
            .filter(StringUtils::hasText)
            .findFirst()
            .orElse("Conversa Codex");
        String compact = firstUserMessage.replaceAll("\\s+", " ").trim();
        if (compact.length() > 72) {
            compact = compact.substring(0, 72).trim();
        }
        return compact.isBlank() ? "Conversa Codex" : compact;
    }

    private String normalizeNullable(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private CodexIntegrationProfile resolveProfile(CodexIntegrationProfile profile) {
        return profile != null ? profile : CodexIntegrationProfile.CHATGPT_CODEX;
    }

    private CodexSavedConversationView toView(CodexSavedConversation record, boolean includeMessages) {
        return new CodexSavedConversationView(
            record.getId(),
            record.getTitle(),
            record.getEnvironment(),
            record.getModel(),
            record.getProfile(),
            record.getMessageCount(),
            includeMessages ? deserializeMessages(record.getMessagesJson()) : List.of(),
            record.getCreatedAt(),
            record.getUpdatedAt()
        );
    }
}
