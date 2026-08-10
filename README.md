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
