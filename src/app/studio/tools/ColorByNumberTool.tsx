"use client";

import { useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { ChevronLeft, Download, Printer } from "lucide-react";
import ColorByNumber from "@/components/color/ColorByNumber";
import TemplateGallery from "@/components/color/TemplateGallery";
import templates, { type ColorTemplate } from "@/lib/color-templates";

export default function ColorByNumberTool() {
  const { resolvedColors: T } = useTheme();
  const [selected, setSelected] = useState<ColorTemplate | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const handleExport = useCallback((dataUrl: string) => {
    setExported(dataUrl);
  }, []);

  const handleDownload = () => {
    if (!exported) return;
    const a = document.createElement("a");
    a.href = exported;
    a.download = `color-by-number-${selected?.id || "art"}.png`;
    a.click();
  };

  const handlePrint = () => {
    if (!exported) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head><title>Color by Number</title></head>
        <body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;">
          <img src="${exported}" style="max-width:100%;max-height:100vh;" />
        </body>
      </html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: T.headerColor }}>
            Color by Number
          </h2>
          <p className="text-xs" style={{ color: T.textMuted }}>
            Pick a template, choose a color, and tap regions to fill them.
          </p>
        </div>
        {selected && (
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border"
            style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40", color: T.textColor }}
          >
            <ChevronLeft size={14} /> Back to templates
          </button>
        )}
      </div>

      {!selected ? (
        <TemplateGallery templates={templates} onSelect={setSelected} />
      ) : (
        <div className="space-y-4">
          <div
            className="border rounded-2xl p-4"
            style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "30" }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: T.accentColor }}>
                  {selected.category}
                </div>
                <div className="text-sm font-bold" style={{ color: T.textColor }}>
                  {selected.title}
                </div>
              </div>
              <div className="flex gap-2">
                {exported && (
                  <>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border"
                      style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40", color: T.textColor }}
                    >
                      <Download size={12} /> PNG
                    </button>
                    <button
                      onClick={handlePrint}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border"
                      style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40", color: T.textColor }}
                    >
                      <Printer size={12} /> Print
                    </button>
                  </>
                )}
              </div>
            </div>
            <ColorByNumber svgString={selected.svg} onExport={handleExport} />
          </div>
        </div>
      )}
    </div>
  );
}
