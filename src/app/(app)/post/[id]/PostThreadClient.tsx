"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { PostCard } from "@/components/feed/PostCard";
import { CommentThread } from "@/components/feed/CommentThread";
import type { PostDTO } from "@/components/feed/types";

/**
 * Client wrapper for the dedicated post/thread route. Owns the live post
 * state so reactions/edits update in place; deleting the post sends the
 * viewer back to Discover.
 */
export default function PostThreadClient({ post: initial }: { post: PostDTO }) {
  const router = useRouter();
  const { tokens } = useTheme();
  const [post, setPost] = useState<PostDTO>(initial);

  return (
    <div className="min-w-0">
      <Link
        href="/discover"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold"
        style={{ color: tokens.textMuted }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Discover
      </Link>

      <div className="mt-1 min-w-0">
        <PostCard
          post={post}
          onUpdate={setPost}
          onDelete={() => router.push("/discover")}
        />
      </div>

      <div className="mt-3 min-w-0">
        <CommentThread
          postId={post.id}
          initialCount={post.counts.comments}
          expanded
          onCountChange={(n) =>
            setPost((p) => ({ ...p, counts: { ...p.counts, comments: n } }))
          }
        />
      </div>
    </div>
  );
}
