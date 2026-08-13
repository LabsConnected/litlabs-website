export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  if (path.includes("share") || path.includes("intent")) {
    return "/handle-share";
  }
  return path;
}
