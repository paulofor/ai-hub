INSERT INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
)
SELECT 'gpt-5.6', 'GPT-5.6', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM codex_model_pricing WHERE LOWER(model_name) = 'gpt-5.6');

INSERT INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
)
SELECT 'gpt-5.6-sol', 'GPT-5.6 Sol', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM codex_model_pricing WHERE LOWER(model_name) = 'gpt-5.6-sol');

INSERT INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
)
SELECT 'gpt-5.6-terra', 'GPT-5.6 Terra', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM codex_model_pricing WHERE LOWER(model_name) = 'gpt-5.6-terra');

INSERT INTO codex_model_pricing (
    model_name, display_name, input_price_per_million, cached_input_price_per_million,
    output_price_per_million, active, created_at, updated_at
)
SELECT 'gpt-5.6-luna', 'GPT-5.6 Luna', 5.000000, 0.500000, 30.000000, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM codex_model_pricing WHERE LOWER(model_name) = 'gpt-5.6-luna');

UPDATE codex_model_pricing
SET display_name = CASE LOWER(model_name)
        WHEN 'gpt-5.6' THEN 'GPT-5.6'
        WHEN 'gpt-5.6-sol' THEN 'GPT-5.6 Sol'
        WHEN 'gpt-5.6-terra' THEN 'GPT-5.6 Terra'
        WHEN 'gpt-5.6-luna' THEN 'GPT-5.6 Luna'
    END,
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE LOWER(model_name) IN ('gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna');
