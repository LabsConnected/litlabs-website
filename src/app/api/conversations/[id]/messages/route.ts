// API Route: Messages for a specific conversation
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateText } from "@/lib/llm";

async function getUserId() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return user?.id ?? null;
}

// GET: Load messages for conversation
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const dbUserId = await getUserId();
    if (!dbUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;

    // Verify conversation belongs to user
    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", dbUserId)
      .single();

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Schema defines this table as `conversation_messages` (see supabase/schema.sql)
    const { data: messages, error } = await supabaseAdmin
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      messages: messages || [],
      conversation,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
}

// POST: Send message and get AI response
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const dbUserId = await getUserId();
    if (!dbUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;
    const body = await req.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json({ error: "Missing content" }, { status: 400 });
    }

    // Get conversation with agent details
    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select(
        `
        *,
        agent:agent_id (*)
      `,
      )
      .eq("id", conversationId)
      .eq("user_id", dbUserId)
      .single();

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Save user message (table is `conversation_messages` per schema)
    const { data: userMessage, error: msgError } = await supabaseAdmin
      .from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content,
      })
      .select()
      .single();

    if (msgError) {
      // Error saving message:
    }

    // Get recent conversation history (`conversation_messages` per schema)
    const { data: recentMessages } = await supabaseAdmin
      .from("conversation_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    // Build prompt for AI
    const agent = conversation.agent;
    const history = recentMessages
      ?.reverse()
      .map((m) => `${m.role === "user" ? "User" : agent.name}: ${m.content}`)
      .join("\n");

    const prompt = `${agent.system_prompt}

Personality: ${agent.personality}
Role: ${agent.role}

Conversation history:
${history}

User: ${content}

Respond as ${agent.name} in character. Be helpful, concise (1-3 sentences), and stay true to your personality.`;

    // Generate AI response via unified LLM client (auto-failover)
    let aiResponse = "I'm processing your request...";
    try {
      const r = await generateText(prompt, { task: "chat", maxTokens: 1024 });
      aiResponse = r.text || "I'm thinking...";
    } catch {
      // AI error:
      aiResponse = `${agent.name} is temporarily unavailable. Please try again.`;
    }

    // Save AI response (`conversation_messages` per schema)
    const { data: assistantMessage, error: aiMsgError } = await supabaseAdmin
      .from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: aiResponse,
      })
      .select()
      .single();

    if (aiMsgError) {
      // Error saving AI message:
    }

    // Update conversation timestamp
    await supabaseAdmin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    return NextResponse.json({
      userMessage: userMessage || { role: "user", content },
      assistantMessage: assistantMessage || {
        role: "assistant",
        content: aiResponse,
      },
    });
  } catch {
    // Error in chat:
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}
