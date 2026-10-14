---
service: redis
tags: [cache, oom, eviction, memory]
---

# Redis Troubleshooting

## High Memory and OOM Errors

### Mitigation Steps
When Redis returns \`OOM command not allowed when used memory > 'maxmemory'\`:
1. Check current memory utilization and eviction stats:
\`\`\`bash
redis-cli info memory
redis-cli info stats | grep evicted_keys
\`\`\`
2. Check configured maxmemory policy:
\`\`\`bash
redis-cli config get maxmemory-policy
\`\`\`
3. If policy is \`noeviction\`, switch to an active volatile or allkeys LRU/LFU policy immediately:
\`\`\`bash
redis-cli config set maxmemory-policy allkeys-lru
\`\`\`
4. Run \`redis-cli --bigkeys\` to detect large cache keys causing memory bloat and apply TTLs.

## Connection Failures (ECONNREFUSED)

### Recovery Actions
When client applications throw \`Error 111 connecting to localhost:6379. ECONNREFUSED\` or \`RedisConnectionException\`:
1. Check if the Redis daemon is running:
\`\`\`bash
systemctl status redis || docker ps | grep redis
\`\`\`
2. Check if Redis crashed due to Linux OOM killer:
\`\`\`bash
dmesg -T | grep -i oom | grep redis-server
\`\`\`
3. Restart Redis service and verify listening socket on port 6379:
\`\`\`bash
systemctl restart redis && netstat -tlpn | grep 6379
\`\`\`
4. Ensure firewall rules and security groups permit traffic from the application subnet.
