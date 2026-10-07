---
name: hansi-status
description: >
  Reads the current Hansi review on a GitHub pull request and reports the tier, open findings,
  filtered-out comments, and whether approval was withheld. Does not request a new review or
  change the pull request. Use when the user wants to know what Hansi said, the current tier,
  or which comments are still open, or when they run hansi-status.
license: MIT
compatibility: The Hansi GitHub App must be installed on the repository. Examples use the GitHub CLI.
metadata:
  author: hansi
  version: '1.1'
---

# hansi-status

Read Hansi's review of a pull request and stop. Do not comment, push, commit, or resolve a thread. A new review spends the repository owner's model credits.

The command blocks are examples, written for the GitHub CLI. Run whatever this environment actually provides to do the same job, including commands the examples do not list. If `gh` is missing, or a command fails because of how this machine authenticates, try another client before stopping.

## Inputs

- **Pull request number** (optional). If omitted, use the pull request for the current branch.

## Instructions

### 1. Identify the pull request

Set `PR_NUMBER` when the user gave one. Leave it empty to use the current branch.

```bash
if [ -n "$PR_NUMBER" ]; then
  gh pr view "$PR_NUMBER" --json number,headRefName,headRefOid,url,baseRefName -q '{number: .number, branch: .headRefName, sha: .headRefOid, url: .url, base: .baseRefName}'
else
  gh pr view --json number,headRefName,headRefOid,url,baseRefName -q '{number: .number, branch: .headRefName, sha: .headRefOid, url: .url, base: .baseRefName}'
fi
```

Use the `number` from that JSON as `<PR_NUMBER>` and the `sha` as `<HEAD_SHA>`. Stop if there is no open pull request.

### 2. Read the summary

Hansi keeps one issue comment up to date. Its body contains `<!-- hans:summary -->`.

```bash
gh api --paginate "repos/{owner}/{repo}/issues/<PR_NUMBER>/comments?per_page=100" \
  --jq '[.[] | select(.body | contains("<!-- hans:summary -->"))] | sort_by(.updated_at) | last | .body'
```

If that returns nothing, say there is no Hansi summary yet and stop. Do not mention the app and do not request a review.

Parse the body:

- **Tier**, from the heading `Tier S` through `Tier F`. **S** means ready to merge. Open findings cap it: a minor finding means at most **A**, a major one at most **B**, a critical one at most **D**. Informational notes do not lower it.
- **Verdict table**: new comments, fixed, and still open.
- **Findings table** of comments posted on this review. A row is a title plus a file and line.
- **Still open from earlier reviews**, inside the `⏳ Still open` details block.
- **Filtered out**, inside the `🔇 Filtered out` details block. These were considered and not posted. Include the reason.
- **Approval withheld**, a `> [!NOTE]` block. Hansi will not approve in that case. A note about an open bug finding clears once that finding is fixed or dismissed. A note about write access or an incomplete diff does not.

The footer looks like `Comment <code>@hansi-codes review</code>`. That `@<slug>` is Hansi's mention handle. Review comments are authored by `<slug>[bot]`.

### 3. Read the check on this head

```bash
gh api "repos/{owner}/{repo}/commits/<HEAD_SHA>/check-runs?check_name=Hansi" \
  --jq '[.check_runs[] | select(.name == "Hansi")] | sort_by(.started_at) | last | {status, conclusion, head_sha, title: .output.title, summary: .output.summary}'
```

Report the check exactly:

- `queued` or `in_progress`: a review of this head is still running. Do not wait for it.
- `completed` with `failure`: Hansi requested changes.
- `completed` with `neutral`: Hansi commented.
- `completed` with `success`: Hansi approved.
- `skipped`: drafts, disabled reviews, or a base branch Hansi does not review.
- Title `Review failed`: the review did not finish.
- No check on `<HEAD_SHA>`: the summary may be for an older commit. Say the review is stale and name the head it does not cover.

### 4. List unresolved Hansi threads

```bash
gh api graphql -f query='
query($cursor: String) {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 20) {
            nodes { databaseId body path author { login } }
          }
        }
      }
    }
  }
}'
```

Page with `endCursor` while `hasNextPage` is true. Keep unresolved threads whose first comment is from `<slug>[bot]`. A finding comment starts with a bold title, then the explanation, sometimes a `suggestion` block, and a footer like `Major · bug`.

Also read the latest Hansi review body. If GitHub rejected the inline comments, the findings are in that body instead of threads. Treat those as open too.

Do not call `resolveReviewThread`.

### 5. Report

```
hansi-status
  Pull request:  #123
  URL:           https://github.com/owner/repo/pull/123
  Head:          abc1234
  Check:         completed · failure
  Tier:          B
  Open:          2
  Filtered out:  1
  Approval withheld: no

Open findings:
  - src/auth.ts:45 — "Session cookie is not marked HttpOnly" (major, unresolved)

Filtered out:
  - "Rename this variable" — style
```

Quote titles from the summary. If the summary and the threads disagree, list both and say which source each line came from. If approval was withheld, quote the note even when the tier is **S**.
