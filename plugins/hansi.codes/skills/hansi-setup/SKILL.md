---
name: hansi-setup
description: >
  Creates or updates .hansi.json for Hansi code review. Sets path filters, profile, and
  instructions, then opens a pull request so the file lands on the base branch. Use when
  the user wants to configure Hansi, add review instructions, exclude paths, or run
  hansi-setup.
license: MIT
compatibility: Requires git and the GitHub CLI (gh), authenticated, and the Hansi GitHub App installed on the repository.
metadata:
  author: hansi
  version: '1.0'
allowed-tools: Bash(gh:*) Bash(git:*)
---

# hansi-setup

Write `.hansi.json` at the repository root and get it onto the pull request's base branch. Hansi reads that file, and the guideline files, from the base branch only. A copy that exists solely on a feature branch does nothing until it is merged.

Do not request a Hansi review. Do not push to the default branch. Do not enable `reviews.approveOutsideContributors` unless the user explicitly asks.

## Inputs

- **What to change** (optional). For example a profile, paths to skip, or an instruction. If omitted, inspect the repo and propose a minimal file, then wait for a yes before committing.

## Instructions

### 1. Read the config Hansi uses today

The base branch is the pull request's base when one is open, otherwise the repository default branch.

```bash
gh pr view --json baseRefName,url -q '{base: .baseRefName, url: .url}' \
  || gh repo view --json defaultBranchRef -q '{base: .defaultBranchRef.name, url: .url}'
```

Use that name as `<BASE>`.

```bash
gh api "repos/{owner}/{repo}/contents/.hansi.json?ref=<BASE>" --jq .content | base64 -d
```

A 404 means there is no file yet. Also list which guideline files exist on `<BASE>`. Hansi includes each of these in full when it is present: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`. Do not copy them into `instructions`.

### 2. Decide the edits

Every field is optional. Omit a field when it would only restate the default. Keep unknown keys that are already in the file.

| Field                                | Default    | Write it when                                                   |
| ------------------------------------ | ---------- | --------------------------------------------------------------- |
| `reviews.enabled`                    | `true`     | The user wants reviews off in this repo.                        |
| `reviews.auto`                       | `true`     | The user wants mentions only.                                   |
| `reviews.drafts`                     | `false`    | The user wants drafts reviewed.                                 |
| `reviews.baseBranches`               | `[]` (all) | The user names branches to review into.                         |
| `reviews.pathFilters`                | `[]`       | The user wants extra excludes, or an allowlist.                 |
| `reviews.profile`                    | `balanced` | The user wants `chill` or `strict`.                             |
| `reviews.minSeverity`                | `minor`    | The user sets `info`, `minor`, `major`, or `critical`.          |
| `reviews.maxComments`                | `15`       | The user sets a cap from 0 to 100.                              |
| `reviews.approve`                    | `true`     | The user does not want automatic approval.                      |
| `reviews.requestChanges`             | `major`    | The user sets `info`, `minor`, `major`, `critical`, or `never`. |
| `reviews.approveOutsideContributors` | `false`    | The user explicitly wants fork authors approved.                |
| `instructions`                       | `""`       | A repo-wide rule that is not already in a guideline file.       |
| `pathInstructions`                   | `[]`       | A rule for one glob, such as `migrations/**`.                   |
| `language`                           | `en`       | The user wants comments in another language.                    |

`profile`: `chill` flags confirmed bugs only. `balanced` also flags risky patterns, weak or missing tests, and broken documentation examples. `strict` also counts naming, style, and maintainability.

`pathFilters`: a pattern without `!` is an allowlist, and files outside it are skipped. A pattern with `!` excludes. Do not add an allowlist unless the user asked for one. Lockfiles, `dist/`, `build/`, snapshots, generated files, and images are already ignored. Do not repeat those.

Always set `$schema` to `https://hansi.codes/schema/v1.json`.

```json
{
	"$schema": "https://hansi.codes/schema/v1.json",
	"reviews": {
		"pathFilters": ["!docs/**"]
	},
	"instructions": "We use Result types instead of exceptions in src/domain.",
	"pathInstructions": [
		{ "path": "migrations/**", "instructions": "Check that every migration is reversible." }
	]
}
```

Show the diff of the file and wait for a yes when the user did not already specify the exact contents.

### 3. Put the file on the base branch

If `git status --short` shows changes you did not make for this config, stop and ask. Do not stash or discard them.

Check out a new branch from `<BASE>` unless the user asked to add the file to the branch they are already on.

```bash
git fetch origin <BASE>
git checkout -b hansi-config origin/<BASE>
```

Write `.hansi.json` at the repository root. Commit only that file.

```bash
git add .hansi.json
git commit -m "Configure Hansi reviews."
git push -u origin HEAD
gh pr create --base <BASE> --title "Configure Hansi reviews" --body "Adds .hansi.json. Hansi reads it from the base branch after merge."
```

If the user asked to include it in the current pull request, commit it there instead and say it takes effect once that pull request merges into `<BASE>`.

### 4. Report

```
hansi-setup
  Base branch:   main
  Pull request:  https://github.com/owner/repo/pull/123
  Takes effect:  after merge

Changed:
  - reviews.pathFilters: ["!docs/**"]
  - instructions: We use Result types instead of exceptions in src/domain.
```

Say which guideline files already exist on `<BASE>`, so the user knows Hansi will read those too.
