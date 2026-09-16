export const DEFAULT_PROJECT_NAME = "My new project";

export function validateProjectName(value: string): string | null {
  const name = value.trim();
  if (!name) return "Enter a project name.";
  if (name.length > 120) return "Project names must be 120 characters or fewer.";
  return null;
}

export function normalizeProjectName(value: string): string {
  const name = value.trim();
  const error = validateProjectName(name);
  if (error) throw new Error(error);
  return name;
}
