# NorthPoint President's Dashboard

Live at **https://northpoint-dashboard-7fd.pages.dev** (Cloudflare Pages, deploys automatically on every push to `main`).

## What the page does

- **Escalations to the President**: three cards. Click one to dim the page, jump to and highlight the linked rows, and pop up the numbered call-outs. Each card has a **Follow up** button that opens an email draft (written by AI when connected).
- **Other issues**: a collapsible list of further issues in the same Issue / Impact / Next step format, leaving out what the escalations cover. With an AI key it's written by AI from the current figures and refreshes when the data changes; without one it uses rule-based checks. Each issue has its own Follow up button.
- **1 Commercial**: Recognized revenue (collapsible) and Bookings & pipeline with a period selector (current quarter / next 2 quarters / both), deal value, weight and share of pipeline.
- **2 Cost**: cloud run-rate per month broken into cost per active account and implied accounts, plus NorthPoint cost to serve from the deal model with revenue and gross margin per offer.
- **3 Operations**: each project with owner, last updated, deadline countdown, status, notes tagged by issue type (Reporting, Staffing, Funding, Ownership), a Follow up button for blockers, and a timeline of its steps (sample steps until owners send real plans).

**Live / Draft**: the President sees Live. Switch to Draft to edit in place: figures, data owner (switching owner switches to their number), dots, dates, step status, blockers and any text. Shaded cells differ from Live. **Publish** sends the draft live. The Live chip in the top bar lists earlier versions; **Restore** makes one live again.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | The whole page. Starting figures are in the `DATA` block near the top of the script. |
| `public/_headers` | Keeps the page out of search engines. |
| `functions/api/[[path]].js` | The server: saves the draft, publishes, runs the AI, sends email. |

## Cloudflare settings (Pages project → Settings)

| Setting | Status | What it does |
|---|---|---|
| KV binding `DASH` → namespace `northpoint-dashboard` | Done | Stores live, draft, contacts and AI results |
| Secret `ANTHROPIC_API_KEY` | To add | Turns on AI issues and AI email drafts |
| Variable `AI_MODEL` (optional) | Default `claude-sonnet-5-5` | Which Claude model to use |
| Variable `ADMIN_EMAILS` | Not set | Who can edit. Only set it together with the email lock below, otherwise nobody can edit |
| Secrets `RESEND_API_KEY` + variable `MAIL_FROM` | Not set | Real email delivery. Without them, sends are logged only |

### Add the AI key
1. Create a key at console.anthropic.com → API keys.
2. Cloudflare → Workers & Pages → `northpoint-dashboard` → Settings → Variables and Secrets → Add → Type **Secret**, name `ANTHROPIC_API_KEY`, paste the key → Save.
3. Push any change or use Deployments → Retry deployment. "Other issues" then shows "Suggested by AI".

### Lock the page to approved emails (later)
Zero Trust → Access → Applications → Add → Self-hosted, domain `northpoint-dashboard-7fd.pages.dev` and `*.northpoint-dashboard-7fd.pages.dev`, policy Allow → Emails. Then set `ADMIN_EMAILS` to the editors' emails and redeploy.
