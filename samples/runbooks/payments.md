---
service: payments
tags: [stripe, gateway, checkout, idempotency]
---

# Payment Processing & Gateway Troubleshooting

## 504 Gateway Timeouts

### Remediation Checklist
When checkout transactions fail with \`GatewayTimeoutError: 504 Gateway Timeout\` or \`AxiosError: timeout of 10000ms exceeded\`:
1. Check Stripe/Adyen external status page for upstream service degradation.
2. Verify outbound egress connectivity and DNS resolution from payment-service pods:
\`\`\`bash
curl -I -m 5 https://api.stripe.com/v1/charges
\`\`\`
3. Verify connection pool keep-alive settings on HTTP client to avoid cold TLS handshakes.
4. Temporarily increase upstream request timeout threshold from 10s to 20s if payment provider is reporting high latency.

## Idempotency Key Conflicts

### Resolution
When payment mutation requests return \`IdempotencyConflictError: Keys for idempotent requests cannot be reused\`:
1. Verify if client checkout UI double-submitted due to missing button debounce.
2. Check Redis lock TTL on idempotency key storage:
\`\`\`bash
redis-cli ttl "idemp:checkout:ord_12345"
\`\`\`
3. Ensure client sends unique \`Idempotency-Key\` UUID headers per discrete user checkout intention.
4. If a prior request crashed midway, query payment provider transaction state before retrying payment capture.
