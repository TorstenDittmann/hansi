---
name: hansi-loop
description: >
  Iteratively improves a GitHub pull request until Hansi grades it Tier S (ready to merge)
  with zero unresolved comments. Triggers a Hansi review, fixes actionable findings, pushes,
  and repeats. Use when the user wants to clear Hansi's review, reach Tier S, loop on Hansi
  comments, or run hansi-loop.
license: MIT
compatibility: Requires git and the GitHub CLI (gh), authenticated, and the Hansi GitHub App installed on the repository.
metadata:
  author: hansi
  version: '1.0'
allowed-tools: Bash(gh:*) Bash(git:*)
---

# hansi-loop

Iteratively fix a pull request until Hansi grades it **Tier S** (ready to merge) and leaves no unresolved comments.

Each review spends the repository owner's model credits. Do not request a new review when the current head already has a finished Hansi review and you have not pushed anything since.

## Inputs

- **Pull request number** (optional). If omitted, use the pull request for the current branch.

## Instructions

### 1. Identify the pull request

```bash
gh pr view --json number,headRefName,headRefOid,url -q '{number: .number, branch: .headRefName, sha: .headRefOid, url: .url}'
```

Check out that branch if you are not already on it. Stop if there is no open pull request.

### 2. Learn Hansi's mention handle

The GitHub App slug is different for every installation. The mention is `@<slug>`, for example `@hansi-codes`.

Prefer the handle printed in Hansi's summary comment (the issue comment whose body contains `<!-- hans:summary -->`):

```bash
gh api --paginate "repos/{owner}/{repo}/issues/<PR_NUMBER>/comments?per_page=100" \
  --jq '[.[] | select(.body | contains("<!-- hans:summary -->"))] | sort_by(.updated_at) | last | .body'
```

The footer looks like `Comment <code>@hansi-codes review</code>`. Take the handle inside that `<code>` tag.

If there is no summary yet, read the slug from a `Hansi` check run on the pull request:

```bash
gh api "repos/{owner}/{repo}/commits/<HEAD_SHA>/check-runs?check_name=Hansi" \
  --jq '[.check_runs[] | select(.name == "Hansi")] | sort_by(.started_at) | last | .app.slug'
```

Hansi's review comments are authored by `<slug>[bot]`. If you still cannot find a handle, ask the user. Do not guess, and do not mention a different bot.

### 3. Loop

Repeat the cycle below. **Stop after 5 iterations.**

#### A. Make sure a review of the current head is running

Push commits that are not on the remote yet:

```bash
git status --short --branch
git push
```

A push reviews the new commits on its own when automatic reviews are enabled (the default). Look at the `Hansi` check on the **current** head SHA, not an older one:

```bash
HEAD_SHA=$(gh pr view <PR_NUMBER> --json headRefOid -q .headRefOid)
gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/check-runs?check_name=Hansi" \
  --jq '[.check_runs[] | select(.name == "Hansi")] | sort_by(.started_at) | last | {status, conclusion, started_at, title: .output.title, summary: .output.summary}'
```

A completed check for this head is the review to read. Do not request another one.

If this head has no `Hansi` check, wait about 30 seconds and look again. The webhook needs a moment after a push. Comment only if it is still missing. Skip the comment when `status` is `queued` or `in_progress`.

```bash
gh pr comment <PR_NUMBER> --body "@<slug> review"
```

The comment must be plain text. A mention inside a code span or a quote does not start a review.

Poll until that check completes. Reviews read the repository, so allow about 15 minutes (90 attempts, 10 seconds apart):

```bash
ATTEMPTS=0
MAX_ATTEMPTS=90
while true; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -gt "$MAX_ATTEMPTS" ]; then
    echo "Timed out waiting for the Hansi check." >&2
    exit 1
  fi
  CHECK=$(gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/check-runs?check_name=Hansi" \
    --jq '[.check_runs[] | select(.name == "Hansi")] | sort_by(.started_at) | last')
  STATUS=$(echo "$CHECK" | jq -r '.status // empty')
  if [ -z "$STATUS" ]; then
    echo "Waiting for the Hansi check to appear..."
    sleep 10
    continue
  fi
  if [ "$STATUS" = "completed" ]; then
    echo "$CHECK" | jq -r '"Hansi check completed: \(.conclusion) — \(.title)"'
    break
  fi
  echo "Waiting for Hansi... ($STATUS)"
  sleep 10
done
```

Stop the loop, and do not use an older review, when:

- polling times out
- `conclusion` is `skipped` (drafts, disabled reviews, or a base branch Hansi does not review)
- the check title is `Review failed`

`failure` means Hansi requested changes. `neutral` means it commented. Both are finished reviews: keep going and read the comments.

#### B. Read the review

Fetch the summary comment again (the command in step 2). Hansi edits that same comment in place. Parse:

- **Tier**, from the heading `Tier S` through `Tier F`. **S** means ready to merge. Open findings cap it: a minor finding means at most **A**, a major one at most **B**, a critical one at most **D**. Informational notes do not lower it.
- **Still open**, the section `Still open from earlier reviews`, and the findings table of comments posted on this review.
- **Approval withheld**, a `> [!NOTE]` block. Hansi will not approve in that case (for example, the author has no write access). Clearing comments does not change that.

Then list unresolved review threads and keep the ones whose first comment is from `<slug>[bot]`:

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

Page with `endCursor` while `hasNextPage` is true. A finding comment starts with a bold title, then the explanation, sometimes a `suggestion` block, and a footer like `Major · bug`.

Also read the latest Hansi review body. If GitHub rejected the inline comments, the findings are in that body instead of threads. Treat those as open too.

#### C. Stop when the pull request is clean

Stop when **all** of these are true:

- The tier in the current summary is **S**
- Hansi has **no unresolved threads**, and the summary has no findings still open
- You are not waiting on a review of commits you just pushed

Then, if the latest `Hansi` check on this head is `failure` (the pull request is still in "changes requested"), request **one** `@<slug> review` and wait for it, so Hansi can submit the approval. Do not repeat that extra review. If the follow-up still does not approve, stop and report the summary note. A withheld approval or `approve: false` in `.hansi.json` will not become an approval.

Also stop when the fifth iteration finishes. Report whatever is left.

#### D. Fix what Hansi asked for

For each unresolved Hansi finding:

1. Read the file, the diff hunk, and the comment.
2. Fix it in the code when it describes a real bug. Apply a suggestion block only when it actually fixes that bug.
3. When the comment does not apply, reply on **that thread** with a short reason. A reply to a finding is enough; you do not need to mention Hansi again. Hansi answers, and dismisses the finding when it agrees.

```bash
gh api "repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<COMMENT_ID>/replies" -f body='...'
```

Do **not** call `resolveReviewThread` yourself. Resolving a thread in GitHub leaves the finding open in Hansi's summary, so the tier stays capped. Hansi resolves the thread when a later review sees the fix, or when it dismisses the finding after your reply.

#### E. Wait for replies before reviewing again

If you replied on any thread, wait until Hansi has answered (it reacts with 👀, then comments) or about 5 minutes have passed. A dismissal updates the summary comment. Read it again before you decide the iteration still needs code changes.

#### F. Commit and push code changes

If you changed files, commit only those files. Leave unrelated work unstaged.

```bash
git add path/to/file
git commit -m "address hansi review feedback (hansi-loop iteration N)"
git push
```

Go back to step **A**. The push starts the next review; do not also comment `@<slug> review` unless that check never appears.

If the only action was thread replies and nothing remains open, go back to step **C** without pushing an empty commit.

### 4. Report

After the loop, summarize:

```
hansi-loop complete.
  Pull request:  #123
  Iterations:    2
  Tier:          S
  Resolved:      4 comments
  Remaining:     0
```

When the loop stops early:

```
hansi-loop stopped after 5 iterations.
  Pull request:  #123
  Tier:          A
  Resolved:      6 comments
  Remaining:     1

Remaining issues:
  - src/auth.ts:45 — "Session cookie is not marked HttpOnly"
```

Include the pull request URL. If Hansi withheld approval, say so in the report even when the tier is **S** and nothing is left open.
