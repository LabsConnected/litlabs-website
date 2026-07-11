"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  Download, 
  Maximize2, 
  Minimize2, 
  RotateCw, 
  FlipHorizontal,
  ArrowLeft,
  ArrowRight,
  Edit3
} from "lucide-react";

interface ImageLightboxProps {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
  allowEdit?: boolean;
}

export default function ImageLightbox({ 
  images, 
  initialIndex = 0, 
  onClose,
  allowEdit = true 
}: ImageLightboxProps) {
  const { resolvedColors: T } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flip, setFlip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const handleZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.max(0.5, Math.min(5, prev + delta)));
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          goToPrevious();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case "+":
        case "=":
          handleZoom(0.25);
          break;
        case "-":
        case "_":
          handleZoom(-0.25);
          break;
        case "r":
        case "R":
          setRotation((prev) => prev + 90);
          break;
        case "f":
        case "F":
          setFlip((prev) => !prev);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, goToPrevious, goToNext, handleZoom]);

  // Reset zoom/position when image changes
  useEffect(() => {
    setZoom(1); // eslint-disable-line react-hooks/set-state-in-effect -- intentional reset on image change
    setPosition({ x: 0, y: 0 });
    setRotation(0);
    setFlip(false);
  }, [currentIndex]);

  const handleZoomReset = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleRotate = () => {
    setRotation((prev) => prev + 90);
  };

  const handleFlip = () => {
    setFlip((prev) => !prev);
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = images[currentIndex];
    link.download = `image-${currentIndex}.png`;
    link.click();
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Mouse drag handling for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Click outside to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const currentImage = images[currentIndex];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.95)" }}
      onClick={handleBackdropClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full transition-all hover:scale-110 z-10"
        style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}
      >
        <X size={24} />
      </button>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); goToPrevious(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full transition-all hover:scale-110 z-10"
            style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}
          >
            <ArrowLeft size={24} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); goToNext(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full transition-all hover:scale-110 z-10"
            style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}
          >
            <ArrowRight size={24} />
          </button>
        </>
      )}

      {/* Image counter */}
      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-bold z-10"
          style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}>
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* Main image */}
      <div 
        className="relative max-w-[90vw] max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          ref={imageRef}
          src={currentImage}
          alt={`Image ${currentIndex + 1}`}
          className="max-w-full max-h-full object-contain cursor-grab active:cursor-grabbing transition-transform"
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg) scaleX(${flip ? -1 : 1}) translate(${position.x}px, ${position.y}px)`,
            transformOrigin: "center center",
          }}
          onMouseDown={handleMouseDown}
          draggable={false}
        />
      </div>

      {/* Toolbar */}
      <div 
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 rounded-2xl z-10"
        style={{ backgroundColor: T.boxBg + "90", border: `1px solid ${T.borderColor}30` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Zoom controls */}
        <button
          onClick={() => handleZoom(-0.25)}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ color: T.textColor }}
          title="Zoom out (-)"
        >
          <ZoomOut size={20} />
        </button>
        <div className="text-sm font-bold w-12 text-center" style={{ color: T.textColor }}>
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => handleZoom(0.25)}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ color: T.textColor }}
          title="Zoom in (+)"
        >
          <ZoomIn size={20} />
        </button>

        <div className="w-px h-6 mx-2" style={{ backgroundColor: T.borderColor + "40" }} />

        {/* Edit controls */}
        {allowEdit && (
          <>
            <button
              onClick={handleRotate}
              className="p-2 rounded-lg transition-all hover:scale-110"
              style={{ color: T.textColor }}
              title="Rotate (R)"
            >
              <RotateCw size={20} />
            </button>
            <button
              onClick={handleFlip}
              className="p-2 rounded-lg transition-all hover:scale-110"
              style={{ color: T.textColor }}
              title="Flip (F)"
            >
              <FlipHorizontal size={20} />
            </button>
            <div className="w-px h-6 mx-2" style={{ backgroundColor: T.borderColor + "40" }} />
          </>
        )}

        {/* Other controls */}
        <button
          onClick={handleZoomReset}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ color: T.textColor }}
          title="Reset zoom"
        >
          <Edit3 size={20} />
        </button>
        <button
          onClick={handleDownload}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ color: T.textColor }}
          title="Download"
        >
          <Download size={20} />
        </button>
        <button
          onClick={handleFullscreen}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ color: T.textColor }}
          title="Fullscreen"
        >
          {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </button>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-xs text-center opacity-50"
        style={{ color: T.textColor }}
        onClick={(e) => e.stopPropagation()}
      >
        ESC: Close | ← →: Navigate | + -: Zoom | R: Rotate | F: Flip
      </div>
    </div>
  );
}
