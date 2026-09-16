/**
 * Shared DTO types for the LiTTree social feed (Phase 1).
 * Mirrors the backend API contract; components render only these props.
 */

export type FeedTab = "for-you" | "following" | "trending";

export type PostType =
  | "text"
  | "image"
  | "video"
  | "link"
  | "project"
  | "music"
  | "poll";

export type Visibility = "public" | "followers" | "crew" | "private";

export interface PostAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PollOptionDTO {
  id: string;
  text: string;
  votes: number;
}

export interface PollDTO {
  id: string;
  question: string;
  endsAt: string | null; // ISO
  options: PollOptionDTO[];
  viewerVotedOptionId: string | null;
  totalVotes: number;
}

export interface LinkDTO {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

export interface ProjectRefDTO {
  projectId: string | null;
  name: string;
  url: string | null;
}

export interface MusicDTO {
  title: string;
  artist: string | null;
  url: string | null;
}

export interface PostCounts {
  likes: number;
  comments: number;
  reposts: number;
  saves: number;
  shares: number;
}

export interface PostViewerState {
  liked: boolean;
  reaction: string | null;
  reposted: boolean;
  saved: boolean;
}

export interface PostDTO {
  id: string;
  author: PostAuthor;
  content: string;
  postType: PostType;
  visibility: Visibility;
  mediaUrls: string[];
  link: LinkDTO | null;
  poll: PollDTO | null;
  projectRef: ProjectRefDTO | null;
  music: MusicDTO | null;
  counts: PostCounts;
  viewer: PostViewerState;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface CommentAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CommentDTO {
  id: string;
  parentId: string | null;
  author: CommentAuthor;
  content: string;
  likes: number;
  viewerLiked: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  replies: CommentDTO[];
}

export interface StudioProjectSummary {
  id: string;
  name: string;
  slug?: string;
}

export const MAX_CONTENT_LENGTH = 5000;
export const MAX_MEDIA_FILES = 4;
