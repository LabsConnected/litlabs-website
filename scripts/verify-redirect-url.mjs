import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  // Use the exact redirect URL Clerk would produce
  const signInUrl = "https://www.litlabs.net/sign-in?redirect_url=" + encodeURIComponent(
    "https://www.litlabs.net/oauth-consent?client_id=YWeGjVVwoNnX4RTY&code_challenge=test123&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcallback&response_type=code&scope=profile+email+offline_access&state=test123"
  );

  console.log("Opening:", signInUrl.substring(0, 80) + "...");
  await page.goto(signInUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check if the SignIn component picked up the redirect_url
  const clerkState = await page.evaluate(() => {
    const clerk = window.Clerk;
    if (!clerk) return { hasClerk: false };
    return {
      hasClerk: true,
      loaded: clerk.loaded,
      frontendApi: clerk.frontendApi,
      proxyUrl: clerk.proxyUrl,
      domain: clerk.domain,
      isSatellite: clerk.isSatellite,
    };
  });

  console.log("Clerk state:", JSON.stringify(clerkState, null, 2));

  // Check the form action - does it have forceRedirectUrl?
  const formInfo = await page.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) return { hasForm: false };
    // Check for hidden inputs or data attributes
    const inputs = Array.from(form.querySelectorAll("input")).map(i => ({
      name: i.name,
      type: i.type,
      hasValue: !!i.value,
    }));
    return { hasForm: true, action: form.action, method: form.method, inputs };
  });

  console.log("Form info:", JSON.stringify(formInfo, null, 2));

  // Check the page URL to confirm redirect_url is present
  console.log("Current URL:", page.url());

  // Look for the SignIn component's internal state
  const signInProps = await page.evaluate(() => {
    // Clerk stores props on the React fiber
    const clerkDiv = document.querySelector("[class*='clerk']") || document.querySelector("form")?.parentElement;
    if (!clerkDiv) return { found: false };
    return { found: true, className: clerkDiv.className?.substring(0, 100) };
  });

  console.log("SignIn container:", JSON.stringify(signInProps, null, 2));

  await page.screenshot({ path: "test-results/oauth-consent-auth/signin-with-redirect.png" });
  console.log("Screenshot saved");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
