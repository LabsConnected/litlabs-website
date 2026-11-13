import { task } from "@trigger.dev/sdk";

export const helloWorld = task({
  id: "hello-world",
  run: async (payload: { name?: string }) => {
    const name = payload.name ?? "world";
    console.log(`Hello, ${name}!`);
    return { message: `Hello, ${name}!` };
  },
});
