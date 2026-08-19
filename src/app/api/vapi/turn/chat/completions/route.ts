/**
 * /api/vapi/turn/chat/completions
 *
 * Vapi's Custom LLM uses the OpenAI SDK, which appends `/chat/completions`
 * to the configured `model.url`. So if `model.url` is set to
 * `https://litlabs.net/api/vapi/turn`, Vapi actually sends POST requests
 * to `https://litlabs.net/api/vapi/turn/chat/completions`.
 *
 * This route mirrors the handler + segment config from the parent
 * /api/vapi/turn route so both paths work. The parent route handles the
 * actual logic.
 *
 * NOTE: Next.js requires route segment config (runtime/dynamic/maxDuration/
 * fetchCache) to be statically defined in each route file — it cannot be
 * re-exported. So we duplicate the config here and import POST as a value.
 */
import { POST } from "../../route";

export { POST };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
