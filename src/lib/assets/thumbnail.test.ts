import { describe, expect, it } from "vitest";
import { mediaThumbnailSrc, MEDIA_THUMB_WIDTH, MEDIA_THUMB_QUALITY } from "./thumbnail";

const optimizer = (source: string, width = MEDIA_THUMB_WIDTH) =>
  `/_next/image?url=${encodeURIComponent(source)}&w=${width}&q=${MEDIA_THUMB_QUALITY}`;

describe("mediaThumbnailSrc", () => {
  it("prefers a real thumbnailUrl when the asset carries one", () => {
    expect(
      mediaThumbnailSrc({
        url: "https://xyz.supabase.co/storage/v1/object/public/studio-images/a.png",
        thumbnailUrl: "https://xyz.supabase.co/storage/v1/object/public/studio-images/a-thumb.png",
      }),
    ).toBe("https://xyz.supabase.co/storage/v1/object/public/studio-images/a-thumb.png");
  });

  it("routes Supabase storage originals through the optimizer", () => {
    const url = "https://rokbfvuoqildggnhappy.supabase.co/storage/v1/object/public/studio-images/u/lion.png";
    expect(mediaThumbnailSrc({ url })).toBe(optimizer(url));
  });

  it("routes default R2 public URLs (r2.dev) through the optimizer", () => {
    const url = "https://bucket.abc123.r2.dev/user/image.png";
    expect(mediaThumbnailSrc({ url })).toBe(optimizer(url));
  });

  it("routes Pollinations URLs through the optimizer", () => {
    const url = "https://image.pollinations.ai/prompt/a%20lion";
    expect(mediaThumbnailSrc({ url })).toBe(optimizer(url));
  });

  it("routes local paths through the optimizer", () => {
    expect(mediaThumbnailSrc({ url: "/assets/images/bike.png" })).toBe(
      optimizer("/assets/images/bike.png"),
    );
  });

  it("passes unconfigured hosts through unchanged (optimizer would 400)", () => {
    const url = "https://cdn.example-cdn.com/some/image.png";
    expect(mediaThumbnailSrc({ url })).toBe(url);
  });

  it("passes data: URLs through unchanged", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    expect(mediaThumbnailSrc({ url })).toBe(url);
  });

  it("passes blob: URLs through unchanged", () => {
    const url = "blob:https://www.litlabs.net/6f2b1d3a";
    expect(mediaThumbnailSrc({ url })).toBe(url);
  });

  it("honors a custom width", () => {
    const url = "https://xyz.supabase.co/storage/v1/object/public/studio-images/a.png";
    expect(mediaThumbnailSrc({ url }, 256)).toBe(optimizer(url, 256));
  });

  it("returns an empty url unchanged", () => {
    expect(mediaThumbnailSrc({ url: "" })).toBe("");
  });
});
