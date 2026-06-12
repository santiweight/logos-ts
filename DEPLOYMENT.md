# Deployment

The production Studio runs as a single Fly.io Machine. GitHub Actions deploys
the repository after every push to `main`.

## One-time setup

Install `flyctl`, authenticate, and create an application:

```bash
fly auth login
fly apps create <app-name>
```

Set the runtime secrets directly on Fly. They are not bundled into the image or
sent to the browser:

```bash
fly secrets set \
  --app <app-name> \
  ANTHROPIC_API_KEY='<anthropic-api-key>' \
  LOGOS_AUTH_USERNAME='logos' \
  LOGOS_AUTH_PASSWORD='<long-random-password>'
```

`CLAUDE_CODE_OAUTH_TOKEN` can be used instead of `ANTHROPIC_API_KEY`.

Create an app-scoped deploy token and add it to the GitHub repository as the
Actions secret `FLY_API_TOKEN`:

```bash
fly tokens create deploy --app <app-name>
gh secret set FLY_API_TOKEN
gh variable set FLY_APP_NAME --body '<app-name>'
```

The next push to `main`, or a manual run of the `Deploy` workflow, builds and
deploys the application. The public URL is:

```text
https://<app-name>.fly.dev
```

## Security model

- Every Studio page, API route, Storybook iframe, and WebSocket requires a
  signed login session.
- The login cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` behind Fly HTTPS.
- Claude credentials remain server-side environment variables.
- The deployed process refuses to start without login credentials or a Claude
  credential.

Anyone with the shared Studio login can spend the configured Claude account's
tokens and direct an agent that can edit files and run commands inside the
application container. Only share the login with people you trust.
