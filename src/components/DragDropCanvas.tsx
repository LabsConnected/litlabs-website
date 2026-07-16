"use client";

import { useState, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Plus, Trash2, Lock, Unlock, Eye, EyeOff, Layers, Copy } from "lucide-react";

interface CanvasItem {
  id: string;
  type: "text" | "image" | "shape" | "node";
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  locked?: boolean;
  visible?: boolean;
  zIndex?: number;
  data?: Record<string, unknown>;
}

interface DragDropCanvasProps {
  items?: CanvasItem[];
  onItemsChange?: (items: CanvasItem[]) => void;
  onItemSelect?: (item: CanvasItem) => void;
  selectedItem?: CanvasItem | null;
}

export default function DragDropCanvas({ 
  items: externalItems, 
  onItemsChange, 
  onItemSelect,
  selectedItem: externalSelectedItem 
}: DragDropCanvasProps) {
  const { resolvedColors: T } = useTheme();
  const [items, setItems] = useState<CanvasItem[]>(externalItems || []);
  const [selectedItem, setSelectedItem] = useState<CanvasItem | null>(externalSelectedItem || null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent, item: CanvasItem) => {
    if (item.locked) return;
    setIsDragging(true);
    setSelectedItem(item);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragOffset({
      x: e.clientX - rect.left - item.x,
      y: e.clientY - rect.top - item.y,
    });
    onItemSelect?.(item);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selectedItem) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const newX = e.clientX - rect.left - dragOffset.x;
    const newY = e.clientY - rect.top - dragOffset.y;
    
    setItems(items.map(item => 
      item.id === selectedItem.id 
        ? { ...item, x: newX, y: newY }
        : item
    ));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    onItemsChange?.(items);
  };

  const addItem = (type: CanvasItem["type"]) => {
    const newItem: CanvasItem = {
      id: Date.now().toString(),
      type,
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      width: type === "text" ? 200 : 100,
      height: type === "text" ? 50 : 100,
      content: type === "text" ? "New text" : undefined,
      locked: false,
      visible: true,
      zIndex: items.length,
    };
    setItems([...items, newItem]);
    setSelectedItem(newItem);
  };

  const deleteItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
    if (selectedItem?.id === id) setSelectedItem(null);
  };

  const toggleLock = (id: string) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, locked: !item.locked } : item
    ));
  };

  const toggleVisibility = (id: string) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, visible: !item.visible } : item
    ));
  };

  const duplicateItem = (item: CanvasItem) => {
    const newItem = {
      ...item,
      id: Date.now().toString(),
      x: item.x + 20,
      y: item.y + 20,
      zIndex: items.length,
    };
    setItems([...items, newItem]);
    setSelectedItem(newItem);
  };

  return (
    <div className="flex h-full">
      <div className="w-16 border-r flex flex-col items-center gap-2 p-2"
        style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
        <button
          onClick={() => addItem("text")}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.accentColor + "15", color: T.accentColor }}
          title="Add Text"
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => addItem("image")}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.boxBg + "40", color: T.textColor }}
          title="Add Image"
        >
          🖼️
        </button>
        <button
          onClick={() => addItem("shape")}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.boxBg + "40", color: T.textColor }}
          title="Add Shape"
        >
          ⬜
        </button>
        <button
          onClick={() => addItem("node")}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.boxBg + "40", color: T.textColor }}
          title="Add Node"
        >
          🔵
        </button>
      </div>

      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden"
        style={{ backgroundColor: T.bgColor + "80" }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(${T.borderColor + "10"} 1px, transparent 1px),
              linear-gradient(90deg, ${T.borderColor + "10"} 1px, transparent 1px)
            `,
            backgroundSize: "20px 20px",
          }}
        />

        {items.filter(item => item.visible !== false).map((item) => (
          <div
            key={item.id}
            className={`absolute cursor-move transition-shadow ${selectedItem?.id === item.id ? "ring-2" : ""}`}
            style={{
              left: item.x,
              top: item.y,
              width: item.width,
              height: item.height,
              backgroundColor: item.type === "text" ? "transparent" : T.boxBg + "60",
              border: `1px solid ${selectedItem?.id === item.id ? T.accentColor : T.borderColor + "30"}`,
              borderRadius: "8px",
              zIndex: item.zIndex,
              boxShadow: selectedItem?.id === item.id ? `0 0 20px ${T.accentColor}30` : "none",
            }}
            onMouseDown={(e) => handleMouseDown(e, item)}
          >
            {item.type === "text" && (
              <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: T.textColor }}>
                {item.content}
              </div>
            )}
            {item.type === "image" && (
              <div className="w-full h-full flex items-center justify-center text-2xl">
                🖼️
              </div>
            )}
            {item.type === "shape" && (
              <div className="w-full h-full flex items-center justify-center text-2xl">
                ⬜
              </div>
            )}
            {item.type === "node" && (
              <div className="w-full h-full flex items-center justify-center text-2xl">
                🔵
              </div>
            )}
          </div>
        ))}

        {selectedItem && (
          <div
            className="absolute flex gap-1 p-1 rounded-lg"
            style={{
              top: selectedItem.y + selectedItem.height + 10,
              left: selectedItem.x,
              backgroundColor: T.boxBg + "90",
              border: `1px solid ${T.borderColor}30`,
            }}
          >
            <button
              onClick={() => toggleLock(selectedItem.id)}
              className="p-1.5 rounded transition-all hover:scale-110"
              style={{ color: selectedItem.locked ? T.accentColor : T.textMuted }}
              title={selectedItem.locked ? "Unlock" : "Lock"}
            >
              {selectedItem.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            <button
              onClick={() => toggleVisibility(selectedItem.id)}
              className="p-1.5 rounded transition-all hover:scale-110"
              style={{ color: T.textMuted }}
              title="Toggle Visibility"
            >
              {selectedItem.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button
              onClick={() => duplicateItem(selectedItem)}
              className="p-1.5 rounded transition-all hover:scale-110"
              style={{ color: T.textMuted }}
              title="Duplicate"
            >
              <Copy size={12} />
            </button>
            <button
              onClick={() => deleteItem(selectedItem.id)}
              className="p-1.5 rounded transition-all hover:scale-110"
              style={{ color: "#ef4444" }}
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="w-64 border-l p-4 overflow-y-auto"
        style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "80" }}>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: T.textMuted }}>
          Inspector
        </div>
        
        {selectedItem ? (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold mb-1 block" style={{ color: T.textMuted }}>Type</label>
              <div className="text-xs" style={{ color: T.textColor }}>{selectedItem.type}</div>
            </div>
            <div>
              <label className="text-[10px] font-bold mb-1 block" style={{ color: T.textMuted }}>Position</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[9px]" style={{ color: T.textMuted }}>X:</span>
                  <input
                    type="number"
                    value={Math.round(selectedItem.x)}
                    onChange={(e) => setItems(items.map(item => 
                      item.id === selectedItem.id ? { ...item, x: Number(e.target.value) } : item
                    ))}
                    className="w-full px-2 py-1 rounded text-xs"
                    style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
                  />
                </div>
                <div>
                  <span className="text-[9px]" style={{ color: T.textMuted }}>Y:</span>
                  <input
                    type="number"
                    value={Math.round(selectedItem.y)}
                    onChange={(e) => setItems(items.map(item => 
                      item.id === selectedItem.id ? { ...item, y: Number(e.target.value) } : item
                    ))}
                    className="w-full px-2 py-1 rounded text-xs"
                    style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold mb-1 block" style={{ color: T.textMuted }}>Size</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[9px]" style={{ color: T.textMuted }}>W:</span>
                  <input
                    type="number"
                    value={selectedItem.width}
                    onChange={(e) => setItems(items.map(item => 
                      item.id === selectedItem.id ? { ...item, width: Number(e.target.value) } : item
                    ))}
                    className="w-full px-2 py-1 rounded text-xs"
                    style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
                  />
                </div>
                <div>
                  <span className="text-[9px]" style={{ color: T.textMuted }}>H:</span>
                  <input
                    type="number"
                    value={selectedItem.height}
                    onChange={(e) => setItems(items.map(item => 
                      item.id === selectedItem.id ? { ...item, height: Number(e.target.value) } : item
                    ))}
                    className="w-full px-2 py-1 rounded text-xs"
                    style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
                  />
                </div>
              </div>
            </div>
            {selectedItem.type === "text" && (
              <div>
                <label className="text-[10px] font-bold mb-1 block" style={{ color: T.textMuted }}>Content</label>
                <textarea
                  value={selectedItem.content || ""}
                  onChange={(e) => setItems(items.map(item => 
                    item.id === selectedItem.id ? { ...item, content: e.target.value } : item
                  ))}
                  className="w-full px-2 py-1 rounded text-xs"
                  style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
                  rows={3}
                />
              </div>
            )}
            <div>
              <label className="text-[10px] font-bold mb-1 block" style={{ color: T.textMuted }}>Z-Index</label>
              <input
                type="number"
                value={selectedItem.zIndex}
                onChange={(e) => setItems(items.map(item => 
                  item.id === selectedItem.id ? { ...item, zIndex: Number(e.target.value) } : item
                ))}
                className="w-full px-2 py-1 rounded text-xs"
                style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30", color: T.textColor }}
              />
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <Layers size={24} className="mx-auto mb-2" style={{ color: T.textMuted }} />
            <p className="text-xs" style={{ color: T.textMuted }}>Select an item to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}
