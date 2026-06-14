"use client";
import React, { useState, useCallback } from "react";

interface GeneratedImage {
  url: string;
  prompt: string;
  provider: string;
  timestamp: number;
}

const PROVIDERS = [
  { id: "pollinations", name: "Pollinations (Free)", cost: "FREE", description: "FLUX + SDXL, works without API key · FREE" },
  { id: "gemini", name: "Gemini (Imagen 3)", cost: "1", description: "Google Imagen 3, needs GEMINI_API_KEY · 1 🪙" },
  { id: "together", name: "Together.ai (FLUX)", cost: "2", description: "FLUX.1 Schnell, needs TOGETHER_API_KEY · 2 🪙" },
  { id: "fal", name: "FAL.ai (FLUX Pro)", cost: "3", description: "FLUX.1 Pro, needs FAL_KEY · 3 🪙" },
  { id: "openai", name: "OpenAI (DALL-E 3)", cost: "5", description: "DALL-E 3 photorealistic, needs OPENAI_API_KEY · 5 🪙" },
  { id: "recraft", name: "Recraft (Vector)", cost: "3", description: "SVG/vector art, needs RECRAFT_API_KEY · 3 🪙" },
];

const ASPECT_RATIOS = [
  { id: "1:1", label: "Square", value: "1:1" },
  { id: "16:9", label: "Wide", value: "16:9" },
  { id: "9:16", label: "Tall", value: "9:16" },
  { id: "4:3", label: "Wide HD", value: "4:3" },
  { id: "3:4", label: "Tall HD", value: "3:4" },
];

const QUICK_STARTERS = [
  "A neon-lit cyberpunk city at midnight, rain-slicked streets reflecting holographic billboards, flying cars streaking through fog",
  "Ethereal floating islands with waterfalls cascading into the void, golden hour, Studio Ghibli inspired",
  "Ancient temple ruins reclaimed by bioluminescent jungle, fireflies, mist, mystical atmosphere",
  "Crystal cavern with underground lake, light refracting through quartz, peaceful and majestic",
  "A lone astronaut standing on Mars, Earth rising in the distance, ultra-realistic, cinematic lighting",
  "Massive space station orbiting a purple gas giant, fleets of ships, epic scale, sci-fi concept art",
  "Abandoned arcade with broken neon signs, dust motes in volumetric light, retro 80s aesthetic",
  "Underwater coral city with merfolk and bio-luminescent architecture, dreamlike and serene",
];

export default function NeuralImagingStudio() {
  const [prompt, setPrompt] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("pollinations");
  const [selectedRatio, setSelectedRatio] = useState("1:1");
  const [batchSize, setBatchSize] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use useCallback for stable handler
  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    console.log("Prompt changed:", newValue.length, "chars");
    setPrompt(newValue);
    setError(null);
  }, []);

  const charCount = prompt?.length || 0;
  const isValidPrompt = charCount >= 3;

  const handleGenerate = async () => {
    if (!isValidPrompt) {
      setError("Prompt must be at least 3 characters");
      return;
    }

    setIsGenerating(true);
    setError(null);
    
    try {
      console.log("Generating with prompt:", prompt);
      const response = await fetch("/api/studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider: selectedProvider,
          aspectRatio: selectedRatio,
          batchSize,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.images && data.images.length > 0) {
        setGeneratedImages(data.images);
        setPreviewImage(data.images[0]?.url || null);
      } else {
        throw new Error("No images returned");
      }
    } catch (err) {
      console.error("Generation failed:", err);
      setError(err instanceof Error ? err.message : "Generation failed");
      
      // Fallback to pollinations
      const { width, height } = (() => {
        const [w, h] = selectedRatio.split(":").map(Number);
        return { width: w * 100, height: h * 100 };
      })();
      
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}`;
      const images = Array.from({ length: batchSize }, (_, i) => ({
        url: fallbackUrl + (batchSize > 1 ? `&index=${i}` : ""),
        prompt,
        provider: "pollinations",
        timestamp: Date.now() + i,
      }));
      setGeneratedImages(images);
      setPreviewImage(images[0]?.url || null);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUsePrompt = (starter: string) => {
    setPrompt(starter);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Neural Imaging Studio</h1>
        <p className="text-sm text-zinc-500">Generate images with multiple AI providers</p>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 rounded-xl p-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN - Controls */}
        <div className="lg:col-span-1 space-y-5">
          {/* Prompt Input */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2">Your Vision</label>
            <textarea
              value={prompt}
              onChange={handlePromptChange}
              className="w-full h-32 bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none placeholder-slate-600"
              placeholder="Describe the scene... (min 3 chars)"
              disabled={isGenerating}
            />
            <div className="flex justify-between items-center mt-2">
              <div className={`text-xs ${charCount < 3 ? "text-red-400" : "text-green-400"}`}>
                {charCount < 3 ? "⚠️ Too short — describe the scene in detail" : "✓ Good prompt"}
              </div>
              <span className="text-xs text-zinc-400 font-mono">
                {charCount} chars {charCount >= 3 ? "✓" : "(min 3)"}
              </span>
            </div>
          </div>

          {/* Quick Starters */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2">Quick Starters</label>
            <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
              {QUICK_STARTERS.map((starter, idx) => (
                <button
                  key={idx}
                  onClick={() => handleUsePrompt(starter)}
                  className="text-left p-2 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 transition text-xs text-zinc-300 truncate"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>

          {/* Provider Selection */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-2">Provider</label>
            <div className="space-y-1.5">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  className={`w-full text-left p-2.5 rounded-lg border text-xs transition ${
                    selectedProvider === provider.id
                      ? "bg-orange-500/20 border-orange-500"
                      : "bg-slate-900 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white font-medium">{provider.name}</span>
                    <span className={`text-xs font-mono ${provider.cost === "FREE" ? "text-green-400" : "text-orange-400"}`}>
                      {provider.cost === "FREE" ? "FREE" : `${provider.cost} 🪙`}
                    </span>
                  </div>
                  <div className="text-zinc-400 mt-1">{provider.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - Preview & Actions */}
        <div className="lg:col-span-2 space-y-5">
          {/* Aspect Ratio & Batch */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-2">Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-1.5">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio.id}
                    onClick={() => setSelectedRatio(ratio.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                      selectedRatio === ratio.id
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-slate-900 text-zinc-300 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-2">Batch Size</label>
              <div className="flex items-center gap-2">
                {[1, 2, 4].map((size) => (
                  <button
                    key={size}
                    onClick={() => setBatchSize(size)}
                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition ${
                      batchSize === size
                        ? "bg-orange-500 text-white border-orange-500"
                        : "bg-slate-900 text-zinc-300 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    {size}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!isValidPrompt || isGenerating}
            className={`w-full py-4 rounded-xl text-sm font-bold tracking-wider uppercase transition flex items-center justify-center gap-2 ${
              isValidPrompt && !isGenerating
                ? "bg-orange-500 hover:bg-orange-400 text-white shadow-lg shadow-orange-500/20"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
          >
            {isGenerating ? (
              <>
                <span className="animate-spin">⏳</span> Generating...
              </>
            ) : (
              <>
                <span>🎨</span> Generate {selectedProvider === "pollinations" ? "(FREE)" : `(${PROVIDERS.find(p => p.id === selectedProvider)?.cost} 🪙)`}
              </>
            )}
          </button>

          {/* Preview Area */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden aspect-video min-h-[300px] flex items-center justify-center">
            {previewImage ? (
              <img src={previewImage} alt="Generated" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center text-zinc-500">
                <div className="text-6xl mb-2">🖼️</div>
                <p className="text-sm">Your creation will appear here</p>
                <p className="text-xs text-zinc-600 mt-1">Type a prompt and click Generate</p>
              </div>
            )}
          </div>

          {/* Recent Images */}
          {generatedImages.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 mb-2">Recent ({generatedImages.length})</h3>
              <div className="grid grid-cols-6 gap-2">
                {generatedImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setPreviewImage(img.url)}
                    className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-orange-500 transition"
                  >
                    <img src={img.url} alt={`Gen ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
