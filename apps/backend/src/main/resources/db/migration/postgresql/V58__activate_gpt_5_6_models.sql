INSERT INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
) VALUES
    ('gpt-5.6', 'GPT-5.6', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-5.6-sol', 'GPT-5.6 Sol', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-5.6-terra', 'GPT-5.6 Terra', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('gpt-5.6-luna', 'GPT-5.6 Luna', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (model_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP;
