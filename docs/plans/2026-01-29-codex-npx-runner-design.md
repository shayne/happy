# Codex Npx Runner Design

**Goal:** Allow `happy @openai/codex@<version>` (and `happy codex @openai/codex@<version>`) to run Codex via `npx -y` without requiring a global install, while keeping the default PATH-based `codex` behavior.

**Context / Problem:** Today Happy only runs Codex from PATH. Users want an explicit “run latest Codex via npx” option without changing the default behavior. We will also drop legacy `mcp` support and always use `mcp-server` (current `@openai/codex@latest` reports `codex-cli 0.92.0` with `mcp-server`).

**Approach:** Introduce a small Codex “runner” abstraction:
- If the first arg (or the arg after `codex`) matches `^@openai/codex@.+$`, treat it as a package spec and run via `npx -y <spec>`.
- Otherwise, keep existing behavior and run `codex` from PATH.
- Always launch MCP via `mcp-server` (no legacy fallback).

**CLI Routing:**
- `happy @openai/codex@latest` → Codex via npx.
- `happy codex @openai/codex@latest` → same as above.
- `happy` / `happy codex` → PATH-based `codex` (unchanged).
- Claude behavior stays unchanged (no npx).

**Error Handling / UX:**
- PATH runner keeps the existing “Codex CLI not found” message.
- npx runner errors should mention npm availability and invalid package spec.
- Log the exact runner command for debugging.

**Testing:** Add unit tests for parsing the package spec and for runner/MCP command construction. No integration tests needed.
