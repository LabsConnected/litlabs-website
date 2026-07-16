#!/usr/bin/env node

import React from "react";
import process from "node:process";
import { Command } from "commander";
import { render } from "ink";
import { askLiTTCode } from "@litt/agent-core";
import { App } from "./ui/App.js";

const program = new Command();

program
  .name("litt")
  .description("LiTT Code — AI development agent for your terminal")
  .version("0.1.0")
  .option("-m, --model <model>", "Model to use", "auto")
  .option(
    "--mode <mode>",
    "Permission mode: plan, act, or auto",
    "act",
  )
  .option("-p, --print <prompt>", "Run one prompt without opening the UI")
  .option("--cwd <directory>", "Working directory", process.cwd())
  .action(async (options) => {
    if (options.print) {
      const model = options.model === "auto" ? undefined : options.model;
      try {
        const reply = await askLiTTCode(options.print, model);
        console.log(reply);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
      return;
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(
        "Interactive mode requires a terminal. Use litt --print \"your task\" for headless mode.",
      );
      process.exitCode = 1;
      return;
    }

    render(
      <App
        cwd={options.cwd}
        model={options.model}
        mode={options.mode}
      />,
    );
  });

await program.parseAsync(process.argv);
