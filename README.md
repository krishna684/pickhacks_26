<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/9c5ba7f8-3bf0-43da-9da1-9b69955bf6f5

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. (Optional) Configure Auth0 in `.env.local` for real authentication:
   - `VITE_AUTH0_DOMAIN`
   - `VITE_AUTH0_CLIENT_ID`
   - `VITE_AUTH0_AUDIENCE` (if used)
   - `VITE_AUTH0_ROLE_CLAIM` (defaults to `https://civicsafe.app/role`)
4. Run the app:
   `npm run dev`

### Auth Notes

- If Auth0 variables are not configured, the app runs in local mock auth mode.
- In mock mode, use the role selector in the header to switch between `citizen`, `operator`, `planner`, and `admin`.
- Backend role checks are enforced on sensitive endpoints:
  - `PATCH /api/segments/:id/tune` -> `planner` or `admin`
  - `PATCH /api/complaints/:id` -> `operator` or `admin`
  - `POST /api/ai/daily-brief` -> `operator` or `admin`

### Integration Endpoints

- `GET /api/integrations/complaints/export?format=json|csv&status=open|in_progress|resolved&since=<ISO date>`
  - Role: `operator` or `admin`
  - Exports complaint data for downstream city systems.
- `POST /api/integrations/incidents/import`
  - Role: `admin`
  - Imports external incident feed payloads into local store.
- `GET/POST/PATCH /api/integrations/webhooks`
  - Role: `admin`
  - Manage webhook subscriptions for complaint created/updated events.
- `GET /api/admin/audit-logs?limit=100`
  - Role: `admin`
  - Reads audit records for sensitive actions and data exports.
