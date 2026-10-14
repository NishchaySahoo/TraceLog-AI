---
service: k8s
tags: [containers, pods, oom, crashloop]
---

# Kubernetes Workload Failures

## Pod OOMKilled (Exit Code 137)

### Investigation & Fix
When Kubernetes terminates a pod with \`OOMKilled\` (exit code 137):
1. Identify the container that hit its memory limit:
\`\`\`bash
kubectl describe pod <pod-name> -n production | grep -A 5 "Last State"
\`\`\`
2. Check recent memory metrics leading up to the crash:
\`\`\`bash
kubectl top pod <pod-name> --containers
\`\`\`
3. Increase container memory limits and requests in deployment YAML manifest:
\`\`\`yaml
resources:
  limits:
    memory: "2Gi"
  requests:
    memory: "1Gi"
\`\`\`
4. Check application memory profiles for heap memory leaks or unbounded in-memory queues.

## CrashLoopBackOff Errors

### Debugging Workflow
When pods cycle repeatedly in \`CrashLoopBackOff\`:
1. Check termination logs from the previous failed container instance:
\`\`\`bash
kubectl logs <pod-name> -c worker --previous
\`\`\`
2. Check for missing required environment variables, secrets, or config maps.
3. Validate liveness and readiness probe configurations (initialDelaySeconds, timeoutSeconds).
4. Inspect host node disk pressure or kernel faults using \`kubectl describe node\`.
