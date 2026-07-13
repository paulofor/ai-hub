INSERT INTO codex_model_pricing (
    model_name,
    display_name,
    input_price_per_million,
    cached_input_price_per_million,
    output_price_per_million,
    created_at,
    updated_at
)
SELECT
    'gpt-5.5',
    'gpt-5.5',
    5.000000,
    0.500000,
    30.000000,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM codex_model_pricing WHERE LOWER(model_name) = 'gpt-5.5'
);
