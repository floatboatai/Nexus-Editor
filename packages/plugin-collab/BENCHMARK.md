# Collaboration benchmark baseline

Measured 2026-09-03 with `pnpm --filter @floatboat/nexus-plugin-collab bench`.

Environment: Linux 6.18.42 x86-64, Intel Core i9-13900H, Node 26.4.0, pnpm 9.15.4, Vitest 2.1.9, jsdom. These are development-machine observations, not product SLOs or production qualification.

| Scenario | Operations in one sample | Mean | p99 |
| --- | --- | ---: | ---: |
| Idle Engine create/close | construct one empty Engine and assessment hub, then close both | 0.0006 ms | 0.0017 ms |
| Local proposal + two-Editor convergence | insert one character and delete it, synchronously converging the peer | 0.3660 ms | 0.8741 ms |
| Core authoritative projection | insert one character and delete it through the authoritative source | 0.2257 ms | 0.5303 ms |
| 64 KiB collaborative Markdown replacement | replace the full document with ~64 KiB, converge, then restore it | 1,797.27 ms | 2,021.49 ms |

The 64 KiB full-replacement path is intentionally retained as visible evidence of a current performance limit. It is not an acceptable basis for a production large-document claim. Normal typing uses narrow changes; production qualification still needs browser/Electron traces, representative long documents, multi-peer churn, memory/GC observation, and a decision about chunked or diff-based Host imports.

The benchmark verifies equality after every convergence sample. It uses the assessment Provider and volatile mode, so it does not measure network latency, durable Store latency, encryption, server fan-out, or file projection.
