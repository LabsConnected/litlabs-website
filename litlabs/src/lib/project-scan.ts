import projectTree from "../../public/project-tree.json";

export function getProjectFiles(): { tree: string[]; contents: Map<string, string> } {
  return {
    tree: projectTree.tree,
    contents: new Map(Object.entries(projectTree.contents)),
  };
}
