# GitHub Discussions — Setup Guide

This file is for the maintainer. Follow these steps once after making the repo public.

---

## Enable Discussions

1. Go to your repo → **Settings** → scroll to **Features**
2. Check **Discussions**
3. Click **Save**

---

## Create Categories

Go to **Discussions** → **Edit categories** (pencil icon next to "Categories").

Create these five categories:

| Category | Format | Description | Who can post |
|----------|--------|-------------|--------------|
| 📣 Announcements | Announcement | Release notes, important updates | Maintainer only |
| 🙋 Q&A | Question / Answer | Help with setup, troubleshooting, how-to questions | Everyone |
| 💡 Ideas | Open-ended discussion | Feature suggestions before they become formal issues | Everyone |
| 🏦 Bank Requests | Open-ended discussion | Discuss adding a new bank before opening an issue | Everyone |
| 🎉 Show & Tell | Open-ended discussion | Share your setup, screenshots, customisations | Everyone |

**For Announcements:** Set "Who can post" to **Maintainers only**. This keeps the announcements feed clean.

---

## Pin a Welcome Discussion

After enabling Discussions, create and pin a welcome post in the **Q&A** category:

---

**Title:** 👋 Welcome to the Community — Read Before Posting

**Body:**

```
Welcome to the Personal Finance Manager community!

This is the place to ask questions, share ideas, and show off how you're using the app.

## Where to go

| I want to... | Go here |
|---|---|
| Ask for help setting up | Q&A |
| Report a bug | [Open an Issue](../issues/new/choose) |
| Request a new feature | Ideas (discuss first) or [Feature Request issue](../issues/new/choose) |
| Request a new bank | Bank Requests |
| Share my setup | Show & Tell |

## Before asking in Q&A

1. Check the [README](../blob/main/README.md) — installation and setup is covered there
2. Check [existing Q&A discussions](../discussions/categories/q-a) — your question may already be answered
3. Check [open and closed issues](../issues?q=is:issue) for bug reports

## Adding a new bank

If you'd like to add support for a bank, start a thread in **Bank Requests** with:
- Bank name
- An anonymised sample CSV (replace all personal data with fake values)
- Any notes on the format

If you'd like to write the parser yourself, read the [Adding a Bank guide](../blob/main/docs/adding-a-bank.md).

---

Happy budgeting! 🎉
```

---

After creating the post, **pin it** using the three-dot menu → **Pin discussion**.

---

## Create a Bank Request Template Pinned Post

Pin a second post in **Bank Requests**:

---

**Title:** 📋 How to Request a New Bank — Template Inside

**Body:**

```
Use this template when requesting support for a new bank. The more detail you provide, the faster a contributor can build the parser.

---

**Bank name:** e.g. Commonwealth Bank of Australia (CBA)

**Country:** Australia

**Account type:** e.g. Everyday account / Credit card / Home loan

**Anonymised CSV sample** (first 5–10 rows including the header row — replace all personal data with fake values):

Date,Amount,Account Number,Description,Balance
01/05/2026,-42.50,XXXXXXXXX,GROCERY STORE,1234.56
02/05/2026,3000.00,XXXXXXXXX,SALARY PAYMENT,4234.56

**Date format:** e.g. DD/MM/YYYY

**Notes:** Any quirks, multiple account types in one file, metadata rows before the header, etc.

**Would you like to write the parser yourself?** Yes / No
```

---

## That's it

The five categories + two pinned posts give the community a clear structure from day one. Keep Announcements for release notes and major updates only — don't post there for minor things or the signal is lost.
