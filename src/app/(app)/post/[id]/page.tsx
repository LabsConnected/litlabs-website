import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { apiFetch } from "@/lib/social-server";
import type { PostDTO } from "@/components/feed/types";
import PostThreadClient from "./PostThreadClient";

async function getPost(id: string): Promise<PostDTO | null> {
  let res: Response;
  try {
    res = await apiFetch(`/api/posts/${encodeURIComponent(id)}`);
  } catch {
    throw new Error("Could not reach the post service. Please try again.");
  }
  // 401/403 mean the post exists but isn't visible to this viewer —
  // treat as not found rather than leaking its existence.
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Post service returned ${res.status}. Please try again.`);
  }
  const data = (await res.json().catch(() => null)) as {
    post?: PostDTO;
  } | null;
  const post = data?.post ?? null;
  return post && typeof post.id === "string" ? post : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getPost(id).catch(() => null);
  if (!post) {
    return { title: "Post not found | LiTTree" };
  }
  const authorName =
    post.author.displayName || `@${post.author.username}` || "LiTTree";
  const excerpt = post.content
    ? post.content.slice(0, 160)
    : "View this post on LiTTree";
  return {
    title: `${authorName} on LiTTree`,
    description: excerpt,
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-3 pb-28">
      <PostThreadClient post={post} />
    </div>
  );
}
