ALTER TABLE codex_model_pricing ADD COLUMN active BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
) VALUES
    ('gpt-6-astra', 'GPT-6 Astra', 10.000000, 1.000000, 50.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-6-sol', 'GPT-6 Sol', 2.000000, 0.200000, 10.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-6-luna', 'GPT-6 Luna', 0.100000, 0.010000, 0.500000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    input_price_per_million = VALUES(input_price_per_million),
    cached_input_price_per_million = VALUES(cached_input_price_per_million),
    output_price_per_million = VALUES(output_price_per_million),
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

UPDATE codex_model_pricing
SET active = FALSE
WHERE LOWER(model_name) NOT IN ('gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna');
