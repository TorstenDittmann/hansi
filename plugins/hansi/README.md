# Hansi

[hansi.codes](https://hansi.codes) reviews GitHub pull requests and grades them from **S** to **F**. This plugin installs the `hansi-loop` skill, which keeps fixing the current pull request until Hansi grades it **Tier S** and no review comments are left open.

## Install

From the [Cursor Marketplace](https://cursor.com/marketplace), install **Hansi**. In chat, run `/hansi-loop`.

Or install the skill with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add TorstenDittmann/hansi --skill hansi-loop
```

## Requirements

- The [Hansi GitHub App](https://hansi.codes) installed on the repository
- [GitHub CLI](https://cli.github.com), authenticated with `gh auth login`
- `git`

Pass a pull request number to review that one. Otherwise the skill uses the pull request for the current branch.

Each review spends the repository owner's model credits. The skill stops after 5 iterations.
