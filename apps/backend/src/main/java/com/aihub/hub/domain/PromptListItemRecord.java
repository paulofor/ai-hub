package com.aihub.hub.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "prompt_list_items")
public class PromptListItemRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "prompt_list_id", nullable = false)
    private PromptListRecord promptList;

    @Column(nullable = false)
    private Integer position;

    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String prompt;

    public PromptListItemRecord() {
    }

    public PromptListItemRecord(PromptListRecord promptList, String prompt, Integer position) {
        this.promptList = promptList;
        this.prompt = prompt;
        this.position = position;
    }

    public Long getId() {
        return id;
    }

    public Integer getPosition() {
        return position;
    }

    public String getPrompt() {
        return prompt;
    }
}
