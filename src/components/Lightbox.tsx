"use client";

import { useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Download, Share2 } from "lucide-react";

interface LightboxProps {
  images: { src: string; alt?: string; caption?: string }[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export default function Lightbox({
  images,
  currentIndex,
  isOpen,
  onClose,
  onNext,
  onPrev,
}: LightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "ArrowLeft") onPrev();
    },
    [isOpen, onClose, onNext, onPrev],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown, isOpen]);

  if (!isOpen || images.length === 0) return null;

  const current = images[currentIndex];

  return (
    <div
      className="fixed inset-0 z-120 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Close"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {/* Prev */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Previous"
        >
          <ChevronLeft className="w-8 h-8 text-white" />
        </button>
      )}

      {/* Next */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Next"
        >
          <ChevronRight className="w-8 h-8 text-white" />
        </button>
      )}

      {/* Image */}
      <div
        className="relative max-w-[90vw] max-h-[80vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.alt || "Gallery image"}
          className="max-w-full max-h-[70vh] object-contain rounded-lg"
        />
        {current.caption && (
          <p className="mt-3 text-sm text-white/80 text-center max-w-xl">
            {current.caption}
          </p>
        )}

        {/* Counter */}
        <div className="mt-2 text-xs text-white/50">
          {currentIndex + 1} / {images.length}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            const a = document.createElement("a");
            a.href = current.src;
            a.download = "litlabs-image.png";
            a.click();
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
        >
          <Download className="w-4 h-4" />
          Download
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(current.src);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
        >
          <Share2 className="w-4 h-4" />
          Copy Link
        </button>
      </div>
    </div>
  );
}
