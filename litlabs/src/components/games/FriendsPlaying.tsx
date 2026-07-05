export default function FriendsPlaying() {
  const friends = ["LiTTreeCeo", "Builder", "Jason"];

  return (
    <section className="rounded-2xl bg-white/5 border border-white/10 p-4">
      <h2 className="font-black mb-4 text-white">Friends Playing</h2>

      <div className="space-y-3">
        {friends.map((friend) => (
          <div key={friend} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">{friend}</p>
              <p className="text-xs text-green-400">Online now</p>
            </div>
            <button className="rounded-lg bg-green-500 px-3 py-1 text-xs font-black text-black hover:bg-green-400 transition-colors">
              Join
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
