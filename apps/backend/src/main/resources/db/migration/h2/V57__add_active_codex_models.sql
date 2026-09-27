CREATE TABLE IF NOT EXISTS codex_model_pricing (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    model_name VARCHAR(191) NOT NULL,
    display_name VARCHAR(191),
    input_price_per_million DECIMAL(19,6) NOT NULL,
    cached_input_price_per_million DECIMAL(19,6) NOT NULL,
    output_price_per_million DECIMAL(19,6) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL,
    CONSTRAINT uk_codex_model_pricing_model_name UNIQUE (model_name)
);

ALTER TABLE codex_model_pricing ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT FALSE;

MERGE INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
) KEY (model_name) VALUES
    ('gpt-6-astra', 'GPT-6 Astra', 10.000000, 1.000000, 50.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-6-sol', 'GPT-6 Sol', 2.000000, 0.200000, 10.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-6-luna', 'GPT-6 Luna', 0.100000, 0.010000, 0.500000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE codex_model_pricing
SET active = FALSE
WHERE LOWER(model_name) NOT IN ('gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna');
