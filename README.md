# Hansi

[hansi.codes](https://hansi.codes) · Named after Hansi, the cat.

Open-source, self-hostable AI code review for GitHub pull requests. Bring your own key for OpenAI,
Anthropic, xAI, Google, OpenRouter, Amazon Bedrock, or any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM, …).

- **Fewer, better comments.** By default Hansi only points out obvious mistakes, the kind you'd
  agree with at a glance. An agent explores the repository before commenting, then a second,
  skeptical pass verifies every finding. Findings below your severity threshold or outside the
  diff are dropped, and the dashboard shows what was dropped and why.
- **Transparent.** Every review records which files the agent read, what it searched for, token
  usage, and cost per model call.
- **Runs anywhere.** One Docker image and a libSQL database file. No Redis, no Postgres.
- **A real reviewer.** Hansi approves pull requests or requests changes, like a teammate, and
  grades every PR's merge confidence from **S** (ready to merge) to **F** (do not merge). After a
  fix is pushed, it checks its earlier findings and approves once the blocking ones are gone.
- **Conversational.** Ask `@hansi` anything in a pull request, or reply to one of its comments.
  When you state a preference ("we don't flag this in tests"), Hansi remembers it for future
  reviews. Replies also record whether a finding was fixed or dismissed.
- **Incremental.** New pushes are reviewed on their own, and earlier comments are never repeated.
- **Config as code.** `.hansi.yml` in the repository, plus `AGENTS.md`, `CLAUDE.md`,
  `.cursorrules`, and `.github/copilot-instructions.md` as review guidelines.

## Quick start (self-hosted)

```sh
cp .env.example .env
# Fill in HANS_ENCRYPTION_KEY and BETTER_AUTH_SECRET: openssl rand -base64 32
# Set APP_URL to the public URL GitHub can reach.
docker compose -f docker/compose.yml up -d
```

Then open `APP_URL/setup`:

1. **Create GitHub App.** Hansi uses GitHub's manifest flow to create an app with the right
   permissions and webhooks. The credentials are stored encrypted in your database.
2. **Sign in** with GitHub, then **install the app** on the repositories you want reviewed.
3. Under **Models**, add a provider key and choose a model for the `review` role (and optionally a
   different one for `verify`).

Open a pull request, or comment `@<app-name> review` on one. Mention `@<app-name>` with a
question, or reply to one of its comments, to start a conversation.

Sign-ups are restricted by default: the first person to sign in owns the instance. Let teammates
in by adding their GitHub logins to `ALLOWED_GITHUB_USERS` or inviting them to the workspace. Set
`SIGNUP_MODE=open` for a public, multi-tenant deployment.

## Development

Requires [Bun](https://bun.sh) ≥ 1.4, `git`, and [`ripgrep`](https://github.com/BurntSushi/ripgrep). No Docker needed: the
database is a local libSQL file (`data/hans.db`).

```sh
bun install
cp .env.example .env   # fill in the two secrets
bun run dev            # migrates, then starts web (vite) and worker with wsu
```

GitHub must reach your webhook URL. Run a tunnel such as
`cloudflared tunnel --url http://localhost:5173` and set `APP_URL` to its address before creating
the GitHub App.

| Command               | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| `bun run dev`         | Web app and worker with live logs                            |
| `bun run check`       | Type-check every package                                     |
| `bun run test`        | Unit and integration tests (in-memory libSQL, mocked models) |
| `bun run lint`        | Prettier and ESLint                                          |
| `bun run build`       | Production build of the web app                              |
| `bun run eval`        | Score review quality with a real model (see below)           |
| `bun run db:generate` | Generate a migration after changing `packages/db/src/schema` |

## Evals

`packages/evals` measures review quality on small pull requests with known bugs (TypeScript,
Python, Go) and on clean changes where any comment is noise. It builds a real git repository per
case, runs the review engine, and reports precision, recall, F1, and cost:

```sh
EVAL_PROVIDER=anthropic EVAL_MODEL=<model id> EVAL_API_KEY=… bun run eval
bun run eval -- --case sql --repeat 3 --min-f1 0.6
```

Run it before and after changing prompts or models. Add a case to `packages/evals/src/cases` for
every bug Hansi should have caught. The `Evals` workflow runs the suite on demand or on pull
requests labeled `run-evals`.

## Repository configuration

Add `.hansi.yml` to the repository root. Hansi reads it, and guideline files like `AGENTS.md`, from
the pull request's base branch, so changes take effect once merged. Every field is optional:

```yaml
reviews:
  enabled: true
  auto: true # review on open/push; mentions always work
  drafts: false
  base_branches: [] # empty = all
  path_filters: ['!docs/**', '!**/*.snap']
  profile: chill # chill: obvious mistakes only (default) | balanced | strict
  min_severity: minor # info | minor | major | critical
  max_comments: 15
  approve: true # approve PRs without blocking findings
  request_changes: major # severity that blocks a PR; `never` to only comment
  approve_outside_contributors: false # approve PRs from people without write access
instructions: |
  We use Result types instead of exceptions in src/domain.
path_instructions:
  - path: 'migrations/**'
    instructions: Check that every migration is reversible.
language: en
```

### Verdicts and tiers

Each review is submitted to GitHub as **Approve**, **Request changes**, or **Comment**:

- New findings at or above `request_changes` → **Request changes**.
- Blocking findings from an earlier review still open → **Comment**, so the earlier request for
  changes stays in effect until they are fixed or dismissed in the thread.
- Otherwise → **Approve** (minor findings are still posted as comments), unless `approve: false`.

The tier grades merge confidence: **S** ready to merge · **A** mergeable after minor fixes ·
**B** needs changes · **C** significant problems · **D** serious problems · **F** do not merge.
The model grades the PR, but open findings cap the tier: a minor finding means at most **A**, a
major one at most **B**, a critical one at most **D**. Informational notes don't lower it.
The `Hansi` check run follows the verdict (success, failure, or neutral), so you
can make it a required check to block merging.

**Do Hansi's approvals count toward required reviews?** Only if the app has write access to code:
GitHub counts approvals from reviewers with write access, and otherwise lists Hansi under
"Reviewers whose approvals may not affect merge requirements". By default the app gets read-only
access to code: Hansi never pushes code, and write access would let an AI approval alone satisfy a
required review. To opt in, tick the box on the setup page, or for an existing app set
**Repository permissions → Contents** to **Read and write** in the GitHub App settings and accept
the updated permissions on each installation. Without it, gate merges on the `Hansi` check run.

## Architecture

```
GitHub ──webhook──► web (SvelteKit + Hono at /api) ──► libSQL ◄── worker ──► LLM provider
                        dashboard, auth, setup           jobs      clone, review, post
```

| Path              | Purpose                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| `apps/web`        | SvelteKit dashboard; Hono mounted at `/api` for auth, webhooks, and API  |
| `apps/worker`     | Claims review jobs, checks out the PR, runs the engine, posts the review |
| `packages/core`   | Review engine: diff parsing, filters, agent tools, review + verify loop  |
| `packages/db`     | Drizzle schema and migrations for libSQL                                 |
| `packages/queue`  | Durable job queue on the same database (leases, retries, singletons)     |
| `packages/llm`    | Provider registry, key encryption, model listing, models.dev pricing     |
| `packages/github` | GitHub App auth, manifest flow, pull request and check run helpers       |
| `packages/config` | Environment and `.hansi.yml` schemas                                     |
| `packages/evals`  | Review-quality benchmark: cases with known bugs, scoring, runner         |

**Deployment modes.** By default, one container runs both web and worker on a shared database
file (`HANS_MODE=all`). To run them as separate containers, point both at
[sqld](https://github.com/tursodatabase/libsql) with `DATABASE_URL=http://sqld:8080` and set
`HANS_MODE=web` or `HANS_MODE=worker`. For sqld behind HTTP Basic auth (such as Dokploy's libSQL
service), put the credentials in the URL: `http://user:password@sqld:8080`. For a token, use
`DATABASE_AUTH_TOKEN`.

**Security model.** The agent can only read files and search the checkout; it never executes
repository code. Everything in a pull request is treated as untrusted input that may try to steer
the model, so approvals are guarded outside the model: `.hansi.yml` and guideline files come from
the base branch, PRs from people without write access are never approved automatically, and a
review that could not see the whole diff never approves. Provider keys and GitHub App secrets are encrypted with AES-256-GCM using
`HANS_ENCRYPTION_KEY`. Webhooks are signature-verified and deduplicated. Mentions only trigger
reviews for owners, members, and collaborators, since every review spends your API credits.

## License

[MIT](LICENSE)
