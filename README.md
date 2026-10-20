# Communications Committee Elections

A simple, mobile-friendly voting app for church committee elections.

- **Voters** open one link, enter their name and phone number, pick a person for each position, and submit.
- **The organiser** manages nominees, opens and closes voting, and watches live results from a private admin page.
- **Results** are stored in the Google Sheet that holds the nominations, and emailed to the organiser when voting closes.

👉 **To set it up, follow [SETUP.md](SETUP.md).**

## How it fits together

```
 Voter's phone ──► GitHub Pages (docs/)  ──►  Google Apps Script web app  ──►  Google Sheet
                   index.html  (vote)          apps-script/Code.gs             Positions, Nominees,
                   admin.html  (organiser)                                     Votes, Voters, Results…
```

- `docs/` is the static website (plain HTML, CSS and JS; no build step). `docs/config.js` holds the one setting: the Apps Script URL.
- `apps-script/Code.gs` is the backend, pasted into the spreadsheet's Apps Script editor.
- `dev/` is a fake Google environment used by the demo mode and the tests.
- `tests/` contains automated tests for the backend and the name-grouping logic.

## Develop locally

```bash
python3 -m http.server 8000      # then open http://localhost:8000/docs/  (admin passcode: admin)
npm test                         # run the tests (Node 18+)
```

On `localhost`, with no URL in `config.js`, the site runs in **demo mode**. It executes the real `Code.gs` in the browser against a pretend spreadsheet saved in `localStorage`, so you can test the whole flow without a Google account. Add `?mock` to any page URL to force demo mode.
