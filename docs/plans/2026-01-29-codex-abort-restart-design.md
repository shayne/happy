# Codex Abort Restart Guard Design

**Goal:** Ensure Happy’s CLI continues to accept prompts after a user aborts a Codex task, even if the upstream Codex MCP server does not correctly complete aborted tool calls.

**Context / Problem:** Users can press “abort” while Codex is running. When the upstream MCP server ignores `turn_aborted` for a tools/call request, the original request stays open and can consume the next `turn_complete`. This leaves the next prompt hanging and causes a “one prompt works, the next doesn’t” pattern. We want Happy to remain usable regardless of upstream fixes.

**Approach:** After any abort, we will force a session restart on the next user prompt. The abort handler already stores the current session ID for resume. We’ll set a `forceRestartOnNextMessage` flag. In the main message loop, before handling a new prompt, if this flag is set and a session exists, we will:
- Clear the active session (`client.clearSession()`),
- Reset local processors (permission handler, reasoning processor, diff processor),
- Reset “thinking” state and keep-alive,
- Re-queue the prompt for processing.

On the next iteration, the prompt will start a fresh Codex session. We will reuse the existing best‑effort resume flow: if a resume file exists for the stored session ID, include `experimental_resume` in the new `startSession` request; otherwise continue without resume.

**Error Handling / UX:** If a resume file is missing, we’ll log that and continue. We’ll add a short status message in the UI indicating the session restart.

**Testing:** Add a small unit test to verify the restart helper clears session state, resets flags, and re-queues the prompt when `forceRestartOnNextMessage` is set.

**Upstream Fix (separate repo):** Codex MCP should reply to tools/call on `turn_aborted`, preventing the stuck state. We will implement that after the Happy change.
