import { simpleGit, type SimpleGit } from "simple-git";

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  staged: Array<{ path: string; status: string }>;
  modified: Array<{ path: string; status: string }>;
  untracked: string[];
  clean: boolean;
}

export async function gitStatus(root: string): Promise<GitStatusResult> {
  const git: SimpleGit = simpleGit(root);
  const status = await git.status();
  const branch = status.current ?? "main";
  const staged: Array<{ path: string; status: string }> = [];
  const modified: Array<{ path: string; status: string }> = [];
  const untracked: string[] = [];

  for (const file of status.files) {
    if (file.index === "?" && file.working_dir === "?") {
      untracked.push(file.path);
    } else {
      const entry = { path: file.path, status: `${file.index}${file.working_dir}` };
      if (file.index !== " " && file.index !== "?") {
        staged.push(entry);
      } else {
        modified.push(entry);
      }
    }
  }

  return {
    branch,
    ahead: status.ahead,
    behind: status.behind,
    staged,
    modified,
    untracked,
    clean: status.isClean(),
  };
}
