package com.aihub.hub.dto;

import jakarta.validation.constraints.NotBlank;

public class CreateFixPrRequest {

    @NotBlank
    private String base;

    @NotBlank
    private String title;

    @NotBlank
    private String diff;

    public String getBase() {
        return base;
    }

    public void setBase(String base) {
        this.base = base;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDiff() {
        return diff;
    }

    public void setDiff(String diff) {
        this.diff = diff;
    }
}
