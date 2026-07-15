# AcuityCx API

## Swagger / OpenAPI

Swagger is available only when both conditions are true:

- `NODE_ENV` is not `production`
- `ENABLE_SWAGGER=true` or `NEXT_PUBLIC_ENABLE_SWAGGER=true`

For local development, add this to `.env.local`:

```env
ENABLE_SWAGGER=true
```

Then run:

```bash
npm install
npm run dev
```

Open Swagger UI at:

```text
http://localhost:3000/swagger
```

The OpenAPI JSON is served at:

```text
http://localhost:3000/api/swagger
```

In production, Swagger is disabled even if the environment flag is set. Direct requests to `/swagger`, `/api/swagger`, and `/swagger-ui/*` return a not-found response.

## Static Swagger UI Assets

Swagger UI uses static assets copied from `swagger-ui-dist` into `public/swagger-ui`.

Run this after dependency changes:

```bash
npm run copy-swagger-assets
```

`postinstall` also runs this automatically after `npm install`.

## Documenting New API Endpoints

New App Router handlers under `app/api/**/route.js` are auto-discovered and appear in Swagger with generic documentation. This means a new exported `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` handler appears without manual route registration.

For better endpoint-specific documentation, add a JSDoc block above the handler:

```js
/**
 * @swagger
 * /api/example/{id}:
 *   get:
 *     tags:
 *       - Master
 *     summary: Get example by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       404:
 *         description: Not found
 */
export async function GET(request, { params }) {}
```

Use these category tags where possible:

- Authentication
- OAuth2
- UTOM
- Dashboard
- Users
- Reports
- Master
- Configuration
- Interactions
- System
- Documentation

Security schemes are configured for OAuth2 client credentials, Bearer JWT, and the `sessionToken` cookie.

## OAuth2 Client Credentials

OAuth2 support uses client credentials for third-party applications. Apply the PostgreSQL migration before calling the OAuth endpoints:

```bash
psql "$DATABASE_URL" -f migrations/20260524_oauth2_tables.sql
```

Required environment variables:

```env
OAUTH_TOKEN_SECRET=replace-with-a-long-random-secret
OAUTH_REFRESH_TOKEN_SECRET=replace-with-a-different-long-random-secret
OAUTH_ACCESS_TOKEN_EXPIRES_IN=3600
OAUTH_REFRESH_TOKEN_EXPIRES_IN=2592000
```

OAuth endpoints:

- `POST /api/oauth/clients/register`
- `GET /api/oauth/clients/{client_id}`
- `PATCH /api/oauth/clients/{client_id}/status`
- `POST /api/oauth/clients/{client_id}/regenerate-secret`
- `POST /api/oauth/token`
- `POST /api/oauth/token/refresh`
- `POST /api/oauth/token/revoke`

Client secrets and refresh tokens are stored only as bcrypt hashes. Plain client secrets are returned only during registration or regeneration.
