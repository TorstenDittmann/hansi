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
cd docker && docker compose up -d
```

This loads `docker/compose.yml` and `docker/compose.override.yml`, which publishes port 3000.
`docker/compose.yml` includes `docker/compose.web.yml` (the web app) and
`docker/compose.worker.yml` (the workers). Platforms that deploy a compose file, such as Dokploy,
can deploy `docker/compose.yml` alone, or each of the two files as its own deployment; set the
variables in their UI.

This starts two containers from one image: `hans`, the web app on port 3000, which applies database
migrations on every start, and `worker`, which runs reviews. Both use the database in the `hans-data`
volume. Put a reverse proxy with TLS in front of it (Caddy, Traefik,
nginx), then continue with [Set up the GitHub App](#set-up-the-github-app).

Each review runs its commands, such as installing dependencies and running tests, in a
[gVisor](https://gvisor.dev) sandbox inside the worker container. It needs no KVM, no Docker socket,
and no privileges, but the worker must run with `seccomp=unconfined`, `apparmor=unconfined`, and
`label=disable` (see `docker/compose.yml`), because gVisor creates a user namespace and installs its
own syscall filters. Docker Swarm ignores these options, so platforms that deploy as swarm services
(such as Dokploy applications) need a plain Docker Compose deployment instead. Without that, reviews
read code only. Each organization can turn the sandbox off in its settings.

`docker/compose.yml` limits each worker, sandboxes included, to 2 CPUs and 6 GB of memory. Change
this with `HANSI_CPUS` and `HANSI_MEMORY` (e.g. `4` and `8g`) in the same place as the other
variables. Each sandbox is also stopped when it uses more than 2 GiB, and `WORKER_CONCURRENCY`
(default 2) sets how many run at once in each worker. To review more pull requests at once, set
`HANSI_WORKERS` (default 1) to run more workers; the limits apply to each.

Reviews check out the pull request and run their sandbox in `/tmp/hans`, a volume in
`docker/compose.yml` that all workers share. Dependencies installed there can take several GB per review while it runs.
To keep this off the system disk, set `HANSI_WORKDIR` to a directory on another disk, e.g.
`/mnt/volume/hansi`, owned by uid 1000 (`chown 1000:1000 /mnt/volume/hansi`).

To use the prebuilt image instead of building it, replace the `build:` sections in
`docker/compose.web.yml` and `docker/compose.worker.yml` with `image: ghcr.io/torstendittmann/hansi:latest`. A new image is published
for amd64 and arm64 with every [release](https://github.com/TorstenDittmann/hansi/releases), tagged
with its version (e.g. `1.2.3` and `1.2`) and `latest`.

## Set up the GitHub App

Open `APP_URL/setup` and click **Create GitHub App**. GitHub's manifest flow creates an app with
the right permissions, webhook, and callback URLs, and Hansi stores its credentials encrypted in the
database. Then:

1. **Sign in** with GitHub. The first person to sign in owns the instance.
2. **Install the app** on the accounts and repositories you want reviewed.
3. Under **Models**, connect a provider and choose a model for **Review**. **Verify** is optional
   and defaults to the review model. Set a reasoning effort when the model supports one; otherwise
   leave the provider default.

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

| Variable                 | Required | Description                                                                                                      |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                | Yes      | Public URL of the instance. GitHub sends webhooks here.                                                          |
| `ORIGIN`                 | Yes      | Same as `APP_URL`. The web server checks form submissions against it. The image uses `APP_URL` when it is unset. |
| `HANS_ENCRYPTION_KEY`    | Yes      | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts provider keys and GitHub App secrets. Back it up.  |
| `BETTER_AUTH_SECRET`     | Yes      | At least 32 characters (`openssl rand -base64 32`). Signs sessions.                                              |
| `DATABASE_URL`           |          | `file:/data/hans.db` in the image. Or `http://…` / `libsql://…` for sqld or Turso.                               |
| `DATABASE_AUTH_TOKEN`    |          | Token for sqld or Turso. For HTTP Basic auth, put the credentials in the URL instead.                            |
| `SIGNUP_MODE`            |          | `restricted` (default) or `open`. See [Who can sign up](#who-can-sign-up).                                       |
| `ALLOWED_GITHUB_USERS`   |          | Comma-separated GitHub logins that may sign up in `restricted` mode.                                             |
| `HANS_MODE`              |          | `all` (default), `web`, or `worker`. See [Deployment modes](#deployment-modes).                                  |
| `HANS_SKIP_MIGRATIONS`   |          | `true` to skip migrations on start.                                                                              |
| `WORKER_CONCURRENCY`     |          | Reviews one worker runs at a time. Default `2`.                                                                  |
| `WORKER_WORKDIR`         |          | Directory for temporary checkouts. Default `/tmp/hans` in the image.                                             |
| `PORT`                   |          | Port the web app listens on. Default `3000`.                                                                     |
| `LOG_LEVEL`              |          | `trace`, `debug`, `info` (default), `warn`, `error`, or `fatal`.                                                 |
| `GITHUB_APP_ID`          |          | With the five below: use an existing GitHub App instead of `/setup`.                                             |
| `GITHUB_APP_SLUG`        |          | The app's URL name, e.g. `hansi-reviews`.                                                                        |
| `GITHUB_APP_PRIVATE_KEY` |          | The PEM private key, on one line with `\n` for line breaks.                                                      |
| `GITHUB_WEBHOOK_SECRET`  |          | The webhook secret set in the app.                                                                               |
| `GITHUB_CLIENT_ID`       |          | The app's client ID.                                                                                             |
| `GITHUB_CLIENT_SECRET`   |          | A client secret generated in the app.                                                                            |

### Who can sign up

With `SIGNUP_MODE=restricted` (the default), these people can create an account:

- the first user;
- the GitHub logins in `ALLOWED_GITHUB_USERS`;
- anyone with a pending invitation to an organization on the instance;
- anyone who opens an active invite link for an organization on the instance.

Invite teammates from **Members** in the dashboard, by email or with an invite link. Set
`SIGNUP_MODE=open` to let anyone with a GitHub account sign up, e.g. for a public service. Each
organization keeps its own model keys, installations, and costs.

## Deployment modes

**Web and workers (default).** `docker/compose.yml` runs the web app (`HANS_MODE=web`, from
`compose.web.yml`) and `HANSI_WORKERS` workers (`HANS_MODE=worker`, from `compose.worker.yml`) on
one host, sharing a database file on a volume. Run any number of workers: they claim jobs from the
database, so each review runs once. To deploy the web app and the workers separately, deploy each
file on its own; they then need a networked database (below).

**One container.** `HANS_MODE=all` (the image's default) runs the web app and a worker in one
container, e.g. with a plain `docker run`.

**Workers on other machines.** Containers on different hosts can't share a database file, so they
need a networked database:

1. Run sqld, e.g. the `ghcr.io/tursodatabase/libsql-server` image, with a volume for
   `/var/lib/sqld`.
2. Point every container at it with `DATABASE_URL=http://sqld:8080`. If sqld uses HTTP Basic auth,
   put the credentials in the URL: `http://user:password@sqld:8080`.
3. Only the web container runs migrations, so start it first. A worker that starts on an empty
   database exits, and comes back once your orchestrator restarts it.
4. Give all of them the same `HANS_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `APP_URL`, and GitHub
   variables. Only the web container needs a domain and a port.

### Dokploy

Dokploy **Applications** run as swarm services, which can't run the sandbox, so deploy a
**Compose** service instead:

1. Create a project with a **libSQL** database. Dokploy protects it with HTTP Basic auth; the user
   is `libsql`, and the password is on the database's page.
2. Create two **Compose** services of type Docker Compose from the GitHub repository, branch
   `main`: the web app with the compose path `./docker/compose.web.yml`, and the workers with
   `./docker/compose.worker.yml`. (One service with `./docker/compose.yml` runs both instead.)
3. Give both the same variables, with
   `DATABASE_URL=http://libsql:<password>@<database app name>:8080`, and attach both to the
   database's network so that name resolves. Set `HANSI_WORKERS` and the other worker settings on
   the workers.
4. Add your domain to the web app's `hans` service on port 3000, with HTTPS.

Push to `main` and both redeploy. The web app runs the migrations, so a worker that starts first
exits and comes back once they have run.

## Analytics

Self-hosted instances send no analytics. The hosted service at hansi.codes uses PostHog, and the
code only turns it on when the instance runs at `hansi.codes`, based on the browser's hostname and
on `APP_URL`.

## Backups and upgrades

**Back up** the database (`/data/hans.db` in the default setup, or sqld's data directory) and
`HANS_ENCRYPTION_KEY`. Without the key, the stored provider keys and GitHub App credentials can't
be decrypted.

**Upgrade** by pulling the new release's image (or building from the new code) and restarting. Migrations run automatically when
the web app starts.
