# Self-hosting Hansi

Hansi runs as one Docker image with a libSQL database: a file on a volume, or a
[sqld](https://github.com/tursodatabase/libsql) server. It needs no Redis and no Postgres. The same
image runs the web app (dashboard, webhooks) and the worker (reviews), together or as separate
containers.

You need:

- A server that GitHub can reach over HTTPS.
- A domain for it, e.g. `hansi.example.com`.
- An API key from a model provider.

## Quick start with Docker Compose

```sh
git clone https://github.com/TorstenDittmann/hansi.git
cd hansi
cp .env.example .env
```

In `.env`, set:

- `APP_URL` to your public URL, e.g. `https://hansi.example.com`.
- `HANS_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`, each generated with `openssl rand -base64 32`.

Then start it:

```sh
docker compose -f docker/compose.yml up -d
```

The container listens on port 3000, stores its database in the `hans-data` volume, and applies
database migrations on every start. Put a reverse proxy with TLS in front of it (Caddy, Traefik,
nginx), then continue with [Set up the GitHub App](#set-up-the-github-app).

To use the prebuilt image instead of building it, replace the `build:` section in
`docker/compose.yml` with `image: ghcr.io/torstendittmann/hansi:main`. It is published for amd64
and arm64 on every push to `main`.

## Set up the GitHub App

Open `APP_URL/setup` and click **Create GitHub App**. GitHub's manifest flow creates an app with
the right permissions, webhook, and callback URLs, and Hansi stores its credentials encrypted in the
database. Then:

1. **Sign in** with GitHub. The first person to sign in owns the instance.
2. **Install the app** on the accounts and repositories you want reviewed.
3. Under **Models**, connect a provider and choose a model for **Review**. **Verify** is optional
   and defaults to the review model.

Open a pull request, or comment `@<app-name> review` on one, to see the first review.

### Approvals and required reviews

GitHub only counts approvals from reviewers with write access to the code. By default the app gets
read-only access to code: Hansi never pushes code, and write access would let an AI approval alone
satisfy a required review. Its approvals then show under "Reviewers whose approvals may not affect
merge requirements". To gate merges without that, make the `Hansi` check run a required status
check.

To let its approvals count, tick the box on the setup page. For an existing app, set
**Repository permissions → Contents** to **Read and write** in the GitHub App settings, then accept
the updated permissions on each installation.

### Using an existing GitHub App

To manage the app yourself, set its credentials as environment variables. They take precedence over
an app created through `/setup`. In the app's settings on GitHub, set these URLs:

| Setting      | URL                                |
| ------------ | ---------------------------------- |
| Webhook URL  | `APP_URL/api/webhooks/github`      |
| Callback URL | `APP_URL/api/auth/callback/github` |
| Setup URL    | `APP_URL/setup/github/installed`   |

Give it these permissions:

- **Repository:** Contents (read, or read and write, see above), Pull requests (read and write),
  Issues (read and write), Checks (read and write), Metadata (read).
- **Account:** Email addresses (read).

Subscribe it to the **Pull request**, **Issue comment**, and **Pull request review comment**
events.

## Configuration

Hansi reads its configuration from environment variables.

| Variable                 | Required | Description                                                                                                     |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                | Yes      | Public URL of the instance. GitHub sends webhooks here.                                                         |
| `ORIGIN`                 | Yes      | Same as `APP_URL`. The web server checks form submissions against it. `docker/compose.yml` sets it for you.     |
| `HANS_ENCRYPTION_KEY`    | Yes      | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts provider keys and GitHub App secrets. Back it up. |
| `BETTER_AUTH_SECRET`     | Yes      | At least 32 characters (`openssl rand -base64 32`). Signs sessions.                                             |
| `DATABASE_URL`           |          | `file:/data/hans.db` in the image. Or `http://…` / `libsql://…` for sqld or Turso.                              |
| `DATABASE_AUTH_TOKEN`    |          | Token for sqld or Turso. For HTTP Basic auth, put the credentials in the URL instead.                           |
| `SIGNUP_MODE`            |          | `restricted` (default) or `open`. See [Who can sign up](#who-can-sign-up).                                      |
| `ALLOWED_GITHUB_USERS`   |          | Comma-separated GitHub logins that may sign up in `restricted` mode.                                            |
| `HANS_MODE`              |          | `all` (default), `web`, or `worker`. See [Deployment modes](#deployment-modes).                                 |
| `HANS_SKIP_MIGRATIONS`   |          | `true` to skip migrations on start.                                                                             |
| `WORKER_CONCURRENCY`     |          | Reviews one worker runs at a time. Default `2`.                                                                 |
| `WORKER_WORKDIR`         |          | Directory for temporary checkouts. Default `/tmp/hans` in the image.                                            |
| `PORT`                   |          | Port the web app listens on. Default `3000`.                                                                    |
| `LOG_LEVEL`              |          | `trace`, `debug`, `info` (default), `warn`, `error`, or `fatal`.                                                |
| `GITHUB_APP_ID`          |          | With the five below: use an existing GitHub App instead of `/setup`.                                            |
| `GITHUB_APP_SLUG`        |          | The app's URL name, e.g. `hansi-reviews`.                                                                       |
| `GITHUB_APP_PRIVATE_KEY` |          | The PEM private key, on one line with `\n` for line breaks.                                                     |
| `GITHUB_WEBHOOK_SECRET`  |          | The webhook secret set in the app.                                                                              |
| `GITHUB_CLIENT_ID`       |          | The app's client ID.                                                                                            |
| `GITHUB_CLIENT_SECRET`   |          | A client secret generated in the app.                                                                           |

### Who can sign up

With `SIGNUP_MODE=restricted` (the default), these people can create an account:

- the first user;
- the GitHub logins in `ALLOWED_GITHUB_USERS`;
- anyone with a pending invitation to an organization on the instance.

Invite teammates from **Members** in the dashboard. Set `SIGNUP_MODE=open` to let anyone with a
GitHub account sign up, e.g. for a public service. Each organization keeps its own model keys,
installations, and costs.

## Deployment modes

**One container (default).** `HANS_MODE=all` runs the web app and the worker in one container,
sharing a database file on a volume. This is what `docker/compose.yml` does, and it is enough for
most teams.

**Separate web and worker containers.** To scale the worker on its own, or to run it on another
machine, both need a networked database instead of a shared file:

1. Run sqld, e.g. the `ghcr.io/tursodatabase/libsql-server` image, with a volume for
   `/var/lib/sqld`.
2. Point both containers at it with `DATABASE_URL=http://sqld:8080`. If sqld uses HTTP Basic auth,
   put the credentials in the URL: `http://user:password@sqld:8080`.
3. Set `HANS_MODE=web` on one container and `HANS_MODE=worker` on the other. Only the web
   container runs migrations, so start it first. A worker that starts on an empty database exits,
   and comes back once your orchestrator restarts it.
4. Give both the same `HANS_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `APP_URL`, and GitHub
   variables. Only the web container needs a domain and a port.

Run any number of workers. They claim jobs from the database, so each review runs once.

### Dokploy

1. Create a project with a **libSQL** database. Dokploy protects it with HTTP Basic auth; the user
   is `libsql`, and the password is on the database's page.
2. Create two **Applications** from the GitHub repository, branch `main`. For each, set **Build
   type** to Dockerfile, **Dockerfile** to `docker/Dockerfile`, and **Context** to `.`.
3. Give both the variables from step 4 above, with
   `DATABASE_URL=http://libsql:<password>@<database app name>:8080`. Add `HANS_MODE=web` and
   `ORIGIN` to the first, and `HANS_MODE=worker` to the second.
4. Add your domain to the web application on port 3000, with HTTPS.
5. Deploy the web application first, so it runs the migrations, then the worker.

Push to `main` and both redeploy.

## Backups and upgrades

**Back up** the database (`/data/hans.db` in the default setup, or sqld's data directory) and
`HANS_ENCRYPTION_KEY`. Without the key, the stored provider keys and GitHub App credentials can't
be decrypted.

**Upgrade** by pulling or building the new image and restarting. Migrations run automatically when
the web app starts.
