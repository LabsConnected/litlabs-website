---
description: Deploy the web app to Vercel — build, check config, and deploy
---

1. Read deployment config:
   - Check `vercel.json` for settings
   - Check `next.config.ts` for build options
   - Ensure `.env.local` has all required secrets

2. Run a production build locally to verify:
   ```powershell
   pnpm build
   ```

3. If build succeeds, deploy:
   ```powershell
   npx vercel --prod
   ```

4. Verify the deployment URL responds with HTTP 200.

If the build fails, do not deploy. Report the error and suggest fixes.
