/**
 * ActiveProject — canonical project-resolution pipeline tests.
 *
 * Covers the contract that fixes the Termux "No package.json found"
 * failure: when `litt` is launched from a directory with no project,
 * it recovers via recent → picker → discovery → scaffold instead of
 * dying. Also covers the canonical identity contract (git remote
 * parsing, display string, recent-project memory) that Studio will
 * consume.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseGitRemote,
  buildActiveProject,
  readRecentProjects,
  recordRecentProject,
  clearRecentProjects,
  discoverProjects,
  scaffoldProject,
  buildPickerChoices,
  runProjectPicker,
  resolveActiveProject,
  activeProjectDisplay,
  type ActiveProject,
} from "../lib/active-project.js";
import { detectProject } from "../lib/utils.js";

// ─── parseGitRemote ────────────────────────────────────────────────

describe("parseGitRemote — git remote URL parsing", () => {
  it("parses SSH form git@github.com:owner/name.git", () => {
    expect(parseGitRemote("git@github.com:LabsConnected/litlabs-website.git")).toEqual({
      owner: "LabsConnected",
      name: "litlabs-website",
      fullName: "LabsConnected/litlabs-website",
    });
  });

  it("parses SSH form without .git suffix", () => {
    expect(parseGitRemote("git@github.com:LabsConnected/litlabs-website")).toEqual({
      owner: "LabsConnected",
      name: "litlabs-website",
      fullName: "LabsConnected/litlabs-website",
    });
  });

  it("parses HTTPS form https://github.com/owner/name.git", () => {
    expect(parseGitRemote("https://github.com/LabsConnected/litlabs-website.git")).toEqual({
      owner: "LabsConnected",
      name: "litlabs-website",
      fullName: "LabsConnected/litlabs-website",
    });
  });

  it("parses HTTPS form without .git suffix", () => {
    expect(parseGitRemote("https://github.com/LabsConnected/litlabs-website")).toEqual({
      owner: "LabsConnected",
      name: "litlabs-website",
      fullName: "LabsConnected/litlabs-website",
    });
  });

  it("parses git:// form", () => {
    expect(parseGitRemote("git://github.com/LabsConnected/litlabs-website.git")).toEqual({
      owner: "LabsConnected",
      name: "litlabs-website",
      fullName: "LabsConnected/litlabs-website",
    });
  });

  it("returns null for unparseable input", () => {
    expect(parseGitRemote("not-a-url")).toBeNull();
    expect(parseGitRemote("")).toBeNull();
  });

  it("returns null for a bare host with no path", () => {
    expect(parseGitRemote("https://github.com/")).toBeNull();
  });
});

// ─── Recent-project memory ─────────────────────────────────────────

describe("recent-project memory", () => {
  let tmpHome: string;
  const prevFile = process.env.LITT_RECENT_PROJECTS_FILE;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "litt-recent-"));
    process.env.LITT_RECENT_PROJECTS_FILE = path.join(tmpHome, "recent-projects.json");
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (prevFile === undefined) delete process.env.LITT_RECENT_PROJECTS_FILE;
    else process.env.LITT_RECENT_PROJECTS_FILE = prevFile;
  });

  function fakeActive(overrides: Partial<ActiveProject> = {}): ActiveProject {
    return {
      workspacePath: "/home/user/my-project",
      dirName: "my-project",
      packageName: "my-project",
      repositoryId: "git@github.com:owner/my-project.git",
      repositoryOwner: "owner",
      repositoryName: "my-project",
      repositoryFullName: "owner/my-project",
      branch: "main",
      workspaceId: null,
      projectId: null,
      runtimeSessionId: null,
      source: "cwd",
      selectedAt: 1700000000000,
      ...overrides,
    };
  }

  it("reads empty list when no file exists", () => {
    expect(readRecentProjects()).toEqual([]);
  });

  it("records and reads back a project", () => {
    recordRecentProject(fakeActive());
    const list = readRecentProjects();
    expect(list).toHaveLength(1);
    expect(list[0].workspacePath).toBe("/home/user/my-project");
    expect(list[0].repositoryFullName).toBe("owner/my-project");
  });

  it("deduplicates by workspacePath and keeps newest first", () => {
    recordRecentProject(fakeActive({ selectedAt: 1000 }));
    recordRecentProject(fakeActive({ selectedAt: 2000 }));
    const list = readRecentProjects();
    expect(list).toHaveLength(1);
    expect(list[0].lastUsed).toBe(2000);
  });

  it("caps at MAX_RECENT (10) entries", () => {
    for (let i = 0; i < 15; i++) {
      recordRecentProject(
        fakeActive({
          workspacePath: `/home/user/proj-${i}`,
          selectedAt: 1000 + i,
        }),
      );
    }
    const list = readRecentProjects();
    expect(list.length).toBeLessThanOrEqual(10);
    // newest first
    expect(list[0].lastUsed).toBe(1014);
  });

  it("clears the list", () => {
    recordRecentProject(fakeActive());
    expect(readRecentProjects()).toHaveLength(1);
    clearRecentProjects();
    expect(readRecentProjects()).toEqual([]);
  });

  it("ignores a corrupt file", () => {
    fs.writeFileSync(process.env.LITT_RECENT_PROJECTS_FILE!, "not json{", "utf8");
    expect(readRecentProjects()).toEqual([]);
  });
});

// ─── buildActiveProject ────────────────────────────────────────────

describe("buildActiveProject — canonical identity construction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-build-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-app", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds identity from a detected ProjectInfo with no git", () => {
    const project = detectProject(tmpDir);
    const active = buildActiveProject(project, "cwd");
    expect(active.workspacePath).toBe(project.rootDir);
    expect(active.dirName).toBe(path.basename(tmpDir));
    expect(active.packageName).toBe("my-app");
    expect(active.repositoryId).toBeNull();
    expect(active.repositoryOwner).toBeNull();
    expect(active.repositoryFullName).toBeNull();
    expect(active.source).toBe("cwd");
  });

  it("merges remote workspace selection when provided", () => {
    const project = detectProject(tmpDir);
    const active = buildActiveProject(project, "remote", {
      workspaceId: "ws-123",
      projectId: "proj-456",
      root: tmpDir,
      branch: "main",
      selectedAt: 123,
    });
    expect(active.workspaceId).toBe("ws-123");
    expect(active.projectId).toBe("proj-456");
    expect(active.source).toBe("remote");
  });
});

// ─── activeProjectDisplay ──────────────────────────────────────────

describe("activeProjectDisplay — canonical display string", () => {
  it("shows 'owner/name · branch' when both present", () => {
    const active: ActiveProject = {
      workspacePath: "/x",
      dirName: "x",
      packageName: null,
      repositoryId: null,
      repositoryOwner: "LabsConnected",
      repositoryName: "litlabs-website",
      repositoryFullName: "LabsConnected/litlabs-website",
      branch: "main",
      workspaceId: null,
      projectId: null,
      runtimeSessionId: null,
      source: "cwd",
      selectedAt: 0,
    };
    expect(activeProjectDisplay(active)).toBe("LabsConnected/litlabs-website · main");
  });

  it("shows 'owner/name' when no branch", () => {
    const active: ActiveProject = {
      workspacePath: "/x",
      dirName: "x",
      packageName: null,
      repositoryId: null,
      repositoryOwner: "o",
      repositoryName: "n",
      repositoryFullName: "o/n",
      branch: null,
      workspaceId: null,
      projectId: null,
      runtimeSessionId: null,
      source: "cwd",
      selectedAt: 0,
    };
    expect(activeProjectDisplay(active)).toBe("o/n");
  });

  it("falls back to dirName when no repo identity", () => {
    const active: ActiveProject = {
      workspacePath: "/x",
      dirName: "my-app",
      packageName: null,
      repositoryId: null,
      repositoryOwner: null,
      repositoryName: null,
      repositoryFullName: null,
      branch: "dev",
      workspaceId: null,
      projectId: null,
      runtimeSessionId: null,
      source: "cwd",
      selectedAt: 0,
    };
    expect(activeProjectDisplay(active)).toBe("my-app · dev");
  });
});

// ─── scaffoldProject ───────────────────────────────────────────────

describe("scaffoldProject — minimal project creation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-scaffold-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a package.json in the target dir", () => {
    const ok = scaffoldProject(tmpDir, "my-new-app");
    expect(ok).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-new-app");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.private).toBe(true);
  });

  it("derives name from dir basename when not provided", () => {
    const ok = scaffoldProject(tmpDir);
    expect(ok).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf8"));
    expect(pkg.name).toBe(path.basename(tmpDir));
  });

  it("creates the directory if it does not exist", () => {
    const nested = path.join(tmpDir, "nested", "deep");
    const ok = scaffoldProject(nested, "deep-app");
    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(nested, "package.json"))).toBe(true);
  });
});

// ─── buildPickerChoices ────────────────────────────────────────────

describe("buildPickerChoices — picker list construction", () => {
  it("lists discovered projects plus a create-new option", () => {
    const choices = buildPickerChoices(
      [
        { root: "/home/u/proj-a", name: "proj-a", branch: "main", source: "recent" },
        { root: "/home/u/proj-b", name: "proj-b", branch: null, source: "home" },
      ],
      "/home/u",
    );
    expect(choices).toHaveLength(3);
    expect(choices[0].label).toBe("proj-a");
    expect(choices[0].isCreateNew).toBe(false);
    expect(choices[2].isCreateNew).toBe(true);
    expect(choices[2].root).toBe(path.resolve("/home/u"));
  });

  it("still offers create-new when nothing discovered", () => {
    const choices = buildPickerChoices([], "/home/u");
    expect(choices).toHaveLength(1);
    expect(choices[0].isCreateNew).toBe(true);
  });
});

// ─── runProjectPicker ──────────────────────────────────────────────

describe("runProjectPicker — interactive selection", () => {
  it("returns the chosen project root for a numeric answer", async () => {
    const result = await runProjectPicker(
      [{ root: "/home/u/proj-a", name: "proj-a", branch: "main", source: "recent" }],
      "/home/u",
      {
        promptFn: async () => "1",
        outputFn: () => {},
      },
    );
    expect(result).toEqual({ root: "/home/u/proj-a", createNew: false });
  });

  it("returns createNew=true for the last choice (create new)", async () => {
    const result = await runProjectPicker(
      [{ root: "/home/u/proj-a", name: "proj-a", branch: "main", source: "recent" }],
      "/home/u",
      {
        promptFn: async () => "2",
        outputFn: () => {},
      },
    );
    expect(result).toEqual({ root: path.resolve("/home/u"), createNew: true });
  });

  it("returns null when user types 'q'", async () => {
    const result = await runProjectPicker(
      [{ root: "/home/u/proj-a", name: "proj-a", branch: "main", source: "recent" }],
      "/home/u",
      {
        promptFn: async () => "q",
        outputFn: () => {},
      },
    );
    expect(result).toBeNull();
  });

  it("returns null for an out-of-range or invalid answer", async () => {
    const result = await runProjectPicker(
      [{ root: "/home/u/proj-a", name: "proj-a", branch: "main", source: "recent" }],
      "/home/u",
      {
        promptFn: async () => "99",
        outputFn: () => {},
      },
    );
    expect(result).toBeNull();
  });

  it("returns null for empty input (non-TTY)", async () => {
    const result = await runProjectPicker(
      [{ root: "/home/u/proj-a", name: "proj-a", branch: "main", source: "recent" }],
      "/home/u",
      {
        promptFn: async () => "",
        outputFn: () => {},
      },
    );
    expect(result).toBeNull();
  });
});

// ─── resolveActiveProject — the full pipeline ──────────────────────

describe("resolveActiveProject — canonical resolution pipeline", () => {
  let tmpHome: string;
  let tmpRoot: string;
  const prevFile = process.env.LITT_RECENT_PROJECTS_FILE;
  const prevRemoteFile = process.env.LITT_REMOTE_WORKSPACE_FILE;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "litt-resolve-home-"));
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "litt-resolve-root-"));
    process.env.LITT_RECENT_PROJECTS_FILE = path.join(tmpHome, "recent-projects.json");
    process.env.LITT_REMOTE_WORKSPACE_FILE = path.join(tmpHome, "remote-workspace.json");
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (prevFile === undefined) delete process.env.LITT_RECENT_PROJECTS_FILE;
    else process.env.LITT_RECENT_PROJECTS_FILE = prevFile;
    if (prevRemoteFile === undefined) delete process.env.LITT_REMOTE_WORKSPACE_FILE;
    else process.env.LITT_REMOTE_WORKSPACE_FILE = prevRemoteFile;
  });

  it("step 1: opens cwd immediately when it is a valid project", async () => {
    fs.writeFileSync(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "cwd-project" }),
    );
    const resolved = await resolveActiveProject({
      cwd: tmpRoot,
      skipRecord: true,
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.active.source).toBe("cwd");
    expect(resolved!.active.workspacePath).toBe(tmpRoot);
    expect(resolved!.active.packageName).toBe("cwd-project");
  });

  it("step 2: auto-selects the single valid recent project", async () => {
    // cwd has no project
    const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "litt-empty-"));
    try {
      // one recent project that exists
      const recentDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-recent-proj-"));
      fs.writeFileSync(
        path.join(recentDir, "package.json"),
        JSON.stringify({ name: "recent-project" }),
      );
      recordRecentProject({
        workspacePath: recentDir,
        repositoryFullName: null,
        branch: "main",
        selectedAt: Date.now(),
        dirName: "litt-recent-proj-",
        packageName: "recent-project",
        repositoryId: null,
        repositoryOwner: null,
        repositoryName: null,
        workspaceId: null,
        projectId: null,
        runtimeSessionId: null,
        source: "recent",
      });

      const resolved = await resolveActiveProject({
        cwd: emptyCwd,
        skipRecord: true,
      });
      expect(resolved).not.toBeNull();
      expect(resolved!.active.source).toBe("recent");
      expect(resolved!.active.workspacePath).toBe(recentDir);
      fs.rmSync(recentDir, { recursive: true, force: true });
    } finally {
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it("step 3: uses the picker when multiple/no recent projects", async () => {
    const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "litt-empty2-"));
    const pickable = fs.mkdtempSync(path.join(os.tmpdir(), "litt-pickable-"));
    fs.writeFileSync(
      path.join(pickable, "package.json"),
      JSON.stringify({ name: "pickable-project" }),
    );
    try {
      // Seed recent with the pickable dir so it appears as choice 1,
      // then pick 1. (Deterministic — doesn't depend on home-dir scan.)
      recordRecentProject({
        workspacePath: pickable,
        repositoryFullName: null,
        branch: null,
        selectedAt: Date.now(),
        dirName: "litt-pickable-",
        packageName: "pickable-project",
        repositoryId: null,
        repositoryOwner: null,
        repositoryName: null,
        workspaceId: null,
        projectId: null,
        runtimeSessionId: null,
        source: "recent",
      });

      const resolved = await resolveActiveProject({
        cwd: emptyCwd,
        promptFn: async () => "1",
        outputFn: () => {},
        skipRecord: true,
      });
      expect(resolved).not.toBeNull();
      expect(resolved!.active.workspacePath).toBe(pickable);
    } finally {
      fs.rmSync(emptyCwd, { recursive: true, force: true });
      fs.rmSync(pickable, { recursive: true, force: true });
    }
  });

  it("step 4: scaffold fallback creates a new project when chosen", async () => {
    // Use a nested cwd inside a unique temp parent so that sibling-dir
    // discovery (which scans siblings of cwd) only sees the parent's
    // children — NOT every other parallel test's temp dir in os.tmpdir().
    const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), "litt-scaffold-parent-"));
    const emptyCwd = path.join(tempParent, "empty-cwd");
    fs.mkdirSync(emptyCwd, { recursive: true });
    try {
      // Build choices deterministically: discover first, then prompt
      // for the LAST index (create-new is always the final choice).
      const discovered = discoverProjects(emptyCwd);
      const choices = buildPickerChoices(discovered, emptyCwd);
      const createNewIndex = choices.findIndex((c) => c.isCreateNew);
      const promptAnswer = String(createNewIndex + 1);

      const resolved = await resolveActiveProject({
        cwd: emptyCwd,
        promptFn: async () => promptAnswer,
        outputFn: () => {},
        skipRecord: true,
      });
      expect(resolved).not.toBeNull();
      expect(resolved!.active.source).toBe("scaffolded");
      expect(fs.existsSync(path.join(emptyCwd, "package.json"))).toBe(true);
    } finally {
      fs.rmSync(tempParent, { recursive: true, force: true });
    }
  });

  it("returns null when user quits the picker", async () => {
    const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "litt-quit-"));
    try {
      const resolved = await resolveActiveProject({
        cwd: emptyCwd,
        promptFn: async () => "q",
        outputFn: () => {},
        skipRecord: true,
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it("returns null in non-interactive mode when no project in cwd", async () => {
    const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "litt-nonint-"));
    try {
      const resolved = await resolveActiveProject({
        cwd: emptyCwd,
        nonInteractive: true,
        skipRecord: true,
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it("records the resolved project to recent-projects", async () => {
    fs.writeFileSync(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "record-me" }),
    );
    await resolveActiveProject({ cwd: tmpRoot, skipRecord: false });
    const list = readRecentProjects();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((e) => e.workspacePath === tmpRoot)).toBe(true);
  });
});

// ─── discoverProjects — bounded auto-discovery ─────────────────────

describe("discoverProjects — bounded auto-discovery", () => {
  let tmpHome: string;
  const prevFile = process.env.LITT_RECENT_PROJECTS_FILE;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "litt-disc-home-"));
    process.env.LITT_RECENT_PROJECTS_FILE = path.join(tmpHome, "recent-projects.json");
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (prevFile === undefined) delete process.env.LITT_RECENT_PROJECTS_FILE;
    else process.env.LITT_RECENT_PROJECTS_FILE = prevFile;
  });

  it("discovers a project in a cwd subdirectory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "litt-disc-root-"));
    const sub = path.join(root, "my-app");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "package.json"), JSON.stringify({ name: "my-app" }));
    try {
      const found = discoverProjects(root);
      expect(found.some((p) => p.root === sub)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips node_modules and dotdirs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "litt-skip-"));
    const nm = path.join(root, "node_modules", "some-pkg");
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, "package.json"), JSON.stringify({ name: "some-pkg" }));
    try {
      const found = discoverProjects(root);
      expect(found.some((p) => p.root === nm)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes validated recent projects", () => {
    const recent = fs.mkdtempSync(path.join(os.tmpdir(), "litt-recent-disc-"));
    fs.writeFileSync(path.join(recent, "package.json"), JSON.stringify({ name: "recent" }));
    try {
      recordRecentProject({
        workspacePath: recent,
        repositoryFullName: null,
        branch: null,
        selectedAt: Date.now(),
        dirName: "litt-recent-disc-",
        packageName: "recent",
        repositoryId: null,
        repositoryOwner: null,
        repositoryName: null,
        workspaceId: null,
        projectId: null,
        runtimeSessionId: null,
        source: "recent",
      });
      const found = discoverProjects(os.tmpdir());
      expect(found.some((p) => p.root === recent && p.source === "recent")).toBe(true);
    } finally {
      fs.rmSync(recent, { recursive: true, force: true });
    }
  });

  it("skips recent projects that no longer exist", () => {
    recordRecentProject({
      workspacePath: "/this/path/does/not/exist",
      repositoryFullName: null,
      branch: null,
      selectedAt: Date.now(),
      dirName: "nope",
      packageName: null,
      repositoryId: null,
      repositoryOwner: null,
      repositoryName: null,
      workspaceId: null,
      projectId: null,
      runtimeSessionId: null,
      source: "recent",
    });
    const found = discoverProjects(os.tmpdir());
    expect(found.some((p) => p.root === "/this/path/does/not/exist")).toBe(false);
  });
});
