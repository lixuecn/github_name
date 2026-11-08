# Cloudflare Web deployment

The `Deploy Web to Cloudflare` workflow deploys `apps/web` on pushes to
`main`, or manually from the GitHub Actions tab.

Configure these under repository Settings → Secrets and variables → Actions:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Token with permission to deploy Workers in the target account |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account ID |
| Variable | `NEXT_PUBLIC_SERVER_URL` | Public HTTPS URL of the deployed Hono API |

The Worker is named `github-name` (served at `https://github-name.<account-subdomain>.workers.dev`). To rename it, update both `name`
and the `WORKER_SELF_REFERENCE` service in `apps/web/wrangler.jsonc`.

The API service and database must be deployed separately. Set the API's
`CORS_ORIGIN` to allow the deployed Web origin.
Changing `NEXT_PUBLIC_SERVER_URL` requires rebuilding the Web app.

To build locally, run `pnpm --filter web build:cloudflare`.
To build and deploy locally with Cloudflare credentials, run
`pnpm --filter web deploy`.

Reference: https://opennext.js.org/cloudflare/get-started
