"use client";

import { useState } from "react";
import ImageLightbox from "./ImageLightbox";

interface ImageViewerProps {
  images: string[];
  children: React.ReactNode;
  initialIndex?: number;
  allowEdit?: boolean;
}

export default function ImageViewer({ 
  images, 
  children, 
  initialIndex = 0,
  allowEdit = true 
}: ImageViewerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div onClick={() => setIsOpen(true)}>
        {children}
      </div>
      {isOpen && (
        <ImageLightbox
          images={images}
          initialIndex={initialIndex}
          onClose={() => setIsOpen(false)}
          allowEdit={allowEdit}
        />
      )}
    </>
  );
}
