---
name: using-superpowers
description: A complete software development workflow for supercharging agentic coding. Use for EVERY coding task, planning session, or when starting a new project.
---

# Superpowers Workflow

## When to use this skill
- **Always-on**: This is the master orchestrator for all development work.
- Before writing any code (Planning & Design).
- During implementation (TDD & Logic).
- After completion (Verification & Review).

## Workflow (The "Superpowers" Way)

### 1. Brainstorming & Design
- [ ] **Socratic Refinement**: Don't jump into code. Ask questions to tease out a full spec.
- [ ] **Chunked Validation**: Present the design in digestible parts for feedback.
- [ ] **Plan First**: Output a detailed implementation plan before touching source files.

### 2. Implementation Loop (RED-GREEN-REFACTOR)
- [ ] **Red**: Write a failing test for the next bite-sized task.
- [ ] **Green**: Write the minimal code needed to pass the test.
- [ ] **Refactor**: Clean up the code while keeping it functional.
- [ ] **Commit early**: Small, meaningful commits for every task.

### 3. Verification & Review
- [ ] **Evidence over Claims**: Prove it works with logs, screenshots, or test results.
- [ ] **Systematic Debugging**: Use root-cause analysis if something fails.
- [ ] **Final Walkthrough**: Summarize what was accomplished and how it's verified.

## Core Philosophies
- **TDD (Test-Driven Development)**: Tests are not an afterthought; they are the blueprint.
- **YAGNI (You Aren't Gonna Need It)**: Do not over-engineer. Focus on the spec.
- **DRY (Don't Repeat Yourself)**: Keep the codebase clean and maintainable.
- **Composable Skills**: Always check `.agent/skills/` for relevant tools (e.g., `handling-errors`, `deployment-guard`).

## Instructions for the Agent
1.  **Check Skills FIRST**: Before executing ANY plan, scan `.agent/skills/` for tools that can automate or safeguard your work.
2.  **Explicit Verification**: Never report a task as "done" without running a verification command (e.g., `npm test`, `grep`, or a custom script).
3.  **Proactive planning**: If a task is complex, update `task.md` and `implementation_plan.md` IMMEDIATELY.

## Resources
- [See BRAINSTORMING.md](BRAINSTORMING.md)
- [See TDD-GUIDE.md](TDD-GUIDE.md)
