# Setup

## Current status

The Firebase project is **provisioned and deployed**. This section is the live
record of what is done and what still needs you.

| | Status |
|---|---|
| Firebase project `traffic-light-food-tracker` | ✅ created |
| Web app registered, config written to `.env.local` | ✅ done |
| Firestore database | ✅ created (`us-central1`) |
| Firestore security rules | ✅ deployed — **compiled successfully** |
| Composite indexes | ✅ deployed (3) |
| Blaze plan | ✅ upgraded |
| Email/Password + Google sign-in | ✅ enabled |
| `USDA_API_KEY` secret | ✅ stored — **key verified against USDA** |
| Cloud Functions (12) | ✅ deployed and smoke-tested |
| Container cleanup policy | ✅ set (images older than 1 day auto-deleted) |
| Frontend built and hosted | ✅ live |
| **Token-signing IAM grant** | ⬜ **you** — required, see below |
| **First admin claimed** | ⬜ **you** — one click, see below |

**Live URL:** <https://traffic-light-food-tracker.web.app>
**Console:** <https://console.firebase.google.com/project/traffic-light-food-tracker>

### Verified working

- `redeemFamilyCode` with an unknown code returns `404 "That code was not
  recognised."` — and returns the **identical** response for a malformed code,
  so the endpoint leaks nothing about which codes exist.
- `searchFoods` without a session returns `401 "Please sign in first."`
- The USDA key returns real data (`Apples, fuji, with skin, raw`).

Two steps are left.

---

## Grant the token-signing permission

**Required — without this nobody can sign in at all.**

Family code login and "open as" both mint a session with
`createCustomToken()`, which needs the IAM permission
`iam.serviceAccounts.signBlob`. Gen-2 Cloud Functions run as the *compute*
default service account, which does **not** hold that permission by default,
so both paths fail with `INTERNAL [500]` until it is granted.

The Firebase CLI cannot grant IAM roles, so this is a console step.

1. Open **[IAM & Admin → IAM](https://console.cloud.google.com/iam-admin/iam?project=traffic-light-food-tracker)**
2. Find the principal
   **`805690444371-compute@developer.gserviceaccount.com`**
   (tick *Include Google-provided role grants* if it is not listed)
3. Click the ✏️ pencil → **Add another role**
4. Choose **Service Account Token Creator** → **Save**

Give it a minute to propagate, then retry. No redeploy is needed — the grant
takes effect on the running functions.

<details>
<summary>Tighter alternative, if you have gcloud</summary>

Granting at project level lets that account mint tokens for *any* service
account in the project. Scoping the grant to the account itself is tighter:

```bash
gcloud iam service-accounts add-iam-policy-binding   805690444371-compute@developer.gserviceaccount.com   --member="serviceAccount:805690444371-compute@developer.gserviceaccount.com"   --role="roles/iam.serviceAccountTokenCreator"   --project=traffic-light-food-tracker
```

For a single-purpose project with one runtime account the difference is
academic, but it is the correct scope.
</details>

---

## Claim the first administrator

There is no admin account yet, and the app deliberately refuses to invent one.

1. Open <https://traffic-light-food-tracker.web.app>
2. Choose **Coach or admin** → **Continue with Google**
3. You will land on *"This account has no access yet"* — expected, you have an
   identity but no role.
4. Click **Claim this account as administrator**.

That is it. No console snippet needed.

`claimFirstAdmin` refuses to run once any admin exists, so the button is safe to
expose — the server is the gate, not the UI. It is useful exactly once. Every
later admin is added in-app from **Coaches → Add coach → Administrator**.

> If the dashboard does not appear immediately, sign out and back in. Roles live
> in custom claims, which are baked into the ID token at sign-in.

## Then: fill in the program settings

As the admin:

- **Overview → gear icon → Food guide URL** — the link to your searchable food
  guide PDF. This is what the family's **"Help me choose"** button opens; leave
  it blank and the button hides itself rather than opening a dead link.
- **Rules** — review the 22 seeded rules. They reproduce the prototype's
  behaviour exactly. Use **Test a food** before saving any change.

Then add a coach, and have that coach add families. Each family gets a
six-character code — give it to them and they are done. No password.

---

## Local development

```bash
npm run dev          # http://localhost:5173, against the real project
npm run test:rules   # rule-engine parity check
npm run build        # typecheck + production build
```

`.env.local` is already populated and is gitignored. The values in it are **not
secrets** — Firebase web config is public by design; access is governed by
`firestore.rules` and the Cloud Functions.

To work offline against the emulator suite, set `VITE_USE_EMULATORS=true` in
`.env.local` and run `firebase emulators:start`.

> The emulator suite needs **JDK 21 or newer**. This machine currently has
> JDK 17, which current `firebase-tools` refuses. Install a newer JDK if you
> want emulators or want to run Firestore rules unit tests.

---

## Deploy commands

```bash
npm run deploy            # build + deploy everything
npm run deploy:hosting    # site only
npm run deploy:rules      # Firestore rules and indexes only
npm run deploy:functions  # Cloud Functions only
```

To take the site down again: `firebase hosting:disable`.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `INTERNAL [500]` on family code login or "open as" | The token-signing IAM grant above is missing. Confirm with `firebase functions:log --only impersonate` — look for `iam.serviceAccounts.signBlob`. |
| Everyone stuck on "no access yet" | The first admin has not been claimed, or you did not sign out and back in afterwards. |
| Family code always rejected | The `codes` collection is deliberately unreadable by clients, so `redeemFamilyCode` is the only path. Check its logs: `firebase functions:log --only redeemFamilyCode`. |
| Google sign-in popup closes instantly | Google provider disabled, or the domain is missing from **Authentication → Settings → Authorized domains**. |
| Food search returns "temporarily unavailable" [503] | Usually a corrupted secret. Check the exact bytes: `firebase functions:secrets:access USDA_API_KEY \| od -c` — a leading `357 273 277` is a UTF-8 BOM and makes the key invalid. Re-set it from a shell that does not add one (`printf '%s' 'KEY' \| firebase functions:secrets:set USDA_API_KEY`), then redeploy the functions. |
| Food search returns nothing | Check `firebase functions:log --only searchFoods`. The key is stored in Secret Manager; rotate with `firebase functions:secrets:set USDA_API_KEY` then redeploy functions. |
| "query requires an index" | Indexes still building. Check **Firestore → Indexes** for *Enabled*. |
| Coach never receives the invite | Check spam, then **Authentication → Templates**. Use **Resend invite** on the Coaches screen. |
| Camera will not open for scanning | Cameras require HTTPS. The live URL is fine; `localhost` is exempt; a bare LAN IP is not. Typed barcode entry always works. |
| CLI says "Invalid project id" | `.firebaserc` got reset to the placeholder. Run `firebase use traffic-light-food-tracker`. |

---

## Recreating this project from scratch

Should you ever need a clean project, the CLI does most of it:

```bash
firebase projects:create <new-id> --display-name "Traffic Light Food Tracker"
firebase apps:create web "Food Tracker Web" --project <new-id>
firebase apps:sdkconfig WEB <appId> --project <new-id>   # paste into .env.local
firebase use <new-id>
firebase firestore:databases:create "(default)" --location us-central1
firebase deploy
```

Note that `firebase deploy --only firestore` will silently auto-create the
database in the `nam5` multi-region if one does not exist yet, so create it
explicitly first if you want a specific single region. Deleting a database
tombstones the `(default)` id for about five minutes before it can be reused.
