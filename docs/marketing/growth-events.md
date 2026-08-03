# Eventos automáticos do Operador de Crescimento

O placar comercial não deve ser preenchido por pessoas ou pelo modelo. O Marketing Hub, o checkout e a plataforma de mídia enviam eventos reais para `POST /api/growth/events`, autenticados pelo header `X-Growth-Events-Token`. O segredo é configurado no backend como `HUB_GROWTH_EVENTS_TOKEN` e nunca deve ser incluído no frontend ou no repositório.

## Contrato

```json
{
  "type": "SALE_APPROVED",
  "source": "checkout-provider",
  "eventId": "sale_123",
  "product": "Agenda Cheia",
  "amount": 97.00,
  "occurredAt": "2026-08-03T20:00:00Z"
}
```

`source + eventId` é uma chave idempotente: reenviar o mesmo evento não altera o placar duas vezes. O produto deve corresponder à missão ativa. `amount` é zero para contagens, o valor recebido para `SALE_APPROVED`/`REFUND` e o gasto incremental para `AD_SPEND`.

Tipos aceitos: `VISITOR`, `CTA_CLICK`, `CHECKOUT_STARTED`, `SALE_APPROVED`, `BRIEFING_COMPLETED`, `DELIVERY_COMPLETED`, `REFUND` e `AD_SPEND`.

Visitas, cliques e início de checkout devem ser emitidos pelo backend do Marketing Hub (ou por um coletor first-party), nunca diretamente do navegador com o segredo. Pagamentos e reembolsos devem nascer do webhook validado do provedor. Briefing e entrega devem nascer das transições persistidas desses processos. Gasto deve vir da API da plataforma de mídia em incrementos identificáveis pelo período consultado.
