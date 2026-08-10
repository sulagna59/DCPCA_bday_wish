# DCPCA Birthday Wish Bot

Automatically sends birthday wishes to the DCPCA WhatsApp group every morning via a GitHub Actions workflow.

## How it works

1. The workflow runs daily at **8:00 AM IST** (2:30 AM UTC)
2. It fetches the member list from a Google Sheet and finds today's birthdays
3. For each birthday person it sends a WhatsApp message to the group
   - If **Photo Consent = Yes** and a photo is provided → sends photo + caption
   - Otherwise → sends text only
4. Message templates rotate across 5 variants so wishes don't look repetitive

## Message template rotation

There are 5 templates stored in `bday_wish.js`. The last-used template index is saved in `bday_state.json` and committed back to the repo after each run. The next run picks up from where the last one left off. If multiple birthdays fall on the same day, each person gets a different consecutive template.

## Technical internals

### WhatsApp connection via Baileys

This bot does **not** use the official WhatsApp Business API. Instead it uses [Baileys](https://github.com/WhiskeySockets/Baileys), an open-source library that implements the WhatsApp Web protocol — the same protocol your browser uses when you open web.whatsapp.com.

**How the session works:**

When you run `setup.js` locally for the first time, Baileys opens a WebSocket connection to WhatsApp's servers and asks you to scan a QR code with your phone. Once scanned, WhatsApp issues a set of cryptographic session credentials (keys, tokens, device identity) and saves them to `.baileys_auth/creds.json`. From that point on, the bot can connect as your WhatsApp account without scanning again — as long as the credentials remain valid.

**How `BAILEYS_CREDS` is used:**

GitHub Actions runners are ephemeral — the filesystem is wiped after every run. So the credentials can't just sit in a file. Instead:

1. Before the script runs, the workflow writes the `BAILEYS_CREDS` secret to `.baileys_auth/creds.json`
2. `bday_wish.js` calls `useMultiFileAuthState('.baileys_auth')`, which loads those credentials and uses them to open a WebSocket to WhatsApp
3. WhatsApp may rotate/refresh some of the credential values during the session (`creds.update` event)
4. After the script exits, the workflow reads the (possibly updated) `creds.json` and saves it back into the `BAILEYS_CREDS` secret via `gh secret set`

This cycle ensures credentials stay fresh across runs. If credentials expire (e.g. WhatsApp logs out the device), you'll need to re-run `setup.js` locally and update the secret manually.

**Why `GH_PAT` is needed:**

The default `GITHUB_TOKEN` available to workflows cannot update repository secrets or push commits that trigger other workflows. A Personal Access Token with `repo` scope is required to:
- Call the GitHub API to overwrite `BAILEYS_CREDS` via `gh secret set`
- `git push` the updated `bday_state.json` back to the repo

### Data flow on each run

```
GitHub Actions scheduler (cron)
        │
        ▼
Restore BAILEYS_CREDS → .baileys_auth/creds.json
        │
        ▼
bday_wish.js
  ├─ Fetch Google Sheet (CSV export URL) → parse with xlsx
  ├─ Filter rows where DOB matches today (IST)
  ├─ If no birthdays → exit
  └─ Open WebSocket to WhatsApp via Baileys
        ├─ For each birthday person:
        │    ├─ Pick next template from bday_state.json
        │    ├─ Resolve photo (local / Drive URL / none)
        │    └─ sock.sendMessage(GROUP_ID, { image/text })
        └─ Save updated template index to bday_state.json
        │
        ▼
Save updated creds back to BAILEYS_CREDS secret
Commit bday_state.json back to repo
```

## Repository secrets required

| Secret | Description |
|---|---|
| `BAILEYS_CREDS` | WhatsApp session credentials (JSON). Set this once after running `setup.js` locally. The workflow updates it automatically after each run. |
| `GH_PAT` | Personal Access Token with `repo` scope — used to update `BAILEYS_CREDS` and commit `bday_state.json`. |

## Google Sheet format

The sheet must have these columns:

| Column | Example | Notes |
|---|---|---|
| `Name` | Ravi Kumar | Full name |
| `Membership ID` | DCPCA-042 | Shown in the message |
| `DOB` | 10-Aug | Format: `D-Mon` or `DD-Mon` |
| `Photo Consent` | Yes / No | Case-insensitive |
| `Photo` | _(URL or blank)_ | Google Drive share link or direct image URL |

## First-time setup

1. Clone the repo and install dependencies:
   ```
   npm install
   ```
2. Run the setup script to link your WhatsApp account:
   ```
   node setup.js
   ```
3. Copy the generated `.baileys_auth/creds.json` content into the `BAILEYS_CREDS` GitHub secret.
4. Create a `GH_PAT` secret with a token that has `repo` scope.

## Files

| File | Purpose |
|---|---|
| `bday_wish.js` | Main script — fetches sheet, connects WhatsApp, sends wishes |
| `bday_state.json` | Tracks last template index used (auto-updated by workflow) |
| `.github/workflows/bday.yml` | Daily schedule + manual trigger |
| `.github/workflows/keepalive.yml` | Prevents GitHub from disabling the scheduled workflow |
