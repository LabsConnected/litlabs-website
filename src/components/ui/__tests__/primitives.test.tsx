import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "../Button";
import { Input } from "../Input";
import { Textarea } from "../Textarea";
import { Dialog, DialogTitle, DialogDescription, DialogActions } from "../Dialog";
import { Badge } from "../Badge";
import { Tabs } from "../Tabs";
import { littTokens, PRIMARY_ACCENT_DECISION } from "@/lib/design/litt-tokens";

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

describe("litt-tokens", () => {
  it("contains no pink anywhere in the token map", () => {
    const pink = /(?:#(?:ec4899|f472b6|e879f9|d946ef|ff00a0|ff2d8a)|pink|fuchsia|magenta|\brose\b)/i;
    const hits = collectStrings(littTokens).filter((s) => pink.test(s));
    expect(hits).toEqual([]);
  });

  it("pins the primary accent decision: lime, decided", () => {
    expect(PRIMARY_ACCENT_DECISION.status).toBe("decided");
    expect(PRIMARY_ACCENT_DECISION.current).toBe("lime");
    // brand.primary resolves to the decided lime candidate.
    expect(littTokens.brand.primary.DEFAULT).toBe("#a8ff2f");
    expect(littTokens.brand.candidates.lime.DEFAULT).toBe("#a8ff2f");
  });

  it("exposes one radius scale, one duration scale, one z scale", () => {
    expect(littTokens.radius).toEqual({
      sm: "8px",
      md: "12px",
      lg: "16px",
      xl: "24px",
      full: "9999px",
    });
    expect(Object.keys(littTokens.motion.duration)).toEqual(["fast", "normal", "slow"]);
    expect(littTokens.z.modal).toBeGreaterThan(littTokens.z.overlay);
  });

  it("documents legacy replacements for the six old systems", () => {
    expect(Object.keys(littTokens.legacyReplacements).length).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

describe("Button", () => {
  it("renders children and defaults to type=button", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("applies the primary variant and 44px minimum touch target", () => {
    render(<Button variant="primary">Go</Button>);
    const btn = screen.getByRole("button", { name: "Go" });
    // J1 lime accent — never cyan. Primary = full interaction chain.
    expect(btn.className).toContain("bg-accent");
    expect(btn.className).toContain("text-on-accent");
    expect(btn.className).toContain("hover:bg-accent-strong");
    expect(btn.className).toContain("active:bg-accent-strong");
    expect(btn.className).toContain("shadow-accent-glow");
    expect(btn.className).toContain("focus-visible:ring-accent/50");
    expect(btn.className).not.toContain("cyan");
    expect(btn.className).toContain("min-h-[44px]");
  });

  it("keeps secondary neutral and destructive/violet in their own semantics", () => {
    const { unmount } = render(<Button variant="secondary">Cancel</Button>);
    const secondary = screen.getByRole("button", { name: "Cancel" });
    expect(secondary.className).toContain("bg-white/10");
    // Neutral surface: no accent fill or accent text (the shared focus ring still uses ring-accent/50).
    expect(secondary.className).not.toContain("bg-accent");
    expect(secondary.className).not.toContain("text-accent");
    unmount();

    render(<Button variant="danger">Delete</Button>);
    const danger = screen.getByRole("button", { name: "Delete" });
    expect(danger.className).toContain("bg-red-500/15");
    expect(danger.className).toContain("text-red-300");
    // Destructive semantics stay red — no accent fill.
    expect(danger.className).not.toContain("bg-accent");
    unmount();

    render(<Button variant="violet">Spark</Button>);
    const violet = screen.getByRole("button", { name: "Spark" });
    // Restrained violet per J1 — creative/spark only, never the primary CTA.
    expect(violet.className).toContain("bg-violet-400/15");
    expect(violet.className).not.toContain("pink");
    expect(violet.className).not.toContain("fuchsia");
    unmount();

    // Focus ring is visible on every variant via the shared base classes.
    render(<Button variant="ghost">Back</Button>);
    const ghost = screen.getByRole("button", { name: "Back" });
    expect(ghost.className).toContain("focus-visible:ring-accent/50");
    unmount();

    // Disabled state stays legible: opacity + shadow removal, no accent loss of affordance.
    render(<Button variant="primary" disabled>Wait</Button>);
    const disabled = screen.getByRole("button", { name: "Wait" });
    expect(disabled.className).toContain("disabled:opacity-50");
    expect(disabled.className).toContain("disabled:cursor-not-allowed");
  });

  it("disabled buttons do not fire onClick", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nope" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading state disables the button and sets aria-busy", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Saving" });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Input / Textarea                                                    */
/* ------------------------------------------------------------------ */

describe("Input", () => {
  it("associates the label with the input", () => {
    render(<Input label="Email" placeholder="you@litlabs.net" />);
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("surfaces errors with role=alert and aria-invalid", () => {
    render(<Input label="Email" error="Enter a valid email" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Enter a valid email");
  });

  it("uses the lime accent for focus, never cyan or hardcoded rgba", () => {
    render(<Input label="Email" placeholder="you@litlabs.net" />);
    const input = screen.getByLabelText("Email");
    expect(input.className).toContain("focus-visible:border-accent/60");
    expect(input.className).toContain("focus-visible:ring-accent/40");
    expect(input.className).not.toContain("cyan");
    expect(input.className).not.toContain("168,255,47");
    expect(input.className).not.toContain("lime-300");
  });

  it("renders hint text when there is no error", () => {
    render(<Input label="Name" hint="Shown on your profile" />);
    expect(screen.getByText("Shown on your profile")).toBeTruthy();
  });
});

describe("Textarea", () => {
  it("associates the label and honors rows", () => {
    render(<Textarea label="Bio" rows={6} />);
    const area = screen.getByLabelText("Bio");
    expect(area.getAttribute("rows")).toBe("6");
  });

  it("surfaces errors with role=alert", () => {
    render(<Textarea label="Bio" error="Too short" />);
    expect(screen.getByRole("alert").textContent).toBe("Too short");
  });
});

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Dialog open={false} onClose={() => {}}>
        <DialogTitle>Hi</DialogTitle>
      </Dialog>,
    );
    expect(container.textContent).toBe("");
  });

  it("renders an aria-modal dialog with the title labelled", () => {
    render(
      <Dialog open onClose={() => {}}>
        <DialogTitle>Delete project?</DialogTitle>
        <DialogDescription>This cannot be undone.</DialogDescription>
        <DialogActions>
          <Button variant="danger">Delete</Button>
        </DialogActions>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = screen.getByText("Delete project?");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.getAttribute("id"));
    expect(title.getAttribute("id")).toBeTruthy();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogTitle>Hi</DialogTitle>
      </Dialog>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogTitle>Hi</DialogTitle>
      </Dialog>,
    );
    fireEvent.click(screen.getByTestId("litt-dialog-backdrop").firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on backdrop click when disableBackdropClose", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} disableBackdropClose>
        <DialogTitle>Hi</DialogTitle>
      </Dialog>,
    );
    fireEvent.click(screen.getByTestId("litt-dialog-backdrop").firstElementChild!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps focus: shift+tab on first element wraps to last", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogTitle>Hi</DialogTitle>
        <DialogActions>
          <Button>Cancel</Button>
          <Button variant="primary">Confirm</Button>
        </DialogActions>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    const buttons = Array.from(dialog.querySelectorAll("button")).filter(
      (b) => b.getAttribute("tabindex") !== "-1",
    );
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the trigger on close", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Trigger</button>
        <Dialog open={false} onClose={onClose}>
          <DialogTitle>Hi</DialogTitle>
        </Dialog>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.focus();
    rerender(
      <>
        <button type="button">Trigger</button>
        <Dialog open onClose={onClose}>
          <DialogTitle>Hi</DialogTitle>
        </Dialog>
      </>,
    );
    rerender(
      <>
        <button type="button">Trigger</button>
        <Dialog open={false} onClose={onClose}>
          <DialogTitle>Hi</DialogTitle>
        </Dialog>
      </>,
    );
    expect(document.activeElement).toBe(trigger);
  });
});

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

describe("Badge", () => {
  it("renders the primary variant with the J1 lime accent", () => {
    render(<Badge variant="primary">Beta</Badge>);
    const badge = screen.getByText("Beta");
    expect(badge.className).toContain("text-accent");
    expect(badge.className).toContain("bg-accent/15");
    expect(badge.className).toContain("border-accent/30");
    expect(badge.className).not.toContain("cyan");
  });

  it("defaults to neutral", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New").className).toContain("text-white/75");
  });
});

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: "one", label: "One" },
  { id: "two", label: "Two" },
  { id: "three", label: "Three", disabled: true },
];

describe("Tabs", () => {
  it("selects the first tab by default and switches on click", () => {
    render(<Tabs tabs={TABS} />);
    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    expect(one.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(two);
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(one.getAttribute("aria-selected")).toBe("false");
  });

  it("styles the selected tab with the lime accent, not cyan", () => {
    render(<Tabs tabs={TABS} />);
    const one = screen.getByRole("tab", { name: "One" });
    expect(one.className).toContain("bg-accent/15");
    expect(one.className).toContain("text-accent");
    expect(one.className).toContain("ring-accent/40");
    expect(one.className).not.toContain("cyan");
    const two = screen.getByRole("tab", { name: "Two" });
    // Unselected tabs stay neutral — no selected-state accent styling
    // (the shared focus-visible ring still uses ring-accent/50).
    expect(two.className).not.toContain("bg-accent");
    expect(two.className).not.toContain("text-accent");
    expect(two.className).not.toContain("ring-accent/40");
  });

  it("supports controlled value + onChange", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value="two" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "One" }));
    expect(onChange).toHaveBeenCalledWith("one");
  });

  it("moves selection with arrow keys", () => {
    render(<Tabs tabs={TABS} />);
    const one = screen.getByRole("tab", { name: "One" });
    one.focus();
    fireEvent.keyDown(one, { key: "ArrowRight" });
    const two = screen.getByRole("tab", { name: "Two" });
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(two);
  });

  it("skips disabled tabs in keyboard navigation", () => {
    render(<Tabs tabs={TABS} />);
    const two = screen.getByRole("tab", { name: "Two" });
    two.focus();
    fireEvent.keyDown(two, { key: "ArrowRight" });
    // "Three" is disabled → wraps to "One".
    expect(screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected")).toBe("true");
  });
});
