# OTelux CLI

Thin Node client for the shared local runtime. Current source-build commands:

```text
oteluxctl start [--json]
oteluxctl stop [--json]
oteluxctl restart [--json]
oteluxctl status [--json]
oteluxctl endpoints [--json]
oteluxctl doctor [--json]
oteluxctl config get [key] [--json]
oteluxctl config set <key> <value> --dry-run [--json]
oteluxctl config set <key> <value> --yes [--json]
```

The CLI discovers the same owner-only runtime state/token as Desktop and calls authenticated Runtime RPC. It never opens SQLite or implements another receiver. `start` launches the workspace daemon with the current Node executable. Desktop artifacts bundle a private `resources/bin/oteluxctl`; source lifecycle and artifact read-only smokes pass, while packaged CLI-owned lifecycle and public PATH installation remain pending.

`config` accepts only `otlp.port`, `mcp.enabled`, `mcp.port`, `retention.maxAgeHours`, `retention.maxSizeMb`, and `storage.dbPath`. Dry-run validates and prints the complete candidate without writing; apply requires `--yes` and uses the fetched revision as a compare-and-swap guard.

`doctor` currently reports listener errors only. Permission, version, storage, database-health, and agent checks remain part of the target contract, not current behavior.

Exit codes: `0` success/healthy, `1` invalid or internal failure, `2` runtime not running, `3` incompatible runtime, `4` runtime reachable with listener/settings issues, `5` settings revision conflict.
