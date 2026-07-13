"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  FolderOpen,
  Image,
  FileText,
  Layers,
  Star,
  Search,
  Plus,
} from "lucide-react";

interface Asset {
  id: string;
  name: string;
  type: "image" | "text" | "shape" | "scene" | "template";
  thumbnail?: string;
  url?: string;
  content?: string;
  tags?: string[];
  favorite?: boolean;
  createdAt: Date;
}

interface AssetLibraryProps {
  onAssetSelect?: (asset: Asset) => void;
  onAssetAdd?: (asset: Asset) => void;
}

export default function AssetLibrary({ onAssetSelect }: AssetLibraryProps) {
  const { resolvedColors: T } = useTheme();
  const [assets, setAssets] = useState<Asset[]>([
    {
      id: "1",
      name: "Hero Banner",
      type: "template",
      favorite: true,
      createdAt: new Date(),
    },
    { id: "2", name: "Product Card", type: "template", createdAt: new Date() },
    {
      id: "3",
      name: "Logo v1",
      type: "image",
      favorite: true,
      createdAt: new Date(),
    },
    { id: "4", name: "Headline Text", type: "text", createdAt: new Date() },
    { id: "5", name: "Button Style", type: "shape", createdAt: new Date() },
  ]);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);

  const filteredAssets = assets.filter((asset) => {
    const matchesType = filterType === "all" || asset.type === filterType;
    const matchesSearch = asset.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesFavorite = !showFavorites || asset.favorite;
    return matchesType && matchesSearch && matchesFavorite;
  });

  const getAssetIcon = (type: Asset["type"]) => {
    switch (type) {
      case "image":
        // eslint-disable-next-line jsx-a11y/alt-text
        return <Image size={16} />;
      case "text":
        return <FileText size={16} />;
      case "shape":
        return <Layers size={16} />;
      case "scene":
        return <FolderOpen size={16} />;
      case "template":
        return <Star size={16} />;
      default:
        return <FileText size={16} />;
    }
  };

  const toggleFavorite = (id: string) => {
    setAssets(
      assets.map((asset) =>
        asset.id === id ? { ...asset, favorite: !asset.favorite } : asset,
      ),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen size={18} style={{ color: T.accentColor }} />
          <span className="text-sm font-bold" style={{ color: T.textColor }}>
            Asset Library
          </span>
        </div>
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold transition-all hover:scale-105"
          style={{
            backgroundColor: T.accentColor + "15",
            color: T.accentColor,
            border: "1px solid " + T.accentColor + "30",
          }}
        >
          <Plus size={10} />
          Add
        </button>
      </div>

      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{
          backgroundColor: T.bgColor + "40",
          border: "1px solid " + T.borderColor + "30",
        }}
      >
        <Search size={12} style={{ color: T.textMuted }} />
        <input
          type="text"
          placeholder="Search assets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent outline-none text-xs"
          style={{ color: T.textColor }}
        />
      </div>

      <div className="flex items-center gap-2">
        {["all", "template", "image", "text", "shape", "scene"].map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className="px-2 py-1 rounded text-[10px] font-bold transition-all hover:scale-105 capitalize"
            style={{
              backgroundColor:
                filterType === type ? T.accentColor + "15" : "transparent",
              color: filterType === type ? T.accentColor : T.textMuted,
              border:
                filterType === type
                  ? "1px solid " + T.accentColor + "30"
                  : "transparent",
            }}
          >
            {type}
          </button>
        ))}
        <button
          onClick={() => setShowFavorites(!showFavorites)}
          className="px-2 py-1 rounded text-[10px] font-bold transition-all hover:scale-105"
          style={{
            backgroundColor: showFavorites
              ? T.accentColor + "15"
              : "transparent",
            color: showFavorites ? T.accentColor : T.textMuted,
            border: showFavorites
              ? "1px solid " + T.accentColor + "30"
              : "transparent",
          }}
        >
          <Star size={10} className={showFavorites ? "fill-current" : ""} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
        {filteredAssets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => onAssetSelect?.(asset)}
            className="p-2 rounded-lg text-left transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: T.boxBg + "40",
              border: "1px solid " + T.borderColor + "20",
            }}
          >
            <div className="flex items-start justify-between mb-1">
              <div
                className="flex items-center gap-1"
                style={{ color: T.accentColor }}
              >
                {getAssetIcon(asset.type)}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(asset.id);
                }}
                className="transition-all hover:scale-110"
              >
                <Star
                  size={10}
                  className={asset.favorite ? "fill-current" : ""}
                  style={{ color: asset.favorite ? "#f59e0b" : T.textMuted }}
                />
              </button>
            </div>
            <div
              className="text-[10px] font-bold truncate"
              style={{ color: T.textColor }}
            >
              {asset.name}
            </div>
            <div className="text-[9px]" style={{ color: T.textMuted }}>
              {asset.type}
            </div>
          </button>
        ))}
      </div>

      {filteredAssets.length === 0 && (
        <div className="text-center py-4">
          <FolderOpen
            size={24}
            className="mx-auto mb-2"
            style={{ color: T.textMuted }}
          />
          <p className="text-xs" style={{ color: T.textMuted }}>
            No assets found
          </p>
        </div>
      )}
    </div>
  );
}
