# OTelux CLI

Thin Node client for the shared local runtime. Current source-build commands:

```text
oteluxctl start [--json]
oteluxctl stop [--json]
oteluxctl restart [--json]
oteluxctl status [--json]
oteluxctl endpoints [--json]
oteluxctl doctor [--json]
```

The CLI discovers the same owner-only runtime state/token as Desktop and calls authenticated Runtime RPC. It never opens SQLite or implements another receiver. `start` launches the workspace daemon with the current Node executable; bundling a version-matched CLI/daemon into release artifacts remains pending.

Exit codes: `0` success/healthy, `1` invalid or internal failure, `2` runtime not running, `3` incompatible runtime, `4` runtime reachable with listener issues.
