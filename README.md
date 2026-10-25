# NorthPoint President's Dashboard

A private web page with three parts:

- **Dashboard** (what the President sees): headline, three escalation cards, the Q3 tracker table.
- **Review & publish** (you only): edit figures, confirm each data owner and each figure, run consistency checks, then publish a new version. Every version is kept and can be restored.
- **Follow-ups** (you only): reminder emails drafted per data owner from the risk assessment. You approve each one before it is sent.

The President only ever sees the last published version. Drafts, checks and emails are visible to admins only.

## What's in this folder

| Path | What it is |
|---|---|
| `public/index.html` | The whole page. All starting figures are in the `DATA` block near the top of the script. |
| `public/_headers` | Keeps the page out of search engines. |
| `functions/api/[[path]].js` | The small server: saves the draft, publishes versions, sends emails. |

No build step. Cloudflare serves `public/` and runs `functions/` automatically.

---

## Setup (about 20 minutes, all in the browser)

Cloudflare's menu labels change from time to time; if a label below doesn't match exactly, look for the closest one.

### 1. GitHub
Claude pushes the code for you. You only need to create an empty **private** repository named `northpoint-dashboard` at github.com/new (no README, no licence) and tell Claude its name.

### 2. Cloudflare account
Sign up free at dash.cloudflare.com.

### 3. Create the site
1. **Workers & Pages → Create → Pages → Connect to Git.**
2. Authorise GitHub and pick `northpoint-dashboard`.
3. Build settings: Framework preset **None**, Build command **empty**, Build output directory **`public`**.
4. **Save and Deploy.** You get an address like `northpoint-dashboard.pages.dev`.

### 4. Add storage (where drafts and versions live)
1. **Storage & Databases → KV → Create namespace**, name it `northpoint-dashboard`.
2. Back in your Pages project: **Settings → Bindings → Add → KV namespace**. Variable name **`DASH`**, namespace `northpoint-dashboard`. Save.

### 5. Say who can edit
In the Pages project: **Settings → Variables and Secrets → Add**
- Name `ADMIN_EMAILS`, value: your email (add more separated by commas).

Until this is set, anyone who can open the page can edit (the page shows "Setup mode").

### 6. Make the page private
1. **Zero Trust** (left menu) → pick the free plan if asked.
2. **Access → Applications → Add an application → Self-hosted.**
3. Application domain: `northpoint-dashboard.pages.dev`. Add a second one: `*.northpoint-dashboard.pages.dev`.
4. Policy: **Allow**, Include → **Emails** → your email and the President's email.
5. Login method: **One-time PIN** (people get a code by email; no passwords).

### 7. Redeploy
**Deployments → latest deployment → Retry deployment** so steps 4 and 5 take effect. Open the address, sign in with your email, and the dashboard loads its first version automatically.

### 8. (Optional) Real email delivery
Without this step, "Send" logs reminders in the Sent tab but delivers nothing, which is safe for rehearsal.
1. Create a free account at resend.com and verify a domain you own.
2. Create an API key.
3. In Pages **Settings → Variables and Secrets** add `RESEND_API_KEY` (type **Secret**) and `MAIL_FROM` (e.g. `pmo@yourdomain.com`).
4. Replace the sample contacts in **Follow-ups → Directory** with real ones. Redeploy.

---

## Day-to-day

1. **Review & publish → Rows**: open each row, update figures, then set *Data owner* (Confirmed / No owner) and *Figures* (Reconciled / Exception with a note). The dashboard behind the panel shows the draft as you type; shaded cells differ from live.
2. **Checks** lists what blocks publishing (headline numbers the data doesn't support, totals that don't add up, exceptions without a note) and warnings (stale dates, sources that disagree, shared owners).
3. **Publish to live** unlocks when every visible row is confirmed and nothing blocks.
4. **Follow-ups**: review each drafted email, edit if needed, approve, send. Mark replies in **Sent**; unreplied reminders switch to the follow-up template.
5. New month: **Headline & cards → Start a new review cycle** clears all confirmations.

## Financial model (pending)
The **Cost → Operating cost** rows (People, Contractors, Cloud & hosting, Software & licences, Sales & marketing, G&A, and the total) are set up but hidden until the model's figures are in. Share the model with Claude to fill them.
