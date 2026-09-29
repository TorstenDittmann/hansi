# hansi.codes

[hansi.codes](https://hansi.codes) reviews GitHub pull requests and grades them from **S** to **F**. This plugin installs four skills and one rule.

| Skill           | What it does                                                                              |
| --------------- | ----------------------------------------------------------------------------------------- |
| `/hansi-status` | Read the current tier, open findings, and filtered-out comments. Does not start a review. |
| `/hansi-learn`  | Reply on a finding with a lasting rule so Hansi remembers it.                             |
| `/hansi-setup`  | Write `.hansi.json` and open a pull request onto the base branch.                         |
| `/hansi-loop`   | Fix the pull request until Hansi grades it **Tier S** and no comments are left open.      |

The rule tells the agent not to resolve Hansi threads in GitHub. Hansi clears a thread after a later review sees the fix, or after it dismisses the finding.

## Install

In Cursor, open Plugins, choose Add Marketplace, and import this repository. Then install **hansi.codes**.

```text
https://github.com/TorstenDittmann/hansi
```

Claude Code:

```sh
claude plugin marketplace add TorstenDittmann/hansi
claude plugin install hansi.codes@hansi.codes
```

Codex:

```sh
codex plugin marketplace add TorstenDittmann/hansi
codex plugin install hansi-codes --source hansi-codes
```

Or install one skill with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add TorstenDittmann/hansi --skill hansi-loop
```

Replace `hansi-loop` with `hansi-status`, `hansi-learn`, or `hansi-setup`.

Listing the plugin in Anthropic's directory or the OpenAI plugin directory is a separate submission. This repository is the git marketplace the commands above install from.

## Requirements

- The [Hansi GitHub App](https://hansi.codes) installed on the repository
- A way to talk to GitHub and git. The examples use the [GitHub CLI](https://cli.github.com) and git. Another client is fine when that is what the environment has.

Pass a pull request number to review that one. Otherwise the skill uses the pull request for the current branch.

`/hansi-loop` spends the repository owner's model credits on each review and stops after 5 iterations. `/hansi-status` does not request a review.
