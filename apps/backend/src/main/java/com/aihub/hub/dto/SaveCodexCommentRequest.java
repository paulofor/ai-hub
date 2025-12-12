package com.aihub.hub.dto;

import jakarta.validation.constraints.Size;

public class SaveCodexCommentRequest {

    @Size(max = 4000, message = "Comentário deve ter no máximo 4000 caracteres")
    private String comment;

    public String getComment() {
        return comment;
    }

    public void setComment(String comment) {
        this.comment = comment;
    }
}
