---
name: deploy
description: Deploy the web app to Railway — build, check config, and deploy
---

1. Read deployment config:
   - Check `railway.json` for settings
   - Check `next.config.ts` for build options
   - Ensure Railway service environment variables are set (see `RAILWAY.md`)

2. Run a production build locally to verify:
   ```powershell
   pnpm build
   ```

3. If build succeeds, deploy via Railway:
   - Push to `main` triggers automatic Railway deployment
   - Or manually trigger via Railway dashboard / CLI:
     ```powershell
     railway up
     ```

4. Verify the deployment URL responds with HTTP 200:
   - `https://www.litlabs.net/api/health`

If the build fails, do not deploy. Report the error and suggest fixes.
