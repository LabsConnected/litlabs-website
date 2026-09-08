import { describe, expect, it } from "vitest";
import { createToolCallStreamFilter } from "../lib/tool-call-stream.js";

function filterStream(chunks: string[]): string {
  const filter = createToolCallStreamFilter();
  let output = "";

  for (const chunk of chunks) {
    output += filter.next(chunk);
  }

  output += filter.flush();
  return output;
}

describe("tool-call stream regressions", () => {
  it("suppresses protocol line followed by bare tool JSON", () => {
    const output = filterStream([
      "Before\n",
      "tool_call\n",
      '{"tool":"project.status","inputs":{}}\n',
      "After",
    ]);

    expect(output).toContain("Before");
    expect(output).toContain("After");
    expect(output).not.toContain("tool_call");
    expect(output).not.toContain("project.status");
    expect(output).not.toContain('"inputs"');
  });

  it("suppresses tool JSON split across deltas", () => {
    const output = filterStream([
      "Hello\n",
      '{"tool":"project.',
      'status","inputs":{',
      "}}",
      "\nWorld",
    ]);

    expect(output).toContain("Hello");
    expect(output).toContain("World");
    expect(output).not.toContain("project.status");
    expect(output).not.toContain('"inputs"');
  });

  it("flushes normal prose withheld at stream end", () => {
    const output = filterStream(["LITT_TUI_OK"]);
    expect(output).toBe("LITT_TUI_OK");
  });
});
