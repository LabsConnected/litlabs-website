import JarvisChatBox from "@/components/JarvisChatBox";

export default function JarvisPage() {
  return (
    <main className="min-h-screen bg-black text-white p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-orange-400">
            LiTTree LabStudios
          </p>
          <h1 className="text-4xl font-black">Jarvis Command Center</h1>
          <p className="text-zinc-400 mt-2">
            Fast local AI route using Next.js + Ollama.
          </p>
        </div>

        <JarvisChatBox />
      </div>
    </main>
  );
}
