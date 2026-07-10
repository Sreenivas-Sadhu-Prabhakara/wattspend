# wattspend

**See what each appliance is actually costing you.** An appliance electricity cost calculator that shows what every appliance costs to run — per month and per year — on *your* electricity rate, then ranks them so the biggest money-drainers come first. 100% client-side, zero dependencies, works fully offline.

![wattspend](./preview.png)

## Why

Most "how much does it cost to run…" calculators online are US-centric, assume a rate you don't pay, and hide their arithmetic behind a single number you're asked to trust. That's no help when you're staring at a peso, rupee, or euro bill and wondering which appliance to actually cut back on.

wattspend is different. You set **your** currency and rate (with indicative presets you can override straight from your bill), and it works out the cost of each appliance from its watts, hours a day, and days a week. The math is shown right on the page — `watts × hours ÷ 1000 = kWh`, times your rate — so you can trust it and adjust it. Then it **ranks by cost**, because the whole point is knowing what to fix first.

## Features

- **Cost per appliance, ranked** — every appliance shown with its cost per month and per year, sorted most-expensive-first, with a bar showing its share of your bill.
- **Your rate, your currency** — presets for the Philippines, USA, India, UK, Eurozone, and Australia, all clearly marked *indicative* and fully editable from your own bill.
- **Realistic defaults** — cycling and always-on appliances use effective wattages, so a fridge lands near ~1.3 kWh/day and a router near ~0.15 kWh/day instead of absurd round-the-clock figures. Edit watts, hours, and days to match yours.
- **Biggest wins** — the top drainers are highlighted with honest, general efficiency notes (warmer thermostat, swap incandescent for LED, air-dry laundry) — no invented savings guarantees.
- **Transparent totals** — a running estimate of your monthly and yearly bill, plus total kWh, updated live as you type.
- **Printable summary** — a clean black-and-white ranked cost sheet with your rate and totals, for sticking on the fridge.
- **100% offline** — no accounts, no network calls, no tracking. Your appliances and rate never leave your device.

## Quickstart

Just open `index.html` in any modern browser — no build step, no server, no install.

- **Local:** double-click `index.html`, or run a static server in the folder.
- **Hosted:** **[Open wattspend live](https://sreenivas-sadhu-prabhakara.github.io/wattspend/)**

Your appliance list, currency, and rate are saved in your browser's local storage, so they persist between visits. A reset control restores the starter set at any time.

## Privacy

wattspend is built to be trustworthy: it can't leak what it can't send.

- A strict Content-Security-Policy sets `connect-src 'none'`: the app **cannot** make any network request, even if it tried.
- No external fonts, scripts, images, or analytics. Everything is self-contained.
- All logic runs in your browser. Your appliances and rate are stored only in your own browser's local storage and are never transmitted anywhere.
- Because there are no network dependencies, it works with no signal at all — load it once and it keeps working offline.

## Disclaimer

wattspend produces **estimates only**. Figures are based on your inputs and typical appliance wattages, and are meant to help you compare appliances and prioritise savings — they are not a metered reading or a substitute for a professional energy audit. Real costs vary with the specific appliance, its age and condition, ambient conditions, tariff structure (tiered or time-of-use pricing), and taxes and fixed charges on your bill. For precise figures, read your meter or consult a qualified electrician or energy assessor. This software is provided under the MIT License, "as is", without warranty of any kind; the authors accept no liability for any loss or damage arising from its use.

## License

[MIT](./LICENSE) © 2026 Sreenivas Sadhu Prabhakara
