import { auth } from "@/lib/auth";
import PublicShowcaseGallery from "./PublicShowcaseGallery";
import ShowcaseSignedIn from "./ShowcaseSignedIn";

/**
 * Showcase index — server-rendered.
 *
 * Signed-out visitors get the public demo gallery (static content, no
 * data fetching) rendered into the initial HTML, so it paints immediately
 * instead of waiting for the client JS bundle + Clerk browser SDK to
 * download and initialize. Signed-in users get the full app-shell
 * showcase experience. The auth check runs server-side via the session
 * cookie — there is no client-side "Loading showcase..." gate anymore.
 */
export default async function ShowcasePage() {
  const { userId } = await auth();

  // "anonymous-dev" is the local-dev stand-in from @/lib/auth, not a real
  // Clerk session — those visitors get the same public gallery a
  // signed-out visitor sees.
  const signedIn = !!userId && userId !== "anonymous-dev";

  if (!signedIn) {
    return <PublicShowcaseGallery />;
  }

  return <ShowcaseSignedIn />;
}
