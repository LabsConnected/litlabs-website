
function numericGameId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
}
function escapeForScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}
function buildPlayerDocument(opts: {
  core: string;
  gameUrl: string;
  gameName: string;
  gameId: string;
  color: string;
  biosUrl?: string;
  buildId: string;
  dataPath: string;
}
export { buildPlayerDocument };
