export default function MobileGameNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#090a14]/95 border-t border-white/10 backdrop-blur-xl md:hidden pb-safe">
      <div className="grid grid-cols-5 max-w-md mx-auto py-2">
        {[
          ["🏠", "Home"],
          ["🧭", "Discover"],
          ["🎮", "Play"],
          ["👥", "Friends"],
          ["👤", "Profile"],
        ].map(([icon, label]) => (
          <button
            key={label}
            className="py-2 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <div className="text-lg">{icon}</div>
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}
