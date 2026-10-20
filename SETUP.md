# Setup guide

You'll do this **once**. It takes about 20 minutes. When you're done you'll have:

- a **voting link** to share on WhatsApp, e.g. `https://yourname.github.io/church-polls/`
- an **admin page** only you use: the same link + `admin.html`
- **results** live in your Google Sheet, on the admin page, and in your email when voting closes

There are two parts:

- **Part A** connects your Google Sheet (it stores the nominees and the votes).
- **Part B** puts the website on GitHub.

---

## Part A: Connect the Google Sheet

### 1. Open Apps Script from your sheet

1. Open the nominations spreadsheet (the one with the **Form responses 1** tab).
2. In the menu, click **Extensions → Apps Script**. A new tab opens with a code editor.
3. Name the project at the top left, e.g. **Election backend**.

### 2. Paste the code

1. In the editor you'll see a file called **Code.gs** with a few lines in it. Select all of it and delete it.
2. Open [`apps-script/Code.gs`](apps-script/Code.gs) from this project, copy **everything**, and paste it into the editor.
3. Click the **Save** icon 💾 (or press Ctrl/Cmd + S).

### 3. Set your admin passcode

This is the password for the admin page. Choose something only you know (at least 8 characters).

1. On the left edge of the Apps Script editor, click the **⚙️ gear icon (Project Settings)**.
2. Scroll down to **Script Properties** and click **Add script property**.
3. **Property:** `ADMIN_PASSCODE`
   **Value:** your passcode, e.g. `Grace-Media-2026`
4. Click **Save script properties**.

> You don't need to create anything else. The secret used to protect voters' phone numbers (`VOTER_SALT`) is created automatically in the next step.

### 4. Run the setup once

1. Click the **< > Editor** icon on the left to go back to the code.
2. In the toolbar at the top, find the dropdown next to **Debug**, choose **setup**, then click **▶ Run**.
3. Google asks for permission:
   - Click **Review permissions** and choose your Google account.
   - You may see **"Google hasn't verified this app"**. That's normal for your own scripts. Click **Advanced**, then **Go to Election backend (unsafe)**.
   - Click **Allow**.
4. At the bottom you should see **Execution completed**. Go back to your spreadsheet: there are now new tabs (**Positions, Nominees, Settings, Voters, Votes, Codes, Results**). Your **Form responses 1** tab is not changed.

### 5. Publish it as a web app

1. In Apps Script, click the blue **Deploy** button (top right) → **New deployment**.
2. Next to **Select type**, click the ⚙️ gear and choose **Web app**.
3. Fill in:
   - **Description:** `Election`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone** ← important. Don't choose "Anyone with a Google account", or voters would have to sign in.
4. Click **Deploy**. If asked, authorise again as in step 4.
5. Copy the **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfycb…long…/exec` and **must end in `/exec`**.
6. *Check it:* paste that URL into a new browser tab. You should see:
   `{"ok":true,"service":"election-api","message":"The election backend is running."}`

### 6. Put the URL into `config.js`

Open [`docs/config.js`](docs/config.js) and paste the URL between the quotes:

```js
window.ELECTION_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycb…/exec',
};
```

Save the file. That's the only file you ever need to edit.

---

## Part B: Put the website on GitHub

### 7. Upload the project

If Claude is helping you, it can do this step for you. Otherwise:

1. Sign in at [github.com](https://github.com) and click **+ → New repository**.
2. Name it, e.g. `church-polls`. Leave it **Public** (free GitHub Pages needs that; no secrets are in the code). Click **Create repository**.
3. Upload this whole project folder (everything except `node_modules`, if you have it) and commit.

### 8. Turn on GitHub Pages

1. In your repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. **Branch:** `main`, **Folder:** `/docs`. Click **Save**.
4. Wait a minute or two and refresh. GitHub shows **"Your site is live at …"**.

Your links:

| What | Link |
| --- | --- |
| Voting page (share this) | `https://<your-github-name>.github.io/<repo-name>/` |
| Admin page (keep private) | `https://<your-github-name>.github.io/<repo-name>/admin.html` |

---

## Test before sharing ✅

Do this the first time, before sending the link to anyone.

1. ☐ Open the **admin page** and sign in with your passcode.
2. ☐ **Nominees → Import from nominations.** Go through each group:
   - Fix spellings in the name box.
   - Use **Same as …** when a short name (e.g. "Ivy") is the same person as a full name.
   - **Include** or **Reject** each group, then press **Add to ballot**.
3. ☐ Tidy up: reorder names (drag, or use the arrows) and add a photo or short description if you like. Then **Save changes**.
4. ☐ Click **Preview ballot** and go through it like a voter would.
5. ☐ **Settings & sharing → Open**. Then open the voting link on your phone and **cast a test vote**.
6. ☐ **Live results:** check that your test vote shows up. Also check the **Results** tab in the spreadsheet.
7. ☐ **Danger zone → type RESET → Delete all votes** to remove the test vote.
8. ☐ Optional: in **Settings**, set a **closing time**. Voting then closes automatically and the results are emailed to you.
9. ☐ **Settings & sharing → Share on WhatsApp** (or copy the link or QR code) and send it out. 🎉

When voting closes (by the closing time, or when you press **Closed**), you'll get an email with the results.

---

## Changing things later

- **Nominees, title, closing time, open/close:** use the admin page. No code changes are needed.
- **Changed `Code.gs`?** In Apps Script, paste the new code and save. Then go to **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**. Editing the *existing* deployment keeps the **same URL**, so `config.js` doesn't change. (Using "New deployment" instead would give you a new URL.)
- **Changed the website files?** Upload or push them to GitHub again. Pages updates in a minute or two.

## How the voting rules work

- **One vote per person.** By default voters give their name and phone number, and each phone number can vote once. `0712 345 678`, `+254712345678` and `254712345678` all count as the same number. You can switch to **voter codes** (strictest) or **open** (weakest) in Settings.
- **Secret ballot.** The **Voters** tab only stores names and a scrambled version (a "hash") of the phone number, never the number itself. The **Votes** tab stores choices with no name and no time, in a shuffled order, so a vote can't be matched to a person.
- **Keep the spreadsheet private.** The app doesn't need the sheet to be shared with anyone, because the script runs as you. Leave sharing as "Restricted" so the list of who voted stays private.
- **Abstaining** is allowed. "Skip this position" is counted separately as *Skipped*.
- **Ties** are flagged on the results page, in the sheet and in the email.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Voting page says **"This voting page isn't connected yet"** | `docs/config.js` still has an empty `apiUrl`. Paste the `/exec` URL (step 6) and upload again. |
| **"We couldn't reach the voting server"** | In Apps Script, check **Deploy → Manage deployments**: *Who has access* must be **Anyone**. The URL must end in `/exec`, not `/dev`. |
| Admin page says the **passcode has not been set** | Add `ADMIN_PASSCODE` in Project Settings → Script Properties (step 3). |
| **"Too many wrong passcodes"** | Wait 15 minutes, then try again. |
| You changed `Code.gs` but nothing changed | Redeploy with **Manage deployments → Edit → New version** (see above). |
| No results email | Check spam. The email is sent from your own Gmail to yourself. You can also press **Email me the results** on the Live results tab. |
| Photos don't show | The link must start with `https://`. For Google Drive, share the image as **Anyone with the link**. |

## Try it on your computer (optional)

You can try everything without Google using a built-in demo. Open a terminal in this folder and run:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/docs/> (voting page) and <http://localhost:8000/docs/admin.html> (admin, passcode `admin`). Demo data is stored only in your browser.
