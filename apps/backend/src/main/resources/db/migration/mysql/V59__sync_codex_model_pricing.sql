INSERT INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
) VALUES
    ('gpt-5.6', 'GPT-5.6', 4.000000, 0.400000, 20.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-5.6-sol', 'GPT-5.6 Sol', 4.000000, 0.400000, 20.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-5.6-terra', 'GPT-5.6 Terra', 2.000000, 0.200000, 12.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-5.6-luna', 'GPT-5.6 Luna', 0.200000, 0.020000, 1.200000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-6.1-sol', 'GPT-6.1 Sol', 2.000000, 0.100000, 10.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    input_price_per_million = VALUES(input_price_per_million),
    cached_input_price_per_million = VALUES(cached_input_price_per_million),
    output_price_per_million = VALUES(output_price_per_million),
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP;
