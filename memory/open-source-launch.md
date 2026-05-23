# Open Source Launch — Research & Decisions

## Project Positioning
This is a **personal financial dashboard** — not just a budgeting/ledger app.
One view showing: bank accounts · spending/income · home loans · property equity · stock portfolio.
Key angles: self-hosted, local-only (no cloud), Australian banks supported out of the box, privacy-first.

---

## Name Research (May 2026)

### ❌ Rejected — conflicts found

| Name | Reason |
|------|--------|
| FinPulse | 6+ active products: Google Play app (updated Apr 2026), finpulse.dev, finpulse.ca, finpulse.online, App Store app, Instagram brand |
| ClearFi | clearfi.app = UK personal finance app (near-identical product!), Broadridge® ClearFi enterprise digital asset platform, clearfi.org, clearfi.net |
| FinDash | Multiple products: findash.app (AI dashboard for entrepreneurs), findash.dev, findash.ai, findash.pro |
| MoneyMap | Multiple products on App Store, Google Play, moneymap.io (CFP advice), credit union tool |
| WealthLens | wealthlens.money — active (monthly financial health reports, direct overlap) |
| FinLens | finlens.app + finlens.ai both active |
| WealthSnap | wealthsnap.io (CRM tool), Android app exists |
| FinSnap | finsnap.net active — "your personal finances in a snap" |
| WealthStation | Taken by FIS financial services |
| FinStation | GitHub org exists |

### ✅ Clean — no conflicts found

| Name | Notes |
|------|-------|
| **FinHQ** | Zero conflicts. Short, punchy. "HQ" = command centre / dashboard. Great for dev/HN crowd. Recommended. |
| **WealthHQ** | Zero conflicts. More descriptive, slightly more premium feel. |
| WealthGlance | Clean brand-wise but .com domain is expensive/squatted. .app/.dev would be ~$15/yr and fine. |
| FinGlance | Only a Devpost hackathon project — not an active product. Low risk. |

### 🏆 DECIDED: FinHQ (May 2026)
- Domain options: finhq.app · finhq.dev · finhq.io · myfinhq.com (~$15–20/yr)
- GitHub: github.com/sanhardik/finhq
- Tagline: "Your financial headquarters — income, expenses, loans, stocks. All in one view."
- Note: Hardik may change name in future — keep WealthHQ as backup option.

---

## Competitor Landscape (aware of, not conflicts)

| Product | URL | Notes |
|---------|-----|-------|
| Wealthfolio | wealthfolio.app | Open-source, offline, privacy-focused. Investments/portfolio only — does NOT do banking/transactions/loans. Similar spirit, different scope. |
| ClearFi (UK) | clearfi.app | Free UK personal finance app — debt, bills, mortgages. Most similar product globally. |
| Firefly III | firefly-iii.org | Popular self-hosted finance manager. More complex, manual entry focused. |
| Actual Budget | actualbudget.org | Open-source budgeting. No Australian bank CSV support. |

---

## Domain Strategy
- .app or .dev is completely fine for an open source project (linear.app, wealthfolio.app set precedent)
- .com.au would reinforce Australian focus, ~$20/yr via VentraIP or Crazy Domains
- Avoid .com for new names — high squatter risk and expensive if premium
- Recommended: finhq.app or finhq.dev

---

## Open Source Launch Plan Status
See task board — 11 of 24 tasks completed (all Claude-autonomous tasks done).
Blocking tasks awaiting Hardik:
- #1 Project name decision (FinHQ or WealthHQ — pending)
- #2 Git history audit
- #3 Domain decision
- #14 Dashboard screenshot/GIF
