`KIS_MAIN` is kept on the existing default file:
- `/Users/seo/KIS/config/kis_devlp.yaml`

Fill only these two new profile files and place them in `/Users/seo/KIS/config`:
- `kis_devlp-isa.yaml`
- `kis_devlp-pension.yaml`

EcoReport now reads them using `authProfile` from [portfolio-sync.json](/Users/seo/Documents/Playground/economy-report/config/portfolio-sync.json):
- `authProfile: "isa"` -> `kis_devlp-isa.yaml`
- `authProfile: "pension"` -> `kis_devlp-pension.yaml`

Minimal workflow:
1. Copy each template in this folder to `/Users/seo/KIS/config/`.
2. Replace the placeholder values with the account-specific app key, secret, HTS ID, account prefix, and product code.
3. Update the 10-digit account numbers in [portfolio-sync.json](/Users/seo/Documents/Playground/economy-report/config/portfolio-sync.json).
4. Run `node scripts/sync-kis-portfolio.js --date 2026-04-14`.
