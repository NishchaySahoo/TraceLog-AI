---
service: postgres
tags: [database, pool, locks, timeouts]
---

# PostgreSQL Operations

## Connection Pooling Issues

### Resolution Steps
When application logs indicate \`ConnectionPoolTimeoutError\` or \`remaining connection slots are reserved for non-replication superuser connections\`:
1. Check active connections in PostgreSQL:
\`\`\`sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
\`\`\`
2. Terminate idle-in-transaction connections older than 5 minutes:
\`\`\`sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE state = 'idle in transaction' AND state_change < current_timestamp - INTERVAL '5 minutes';
\`\`\`
3. If using PgBouncer, verify client pool limits in \`pgbouncer.ini\` and increase \`default_pool_size\` or restart the pooler.
4. Scale up the connection pool limit in application configuration or restart leaked connection pods.

## Transaction Deadlocks

### Resolution Procedure
When logs show \`deadlock detected\` (error code \`40P01\`):
1. Query PostgreSQL logs for \`DETAIL: Process X waits for ExclusiveLock\`.
2. Inspect concurrent transactions updating rows across tables in differing order:
\`\`\`sql
SELECT blocked_locks.pid AS blocked_pid, blocking_locks.pid AS blocking_pid, blocked_activity.query AS blocked_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid;
\`\`\`
3. Kill the blocking transaction holding the exclusive lock:
\`\`\`sql
SELECT pg_cancel_backend(blocking_pid);
\`\`\`
4. Refactor application queries to acquire locks in a standardized lexical order.
