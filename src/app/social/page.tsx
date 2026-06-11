'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useTheme } from '@/context/ThemeContext';
import Link from 'next/link';

type Post = {
  id: string;
  user_id: string;
  content: string;
  media_urls: string[];
  likes_count: number;
  comments_count: number;
  is_ai_post: boolean;
  created_at: string;
  author?: { name: string; username: string; avatar_url: string };
};

type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author?: { name: string; username: string; avatar_url: string };
};

export default function SocialPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { resolvedColors: T } = useTheme();
  const [posts, setPosts] = useState<Post[]>([]);
  const [postContent, setPostContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [crtEnabled, setCrtEnabled] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  // Fetch posts from API
  const fetchPosts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/posts');
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      showToast('Failed to load feed. Try refreshing.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Load CRT setting + fetch posts
  useEffect(() => {
    const val = localStorage.getItem('crt_global_scanlines');
    if (val !== null) setCrtEnabled(val === 'true');
    fetchPosts();

    // Poll for new posts every 10 seconds
    const interval = setInterval(fetchPosts, 10000);
    return () => clearInterval(interval);
  }, [isSignedIn]);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const createPost = async () => {
    if (!postContent.trim() || posting) return;

    setPosting(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: postContent.trim(),
          media_urls: [],
        }),
      });

      if (res.ok) {
        setPostContent('');
        showToast('✅ Post published!', 'success');
        // Refresh feed
        await fetchPosts();
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to post', 'error');
      }
    } catch {
      showToast('Network error. Try again.', 'error');
    } finally {
      setPosting(false);
    }
  };

  const likePost = async (postId: string) => {
    if (likedPosts.has(postId)) return;

    try {
      const res = await fetch(`/api/posts/${postId}/like`, { method: 'POST' });
      if (res.ok) {
        setLikedPosts(prev => new Set([...prev, postId]));
        setPosts(prev =>
          prev.map(p =>
            p.id === postId ? { ...p, likes_count: p.likes_count + 1 } : p
          )
        );
      }
    } catch {
      // silently fail
    }
  };

  const toggleComments = (postId: string) => {
    setExpandedComments(prev => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const addComment = async (postId: string) => {
    const text = commentText[postId]?.trim();
    if (!text) return;

    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });

      if (res.ok) {
        setCommentText(prev => ({ ...prev, [postId]: '' }));
        showToast('✅ Comment posted!', 'success');
        // Refresh posts to get new comment
        await fetchPosts();
      }
    } catch {
      showToast('Failed to post comment', 'error');
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (!isLoaded) {
    return (
      <div style={{ backgroundColor: T?.bgColor || '#0a0a0f', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T?.textColor || '#00ff41', fontFamily: 'monospace' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>⏳</div>
          <div>Loading social feed...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div style={{ backgroundColor: T.bgColor, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textColor, fontFamily: 'monospace' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '16px' }}>🔒 Sign in to access the feed</div>
          <Link href="/sign-in" style={{ color: T.linkColor, textDecoration: 'underline' }}>Sign In</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: T.bgColor, minHeight: '100vh', color: T.textColor, fontFamily: 'monospace', position: 'relative' }}>
      {/* CRT Scanline Filter */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 200, padding: '12px 20px', backgroundColor: toast.type === 'success' ? '#0a2e0a' : toast.type === 'error' ? '#2e0a0a' : '#0a1a2e', border: '2px solid ' + (toast.type === 'success' ? T.accentColor : toast.type === 'error' ? '#ff4444' : T.linkColor), color: toast.type === 'success' ? T.accentColor : toast.type === 'error' ? '#ff4444' : T.linkColor, fontSize: '12px', fontWeight: 'bold', maxWidth: '320px' }}>
          {toast.msg}
        </div>
      )}

      <div ref={feedRef} style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
        {/* Header */}
        <div style={{ borderBottom: '2px solid ' + T.borderColor, paddingBottom: '20px', marginBottom: '24px' }}>
          <h1 style={{ color: T.headerColor, fontSize: '28px', fontWeight: 'bold', letterSpacing: '2px', margin: '0 0 4px 0' }}>🌐 SOCIAL FEED</h1>
          <p style={{ color: T.textColor, fontSize: '12px', opacity: 0.7, margin: 0 }}>Share your AI agent wins and connect with the community</p>
        </div>

        {/* Compose Post */}
        {isSignedIn && (
          <div style={{ marginBottom: '24px', padding: '16px', border: '2px solid ' + T.borderColor, backgroundColor: T.boxBg }}>
            <textarea
              placeholder="What's your AI agent story? 💭"
              value={postContent}
              onChange={e => setPostContent(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: T.bgColor,
                border: '1px solid ' + T.borderColor,
                color: T.textColor,
                fontFamily: 'monospace',
                fontSize: '13px',
                borderRadius: '6px',
                minHeight: '100px',
                outline: 'none',
                resize: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={createPost}
                disabled={!postContent.trim() || posting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: postContent.trim() && !posting ? T.accentColor : '#333',
                  color: postContent.trim() && !posting ? 'black' : '#666',
                  border: 'none',
                  fontWeight: 'bold',
                  fontSize: '12px',
                  cursor: postContent.trim() && !posting ? 'pointer' : 'not-allowed',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                }}
              >
                {posting ? '⏳ Posting...' : '📤 Post'}
              </button>
            </div>
          </div>
        )}

        {/* Posts Feed */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: T.textColor, opacity: 0.5 }}>
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>⏳</div>
            <div>Loading posts...</div>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: T.textColor, opacity: 0.5 }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>No posts yet</div>
            <div style={{ fontSize: '12px' }}>Be the first to share your AI agent story!</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {posts.map(post => (
              <div key={post.id} style={{ border: '1px solid ' + T.borderColor, backgroundColor: T.boxBg, padding: '16px', borderRadius: '8px' }}>
                {/* Author */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '32px' }}>{post.author?.avatar_url || '👤'}</div>
                  <div>
                    <div style={{ color: T.headerColor, fontWeight: 'bold', fontSize: '13px' }}>{post.author?.name || 'Anonymous'}</div>
                    <div style={{ color: T.textColor, fontSize: '11px', opacity: 0.6 }}>@{post.author?.username || 'user'} · {formatTime(post.created_at)}</div>
                  </div>
                </div>

                {/* Content */}
                <p style={{ color: T.textColor, fontSize: '13px', lineHeight: 1.6, margin: '12px 0', whiteSpace: 'pre-wrap' }}>{post.content}</p>

                {/* Media */}
                {post.media_urls.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                    {post.media_urls.map((url, i) => (
                      <img key={i} src={url} alt="post media" style={{ borderRadius: '6px', maxWidth: '100%', maxHeight: '300px', objectFit: 'cover' }} />
                    ))}
                  </div>
                )}

                {/* Stats & Actions */}
                <div style={{ display: 'flex', gap: '16px', paddingTop: '12px', borderTop: '1px solid ' + T.borderColor, color: T.textColor, fontSize: '11px', opacity: 0.7 }}>
                  <span>❤️ {post.likes_count}</span>
                  <span>💬 {post.comments_count}</span>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid ' + T.borderColor }}>
                  <button
                    onClick={() => likePost(post.id)}
                    disabled={likedPosts.has(post.id)}
                    style={{
                      flex: 1,
                      padding: '6px',
                      backgroundColor: likedPosts.has(post.id) ? 'rgba(255, 0, 0, 0.2)' : 'transparent',
                      color: likedPosts.has(post.id) ? '#ff4444' : T.textColor,
                      border: '1px solid ' + (likedPosts.has(post.id) ? '#ff4444' : T.borderColor),
                      fontSize: '11px',
                      cursor: likedPosts.has(post.id) ? 'default' : 'pointer',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {likedPosts.has(post.id) ? '❤️ Liked' : '🤍 Like'}
                  </button>
                  <button
                    onClick={() => toggleComments(post.id)}
                    style={{
                      flex: 1,
                      padding: '6px',
                      backgroundColor: expandedComments.has(post.id) ? 'rgba(0, 255, 255, 0.2)' : 'transparent',
                      color: expandedComments.has(post.id) ? T.accentColor : T.textColor,
                      border: '1px solid ' + (expandedComments.has(post.id) ? T.accentColor : T.borderColor),
                      fontSize: '11px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                    }}
                  >
                    💬 Comment
                  </button>
                </div>

                {/* Comments Section */}
                {expandedComments.has(post.id) && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid ' + T.borderColor }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <input
                        type="text"
                        placeholder="Add a comment..."
                        value={commentText[post.id] || ''}
                        onChange={e => setCommentText(prev => ({ ...prev, [post.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            addComment(post.id);
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '8px',
                          backgroundColor: T.bgColor,
                          border: '1px solid ' + T.borderColor,
                          color: T.textColor,
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          borderRadius: '4px',
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => addComment(post.id)}
                        disabled={!commentText[post.id]?.trim()}
                        style={{
                          padding: '8px 12px',
                          backgroundColor: commentText[post.id]?.trim() ? T.linkColor : '#333',
                          color: commentText[post.id]?.trim() ? 'white' : '#666',
                          border: 'none',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          cursor: commentText[post.id]?.trim() ? 'pointer' : 'not-allowed',
                          borderRadius: '4px',
                          fontFamily: 'monospace',
                        }}
                      >
                        Post
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
