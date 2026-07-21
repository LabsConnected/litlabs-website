const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".sass": "scss",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".mdx": "markdown",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".env": "ini",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".vue": "html",
  ".svelte": "html",
  ".astro": "html",
  ".dockerfile": "dockerfile",
  ".txt": "plaintext",
};

const FILENAME_MAP: Record<string, string> = {
  "Dockerfile": "dockerfile",
  "Makefile": "makefile",
  ".gitignore": "ini",
  ".env.local": "ini",
  ".env.example": "ini",
  ".eslintrc": "json",
  ".prettierrc": "json",
};

export function languageFromPath(path: string): string {
  const basename = path.split("/").pop() ?? path;
  if (FILENAME_MAP[basename]) return FILENAME_MAP[basename];

  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex === -1) return "plaintext";
  const ext = basename.slice(dotIndex).toLowerCase();
  return EXTENSION_MAP[ext] ?? "plaintext";
}
