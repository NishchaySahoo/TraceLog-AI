---
service: auth
tags: [jwt, tokens, unauthorized, oauth]
---

# Authentication & Token Management

## Token Expiration and Clock Skew

### Resolution
When services throw \`TokenExpiredError: jwt expired\` or \`JsonWebTokenError\`:
1. Verify system clock synchronization across nodes with chrony/NTP:
\`\`\`bash
chronyc tracking
\`\`\`
2. Check if client refresh token rotation failed or refresh endpoint returned HTTP 401.
3. If clock skew exceeds 60 seconds, re-sync system clock:
\`\`\`bash
chronyc makestep
\`\`\`
4. Allow a 30-second clock tolerance window in JWT verification library configuration:
\`\`\`typescript
jwt.verify(token, secret, { clockTolerance: 30 });
\`\`\`

## Invalid Signature & Secret Rotation

### Remediation
When logs show \`JsonWebTokenError: invalid signature\` across incoming API traffic:
1. Check if an automated JWT secret rotation occurred without propagating the new signing key to downstream verifier pods.
2. Inspect JWKS URI endpoint availability and HTTP cache headers:
\`\`\`bash
curl -v https://auth.company.internal/.well-known/jwks.json
\`\`\`
3. Flush in-memory JWKS public key caches in API gateway and downstream services.
4. If secret rotation is in progress, configure dual-key support (both current and previous key) until token caches expire.
