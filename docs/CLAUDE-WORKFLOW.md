# Claude Code workflow

> Note: the OpenSpec steps (`/opsx:*`) below require installing OpenSpec
> (`npm install -g @fission-ai/openspec` and `openspec init`). It is not yet
> installed in this repository; until then, use the `process-analyst` agent
> output as the approval artifact.

## Change lifecycle

### Tiny

1. State expected result.
2. Inspect relevant code.
3. Implement smallest coherent change.
4. Run targeted test and `/project-verify`.
5. Commit.

### Medium and clear

1. Start `claude -w <change-name>`.
2. Use Plan mode.
3. Write acceptance criteria in the plan or issue.
4. Implement in small coherent commits.
5. `/project-verify`.
6. `/code-review`.
7. Open PR and merge only after CI/preview.

### Ambiguous or high-risk

1. Run the `process-analyst` agent.
2. Resolve material business decisions.
3. Create `/opsx:propose <change>`.
4. Review scenarios before code.
5. Start isolated worktree implementation.
6. Keep planning artifacts updated when implementation reveals a wrong assumption.
7. `/project-verify`, then `implementation-reviewer`, then `/code-review`.
8. Archive the OpenSpec change after acceptance.

## Context hygiene

- Delegate broad search, logs, and codebase exploration to subagents.
- Compact after exploration and before implementation, not midway through an edit.
- Keep MCP servers and tool surface limited to what the current project needs.
- Put persistent facts in `CLAUDE.md` or path-scoped rules.
- Put repeatable multi-step procedures in skills.
- Put specialist autonomous analysis in agents.
- Put business decisions and acceptance scenarios in spec artifacts.
- Put enforcement in settings, tests, CI, hooks, or database constraints—not prose alone.

## Review loop

A change is complete only when:

- expected behavior is explicit
- relevant deterministic tests pass
- schema/RLS/financial invariants are checked
- diff contains no unrelated work
- a fresh reviewer finds no high-confidence defect
- PR/preview validation passes before production
