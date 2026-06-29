// API Route: Messages for a specific conversation
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateText } from "@/lib/llm";

// GET: Load messages for conversation
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;

    // Verify conversation belongs to user
    const { data: conversation } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      // Supabase error:
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
    // Error fetching messages:
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
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: conversationId } = await params;
    const body = await req.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json({ error: "Missing content" }, { status: 400 });
    }

    // Get conversation with agent details
    const { data: conversation } = await supabase
      .from("conversations")
      .select(
        `
        *,
        agent:agent_id (*)
      `,
      )
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Save user message
    const { data: userMessage, error: msgError } = await supabase
      .from("messages")
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

    // Get recent conversation history
    const { data: recentMessages } = await supabase
      .from("messages")
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

    // Save AI response
    const { data: assistantMessage, error: aiMsgError } = await supabase
      .from("messages")
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
    await supabase
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
