/**
 * Alibaba Cloud Model Studio — HappyHorse video generation client.
 *
 * HappyHorse is an asynchronous image-to-video model. The flow is:
 *   1. POST /video-synthesis  → returns { task_id, task_status }
 *   2. GET  /tasks/{task_id}   → poll until SUCCEEDED or FAILED
 *   3. Download the video_url  → save to R2 (URL expires after 24h)
 *
 * Docs: https://help.aliyun.com/en/model-studio/happyhorse-image-to-video-api-reference
 */

const API_KEY = process.env.ALIBABA_DASHSCOPE_API_KEY;
const WORKSPACE_ID = process.env.ALIBABA_MODELSTUDIO_WORKSPACE_ID;
const REGION = process.env.ALIBABA_MODELSTUDIO_REGION || "ap-southeast-1";

function baseUrl(): string {
  if (!WORKSPACE_ID) {
    // Fall back to the legacy shared domain (US region has no workspace domain)
    if (REGION === "us-east-1") return "https://dashscope-us.aliyuncs.com";
    throw new Error("ALIBABA_MODELSTUDIO_WORKSPACE_ID is not configured");
  }
  return `https://${WORKSPACE_ID}.${REGION}.maas.aliyuncs.com`;
}

export interface AlibabaVideoSubmitParams {
  model: string; // e.g. "happyhorse-1.1-i2v"
  prompt?: string;
  imageUrl: string; // public HTTPS URL of the first-frame image
  resolution?: "720P" | "1080P";
  duration?: number; // 3–15 seconds
}

export interface AlibabaVideoSubmitResult {
  taskId: string;
  taskStatus: string;
}

export interface AlibabaVideoPollResult {
  taskStatus: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  videoUrl?: string;
  error?: string;
}

/** Submit an asynchronous HappyHorse image-to-video task. */
export async function submitAlibabaVideoTask(
  params: AlibabaVideoSubmitParams,
): Promise<AlibabaVideoSubmitResult> {
  if (!API_KEY) throw new Error("ALIBABA_DASHSCOPE_API_KEY is not configured");

  const url = `${baseUrl()}/api/v1/services/aigc/video-generation/video-synthesis`;

  const body = {
    model: params.model,
    input: {
      prompt: params.prompt || "",
      media: [{ type: "first_frame", url: params.imageUrl }],
    },
    parameters: {
      resolution: params.resolution || "720P",
      duration: params.duration || 5,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Alibaba submit failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (!data.output?.task_id) {
    throw new Error(
      `Alibaba submit returned no task_id: ${JSON.stringify(data)}`,
    );
  }

  return {
    taskId: data.output.task_id,
    taskStatus: data.output.task_status || "PENDING",
  };
}

/** Poll an Alibaba task until it reaches a terminal state. */
export async function pollAlibabaVideoTask(
  taskId: string,
): Promise<AlibabaVideoPollResult> {
  if (!API_KEY) throw new Error("ALIBABA_DASHSCOPE_API_KEY is not configured");

  const url = `${baseUrl()}/api/v1/tasks/${taskId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Alibaba poll failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const status = (data.output?.task_status || "UNKNOWN") as AlibabaVideoPollResult["taskStatus"];

  const result: AlibabaVideoPollResult = { taskStatus: status };

  if (status === "SUCCEEDED" && data.output?.video_url) {
    result.videoUrl = data.output.video_url;
  }
  if (status === "FAILED") {
    result.error = data.output?.message || data.output?.code || "Task failed";
  }

  return result;
}

/** Download a video from a URL and return it as a Buffer. */
export async function downloadVideo(videoUrl: string): Promise<Buffer> {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Check if the Alibaba provider is configured. */
export function isAlibabaConfigured(): boolean {
  return !!(API_KEY && WORKSPACE_ID);
}
