# NorthPoint President's Dashboard

Live at **https://northpoint-dashboard-7fd.pages.dev** (Cloudflare Pages, deploys automatically on every push to `main`).

## Access

The whole site (page and API) is password protected: anyone with the link and the password can open it. The default password is set in `functions/_middleware.js`; to change it without code, add a variable `SITE_PASSWORD` in Cloudflare (Settings → Variables and Secrets) and redeploy. Visiting `/__logout` signs out.

## What the page does

- **Data submissions** (top): every data point with its owner, source, last update, status against the cut-off date (Submitted, Late, Not submitted), reporting-quality dot and a Follow up button.
- **On Track**: what's going well, with the risk and next step. Click it to highlight and jump to the linked rows.

- **Escalations to the President**: three cards. Click one to dim the page, jump to and highlight the linked rows, and pop up the numbered call-outs. Each card has a **Follow up** button that opens an email draft (written by AI when connected).
- **Other issues**: a collapsible list of further issues in the same Issue / Impact / Next step format, leaving out what the escalations cover. With an AI key it's written by AI from the current figures and refreshes when the data changes; without one it uses rule-based checks. Each issue has its own Follow up button.
- **1 Commercial**: Recognized revenue (collapsible) and Bookings & pipeline with a period selector, deal value and weight inputs next to each deal (a what-if in Live, saved in Draft), variance vs plan for actual and forecast, separate data owner and data source. Data points with two owners show as two rows, the unreliable one in red.
- **2 Cost**: Platform cloud run-rate per month and cost per active account.
- **3 Operations**: projects plus engineering hires, with owner, last updated, deadline, status, one key blocker tagged by type, a Follow up button and a timeline of steps.

A white dotted dot means an input is missing; a dash means a calculation has nothing to show.

**Suggested text in Draft**: when figures change in Draft, the card text (On Track, escalations, project key blockers) is rewritten to match: by AI when the key is set, otherwise worked out from the figures. Text you edit yourself is kept; "Use suggested text" switches it back.

**Period style rule**: quarters are always written Q3/26 and ranges Q4/26-Q1/27. Other spellings (Q3 2026, Q3-2026, Q4 2026–Q1 2027, Q426-Q127, Q4 FY26, a bare Q3 for the current quarter…) are corrected when you leave an edited field, on publish (server side), in AI text and in emails.

**Live / Draft**: the President sees Live. Switch to Draft to edit in place: figures, data owner (switching owner switches to their number), dots, dates, step status, blockers and any text. Shaded cells differ from Live. **Publish** sends the draft live. The Live chip in the top bar lists earlier versions; **Restore** makes one live again.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | The whole page. Starting figures are in the `DATA` block near the top of the script. |
| `public/_headers` | Keeps the page out of search engines. |
| `functions/api/[[path]].js` | The server: saves the draft, publishes, runs the AI, sends email. |
| `functions/_middleware.js` | The password gate. |

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
