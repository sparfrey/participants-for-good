# Participants for Good

**Research that gives back.** A nonprofit participant network: every research session pays
the participant and sends money to the charity or nonprofit they choose.

Live at **[participantsforgood.org](https://participantsforgood.org)**.

## What's here

Static site, no build step — edit and push, GitHub Pages redeploys in about a minute.

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `participants.html`, `nonprofits.html`, `researchers.html` | Audience pages |
| `app/` | **Platform prototype — demo data only.** Participant, researcher, nonprofit, and admin experiences, plus template terms of service. Nothing is functional; numbers illustrate the model. |
| `styles.css`, `script.js`, `logo.svg` | Shared assets (bump the `?v=` params in the HTML when editing CSS/JS, or browsers serve stale caches) |

## Temporary demo affordances — remove before public launch

- **"Platform preview →" button in every footer** links straight into the `app/`
  prototype. It exists so the concept can be demoed end-to-end from one URL. Remove the
  link (marked with `TEMP` comments in each HTML footer and in `styles.css`) once real
  signups open.
- The prototype's demo data (Maya, Riverside Youth Alliance, all dollar figures) is
  illustrative and labeled as such in the UI.
- Signup forms are mailto placeholders to hello@participantsforgood.org.
