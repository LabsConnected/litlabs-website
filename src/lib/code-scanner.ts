/**
 * Code Scanner System for LiTTree Lab Studios
 * VS Code-style codebase analysis and exploration
 */

export interface FileNode {
  path: string;
  name: string;
  type: "file" | "directory";
  extension?: string;
  size?: number;
  lastModified?: number;
  children?: FileNode[];
}

export interface CodeSymbol {
  name: string;
  type: "function" | "class" | "interface" | "variable" | "export" | "import";
  line: number;
  column: number;
  path: string;
}

export interface Dependency {
  source: string;
  target: string;
  type: "import" | "dynamic" | "require";
}

export interface CodeError {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}

export interface SearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
  match: string;
}

// Common file extensions and their categories
export const FILE_CATEGORIES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".md": "markdown",
  ".mdx": "markdown",
  ".py": "python",
  ".sql": "sql",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".env": "env",
  ".sh": "shell",
  ".ps1": "powershell",
};

// File icons based on extension
export const FILE_ICONS: Record<string, string> = {
  typescript: "📘",
  javascript: "📒",
  json: "📋",
  css: "🎨",
  scss: "🎨",
  html: "🌐",
  markdown: "📝",
  python: "🐍",
  sql: "🗄️",
  yaml: "⚙️",
  env: "🔐",
  shell: "💻",
  powershell: "💻",
  default: "📄",
  folder: "📁",
  folderOpen: "📂",
};

// Demo file tree - in production this would scan the actual filesystem
export const DEMO_FILE_TREE: FileNode = {
  path: "/",
  name: "litlabs",
  type: "directory",
  children: [
    {
      path: "/src",
      name: "src",
      type: "directory",
      children: [
        {
          path: "/src/app",
          name: "app",
          type: "directory",
          children: [
            {
              path: "/src/app/page.tsx",
              name: "page.tsx",
              type: "file",
              extension: "tsx",
              size: 25600,
            },
            {
              path: "/src/app/layout.tsx",
              name: "layout.tsx",
              type: "file",
              extension: "tsx",
              size: 4500,
            },
            {
              path: "/src/app/globals.css",
              name: "globals.css",
              type: "file",
              extension: "css",
              size: 3200,
            },
            {
              path: "/src/app/api",
              name: "api",
              type: "directory",
              children: [
                {
                  path: "/src/app/api/gemini/route.ts",
                  name: "route.ts",
                  type: "file",
                  extension: "ts",
                  size: 2800,
                },
                {
                  path: "/src/app/api/agents/route.ts",
                  name: "route.ts",
                  type: "file",
                  extension: "ts",
                  size: 3100,
                },
              ],
            },
            {
              path: "/src/app/studio",
              name: "studio",
              type: "directory",
              children: [
                {
                  path: "/src/app/studio/page.tsx",
                  name: "page.tsx",
                  type: "file",
                  extension: "tsx",
                  size: 7800,
                },
                {
                  path: "/src/app/studio/tools/ImageTool.tsx",
                  name: "ImageTool.tsx",
                  type: "file",
                  extension: "tsx",
                  size: 5400,
                },
              ],
            },
          ],
        },
        {
          path: "/src/components",
          name: "components",
          type: "directory",
          children: [
            {
              path: "/src/components/NavbarWrapper.tsx",
              name: "NavbarWrapper.tsx",
              type: "file",
              extension: "tsx",
              size: 2100,
            },
            {
              path: "/src/components/Footer.tsx",
              name: "Footer.tsx",
              type: "file",
              extension: "tsx",
              size: 2100,
            },
            {
              path: "/src/components/PageShell.tsx",
              name: "PageShell.tsx",
              type: "file",
              extension: "tsx",
              size: 3400,
            },
          ],
        },
        {
          path: "/src/lib",
          name: "lib",
          type: "directory",
          children: [
            {
              path: "/src/lib/agents.ts",
              name: "agents.ts",
              type: "file",
              extension: "ts",
              size: 8900,
            },
            {
              path: "/src/lib/supabase.ts",
              name: "supabase.ts",
              type: "file",
              extension: "ts",
              size: 1200,
            },
            {
              path: "/src/lib/music.ts",
              name: "music.ts",
              type: "file",
              extension: "ts",
              size: 3400,
            },
            {
              path: "/src/lib/games.ts",
              name: "games.ts",
              type: "file",
              extension: "ts",
              size: 5600,
            },
          ],
        },
        {
          path: "/src/context",
          name: "context",
          type: "directory",
          children: [
            {
              path: "/src/context/ThemeContext.tsx",
              name: "ThemeContext.tsx",
              type: "file",
              extension: "tsx",
              size: 6700,
            },
            {
              path: "/src/context/ProfileContext.tsx",
              name: "ProfileContext.tsx",
              type: "file",
              extension: "tsx",
              size: 4300,
            },
          ],
        },
      ],
    },
    {
      path: "/supabase",
      name: "supabase",
      type: "directory",
      children: [
        {
          path: "/supabase/migrations",
          name: "migrations",
          type: "directory",
          children: [],
        },
      ],
    },
    {
      path: "/package.json",
      name: "package.json",
      type: "file",
      extension: "json",
      size: 1200,
    },
    {
      path: "/next.config.ts",
      name: "next.config.ts",
      type: "file",
      extension: "ts",
      size: 2800,
    },
    {
      path: "/tsconfig.json",
      name: "tsconfig.json",
      type: "file",
      extension: "json",
      size: 800,
    },
    {
      path: "/tailwind.config.ts",
      name: "tailwind.config.ts",
      type: "file",
      extension: "ts",
      size: 2100,
    },
  ],
};

// Demo search results
export const DEMO_SEARCH_RESULTS: SearchResult[] = [
  {
    path: "/src/app/page.tsx",
    line: 45,
    column: 10,
    preview: "const C = {",
    match: "const",
  },
  {
    path: "/src/lib/agents.ts",
    line: 12,
    column: 1,
    preview: "export interface Agent",
    match: "interface",
  },
  {
    path: "/src/context/ThemeContext.tsx",
    line: 23,
    column: 7,
    preview: "const [theme, setTheme]",
    match: "theme",
  },
];

// Demo errors
export const DEMO_ERRORS: CodeError[] = [
  {
    path: "/src/app/page.tsx",
    line: 156,
    column: 5,
    severity: "warning",
    message: "Unused variable 'foo'",
    code: "TS6133",
  },
  {
    path: "/src/lib/music.ts",
    line: 45,
    column: 12,
    severity: "info",
    message: "Missing JSDoc comment",
    code: "TSDOC",
  },
];

// Demo dependencies
export const DEMO_DEPENDENCIES: Dependency[] = [
  {
    source: "/src/app/page.tsx",
    target: "@/context/ThemeContext",
    type: "import",
  },
  { source: "/src/app/page.tsx", target: "@/lib/agents", type: "import" },
  {
    source: "/src/components/LayoutShell.tsx",
    target: "@/components/NavbarWrapper",
    type: "import",
  },
  {
    source: "/src/components/NavbarWrapper.tsx",
    target: "react",
    type: "import",
  },
  { source: "/src/lib/agents.ts", target: "@/lib/supabase", type: "import" },
];

export function getFileIcon(extension?: string): string {
  if (!extension) return FILE_ICONS.default;
  const category = FILE_CATEGORIES[`.${extension}`] || "default";
  return FILE_ICONS[category] || FILE_ICONS.default;
}

export function getFolderIcon(isOpen: boolean): string {
  return isOpen ? FILE_ICONS.folderOpen : FILE_ICONS.folder;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function countFiles(node: FileNode): number {
  if (node.type === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((acc, child) => acc + countFiles(child), 0);
}

export function searchFileTree(node: FileNode, query: string): FileNode[] {
  const results: FileNode[] = [];
  const q = query.toLowerCase();

  function search(n: FileNode) {
    if (n.name.toLowerCase().includes(q)) {
      results.push(n);
    }
    if (n.children) {
      n.children.forEach(search);
    }
  }

  search(node);
  return results;
}

export function getFileByPath(
  root: FileNode,
  path: string,
): FileNode | undefined {
  if (root.path === path) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = getFileByPath(child, path);
      if (found) return found;
    }
  }
  return undefined;
}
