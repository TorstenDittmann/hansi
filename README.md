# hans

Open-source, self-hostable AI code review for GitHub pull requests. Bring your own key for OpenAI,
Anthropic, xAI, Google, OpenRouter, or any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM, …).

- **Fewer, better comments.** An agent explores the repository before commenting, then a second,
  skeptical pass verifies every finding. Findings below your severity threshold or outside the
  diff are dropped, and the dashboard shows what was dropped and why.
- **Transparent.** Every review records which files the agent read, what it searched for, token
  usage, and cost per model call.
- **Runs anywhere.** One Docker image and a libSQL database file. No Redis, no Postgres.
- **Conversational.** Ask `@hans` anything in a pull request, or reply to one of its comments.
  When you state a preference ("we don't flag this in tests"), hans remembers it for future
  reviews. Replies also record whether a finding was fixed or dismissed.
- **Incremental.** New pushes are reviewed on their own, and earlier comments are never repeated.
- **Config as code.** `.hans.yml` in the repository, plus `AGENTS.md`, `CLAUDE.md`,
  `.cursorrules`, and `.github/copilot-instructions.md` as review guidelines.

## Quick start (self-hosted)

```sh
cp .env.example .env
# Fill in HANS_ENCRYPTION_KEY and BETTER_AUTH_SECRET: openssl rand -base64 32
# Set APP_URL to the public URL GitHub can reach.
docker compose -f docker/compose.yml up -d
```

Then open `APP_URL/setup`:

1. **Create GitHub App.** hans uses GitHub's manifest flow to create an app with the right
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
every bug hans should have caught. The `Evals` workflow runs the suite on demand or on pull
requests labeled `run-evals`.

## Repository configuration

Add `.hans.yml` to the repository root. Every field is optional:

```yaml
reviews:
  enabled: true
  auto: true # review on open/push; mentions always work
  drafts: false
  base_branches: [] # empty = all
  path_filters: ['!docs/**', '!**/*.snap']
  profile: balanced # chill | balanced | strict
  min_severity: minor # info | minor | major | critical
  max_comments: 15
instructions: |
  We use Result types instead of exceptions in src/domain.
path_instructions:
  - path: 'migrations/**'
    instructions: Check that every migration is reversible.
language: en
```

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
| `packages/config` | Environment and `.hans.yml` schemas                                      |
| `packages/evals`  | Review-quality benchmark: cases with known bugs, scoring, runner         |

**Deployment modes.** By default, one container runs both web and worker on a shared database
file (`HANS_MODE=all`). To run them as separate containers, point both at
[sqld](https://github.com/tursodatabase/libsql) with `DATABASE_URL=http://sqld:8080` and set
`HANS_MODE=web` or `HANS_MODE=worker`.

**Security model.** The agent can only read files and search the checkout; it never executes
repository code. Provider keys and GitHub App secrets are encrypted with AES-256-GCM using
`HANS_ENCRYPTION_KEY`. Webhooks are signature-verified and deduplicated. Mentions only trigger
reviews for owners, members, and collaborators, since every review spends your API credits.

## License

[MIT](LICENSE)
