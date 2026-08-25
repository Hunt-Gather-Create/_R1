# E1 Google Service Account — Setup Runbook (Option B)

**What this is for:** letting the deployed Runway app read the Google schedule Sheet on its own, with no browser login. E1 (#101) already ships the code that uses this. It just needs the key.

**Who does what:** the steps below are operator clicks in Google Cloud (they touch your account and the Sheet). Handing the key to Runway is Runway-TP's job, done secret-safe. You never paste the key into AI chat.

**When:** only needed before the first real Sheet sync. Not urgent. The code is already merged and works without it (reads are deferred until the key lands).

---

## Why a service account (not the existing google-api login)

The google-api skill logs in as *you*, through a browser consent screen, and caches it in local files. A deployed server has no browser and none of those files. A service account is a Google account for a *program* instead of a person. It carries its own key, so the server can log in by itself. It also does not expire the way a personal login token can, and it is not tied to your identity.

---

## Steps (operator, in Google Cloud Console)

Use the **same Google Cloud project** the google-api skill already uses (its APIs are already turned on). That project is the one whose OAuth client sits in `Civ | Meeting Notes/.credentials.json`.

1. **Open the project.** console.cloud.google.com, top bar, pick the existing project.
2. **Make the service account.** Menu, "IAM & Admin", "Service Accounts", "Create Service Account". Name it something like `runway-sheet-reader`. Skip the optional role grants (it needs no project roles, only Sheet access, which you grant in step 5). Click Done.
3. **Confirm the Sheets API is on.** Menu, "APIs & Services", "Enabled APIs". If "Google Sheets API" is not listed, click "Enable APIs", search Sheets, enable it. (It is likely already on from the skill.)
4. **Make a key.** On the new service account, "Keys" tab, "Add Key", "Create new key", choose **JSON**, Create. A `.json` file downloads. This is the secret. Do not open it in a chat window or paste its contents anywhere public.
5. **Share the Sheet with it.** The service account has an email like `runway-sheet-reader@<project>.iam.gserviceaccount.com` (shown on its page). Open the Soundly schedule Sheet, click Share, paste that email, set **Viewer**, send. No email invite is needed; the robot just gains read access.

That is the whole operator part. Roughly 5 clicks plus one Share.

---

## Handing the key to Runway (Runway-TP does this)

- You tell me the path to the downloaded `.json` (for example, drop it in `~/Downloads`), or move it somewhere and give me the path.
- I read it and store it as the `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable in two places: local `.env.local` (gitignored) and the Vercel project settings for the deployed app. Both are secret-safe. The value is never shown in chat.
- Then I run E1's live read once against the Sheet to prove the whole path works end to end, which closes the deferred piece of #101.

---

## Safety notes

- The `.json` key is a live credential. Treat it like a password. If it ever leaks, delete it in the Keys tab and make a new one; nothing else breaks.
- The account is **read-only** by design (Viewer on the Sheet). It cannot edit the schedule or touch anything else in your Google account.
- This does not replace the google-api skill for laptop work. It is only the server's own key.
