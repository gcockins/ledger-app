# Ledger — Personal Finance Dashboard

A private, local-first personal finance app. All data stays in your browser — nothing is ever uploaded to any server.

## Features

- Upload bank & credit card CSVs from any major bank
- Auto-categorizes transactions (Housing, Food, Transport, etc.)
- Custom categories with persistent merchant rules
- Full spending breakdown — totals + monthly averages
- Income tracking by source (W2, side income, interest)
- Budget planning with historical vs. forward view
- Amazon & Walmart order reconciliation
- Export backup to preserve all your work across updates

## Supported Banks

Capital One, Chase, Wells Fargo, Discover, Citi, and most banks that export standard CSV

## How to Use

1. Open the app at your GitHub Pages URL
2. Select your account types and upload CSV files
3. The app auto-categorizes everything — fix any miscategorized charges
4. Click "💾 Backup" before any update to save your work
5. On the next version, click "Restore from Backup" to get everything back

## Privacy

This app runs entirely in your browser. No data ever leaves your device. There is no backend, no database, no analytics.

## Development

```bash
npm install
npm start        # run locally at localhost:3000
npm run deploy   # deploy to GitHub Pages
```
