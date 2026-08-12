/**
 * Project type system for the LiTT Creation Workspace.
 *
 * The Canvas builder supports multiple project types. Each type changes:
 *   - the left panel content (sections vs files vs game objects)
 *   - the center workspace (visual canvas vs code editor vs game stage)
 *   - the LiTT copilot actions (Build Page vs Edit HTML vs Build Game)
 *
 * This is the foundation for the unified workspace — one builder that
 * adapts to what the user is creating instead of separate tools.
 */

export type ProjectType =
  | "website"
  | "html"
  | "game2d"
  | "game3d"
  | "app"
  | "component";

export interface ProjectTypeMeta {
  id: ProjectType;
  label: string;
  icon: string; // lucide icon name
  description: string;
  /** Whether this type uses the visual CanvasDocument or a custom editor */
  editor: "canvas" | "html" | "game";
}

export const PROJECT_TYPES: ProjectTypeMeta[] = [
  {
    id: "website",
    label: "Website",
    icon: "Globe",
    description: "Landing pages, SaaS sites, portfolios, stores",
    editor: "canvas",
  },
  {
    id: "html",
    label: "HTML / CSS / JS",
    icon: "Code2",
    description: "Raw HTML, CSS, and JavaScript with live preview",
    editor: "html",
  },
  {
    id: "game2d",
    label: "2D Game",
    icon: "Gamepad2",
    description: "HTML Canvas or Phaser games with Quick Build",
    editor: "game",
  },
  {
    id: "game3d",
    label: "3D Game",
    icon: "Box",
    description: "Three.js or Babylon.js 3D games",
    editor: "game",
  },
  {
    id: "app",
    label: "Web App",
    icon: "AppWindow",
    description: "Interactive React/Next.js applications",
    editor: "canvas",
  },
  {
    id: "component",
    label: "Component",
    icon: "Component",
    description: "Reusable UI components",
    editor: "canvas",
  },
];

export function getProjectTypeMeta(type: ProjectType): ProjectTypeMeta {
  return PROJECT_TYPES.find((p) => p.id === type) ?? PROJECT_TYPES[0];
}

// ─── HTML Project Model ─────────────────────────────────────────────

export type HtmlFileLanguage = "html" | "css" | "javascript";

export interface HtmlFile {
  name: string;
  content: string;
  language: HtmlFileLanguage;
}

export interface HtmlProject {
  files: HtmlFile[];
  activeFile: string;
}

export function createEmptyHtmlProject(): HtmlProject {
  return {
    files: [
      {
        name: "index.html",
        language: "html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>Hello, LiTT</h1>
    <p>Start building something amazing.</p>
    <button id="btn">Click me</button>
  </div>
  <script src="script.js"></script>
</body>
</html>`,
      },
      {
        name: "style.css",
        language: "css",
        content: `* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0a0b10;
  color: #e4e4e7;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.container {
  text-align: center;
  padding: 48px;
}

h1 {
  font-size: 48px;
  font-weight: 800;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #9b4dff, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

p {
  font-size: 16px;
  color: #a1a1aa;
  margin-bottom: 24px;
}

button {
  padding: 12px 32px;
  border: none;
  border-radius: 10px;
  background: #9b4dff;
  color: white;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
}

button:hover {
  background: #8b3fef;
  transform: translateY(-1px);
}`,
      },
      {
        name: "script.js",
        language: "javascript",
        content: `const btn = document.getElementById("btn");
let count = 0;

btn.addEventListener("click", () => {
  count++;
  btn.textContent = \`Clicked \${count} times\`;
});`,
      },
    ],
    activeFile: "index.html",
  };
}

/**
 * Combine all HTML project files into a single HTML document for
 * live preview in an iframe. CSS is inlined into <style>, JS into <script>.
 */
export function buildHtmlPreview(files: HtmlFile[]): string {
  const html = files.find((f) => f.name === "index.html")?.content ?? "";
  const css = files.find((f) => f.name === "style.css")?.content ?? "";
  const js = files.find((f) => f.name === "script.js")?.content ?? "";

  // Inject CSS and JS directly into the HTML for the preview blob
  let preview = html;

  // Replace <link rel="stylesheet" href="style.css"> with inline <style>
  preview = preview.replace(
    /<link[^>]*href=["']style\.css["'][^>]*>/gi,
    `<style>\n${css}\n</style>`,
  );

  // Replace <script src="script.js"></script> with inline <script>
  preview = preview.replace(
    /<script[^>]*src=["']script\.js["'][^>]*><\/script>/gi,
    `<script>\n${js}\n</script>`,
  );

  // If no link/script tags were found, inject them into <head> and <body>
  if (!preview.includes("<style>") && css) {
    preview = preview.replace("</head>", `<style>\n${css}\n</style>\n</head>`);
  }
  if (!preview.includes("<script>") && js) {
    preview = preview.replace("</body>", `<script>\n${js}\n</script>\n</body>`);
  }

  return preview;
}
