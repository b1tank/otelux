# @otelux/agent-integrations

Shared typed detection, inspection, planning, mutation, and verification contracts for supported coding-agent integrations.

The package is Node-only and is consumed through CLI and Desktop main/runtime boundaries. Renderer code never receives raw shell commands or secret values. The current foundation provides bounded inspection contracts, shell-free bounded command execution, and owner/symlink/scope/world-writable path inspection with optional content hashes; host adapters and mutation support land as separately tested vertical slices.
