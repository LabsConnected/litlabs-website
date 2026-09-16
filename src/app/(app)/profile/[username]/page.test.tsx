import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import UserProfilePage from "./page";

async function renderProfile(username: string) {
  return render(
    await UserProfilePage({ params: Promise.resolve({ username }) }),
  );
}

describe("profile [username] page", () => {
  it("renders an honest not-found state for any username", async () => {
    await renderProfile("mallory");
    expect(screen.getByText(/doesn.t exist yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/community profiles are coming soon/i),
    ).toBeInTheDocument();
  });

  it("never fabricates a person: no follower counts, badges, or websites", async () => {
    const { container } = await renderProfile("mallory");
    const text = container.textContent ?? "";
    expect(text).not.toContain("mallory.litlabs.net");
    expect(screen.queryByText(/followers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it("links somewhere real instead of the fake person's actions", async () => {
    await renderProfile("mallory");
    expect(
      screen.getByRole("link", { name: /browse discover/i }),
    ).toHaveAttribute("href", "/discover");
  });
});
