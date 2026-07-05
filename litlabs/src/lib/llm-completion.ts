export interface CompletionOptions {
  provider: "openrouter" | "bedrock";
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export async function complete(
  options: CompletionOptions,
): Promise<CompletionResult> {
  const { provider } = options;

  if (provider === "openrouter") {
    return completeOpenRouter(options);
  }

  if (provider === "bedrock") {
    return completeBedrock(options);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

async function completeOpenRouter(
  options: CompletionOptions,
): Promise<CompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          {
            role: "user",
            content: options.prompt,
          },
        ],
        max_tokens: options.maxTokens || 512,
        temperature: options.temperature ?? 0.2,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const choice = (
    data?.choices as Array<Record<string, unknown>> | undefined
  )?.[0];
  const message =
    (choice as Record<string, unknown> | undefined)?.message || {};
  const messageRecord = message as Record<string, unknown>;

  return {
    text:
      typeof messageRecord.content === "string" ? messageRecord.content : "",
    usage: data?.usage as CompletionResult["usage"],
  };
}

async function completeBedrock(
  options: CompletionOptions,
): Promise<CompletionResult> {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing AWS credentials for Bedrock");
  }

  const endpoint = encodeURIComponent(options.model);

  // Placeholder Bedrock invoke path - real integration requires SigV4 signing.
  const response = await fetch(
    `https://bedrock-runtime.${region}.amazonaws.com/model/${endpoint}/invoke`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputText: options.prompt,
        textGenerationConfig: {
          maxTokenCount: options.maxTokens || 512,
          temperature: options.temperature ?? 0.2,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bedrock error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  return {
    text: typeof data?.outputText === "string" ? data.outputText : "",
    usage: data?.usage as CompletionResult["usage"],
  };
}
