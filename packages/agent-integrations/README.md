# @otelux/agent-integrations

Shared typed detection, inspection, planning, mutation, and verification contracts for supported coding-agent integrations.

The package is Node-only and is consumed through CLI and Desktop main/runtime boundaries. Renderer code never receives raw shell commands or secret values. The current foundation provides bounded inspection contracts, shell-free bounded command execution, and owner/symlink/scope/world-writable path inspection with optional content hashes.

The first read-only adapter is qualified against the installed official Claude Code `2.1.220` CLI. It uses `claude --version`, `claude mcp get otelux`, and `claude plugin list --json`; command output is reduced to bounded capability state and is never returned as configuration content. Unknown major versions fail closed. Mutation support lands separately.
