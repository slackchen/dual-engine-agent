import { generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const openai = createOpenAI({
  apiKey: "sk-proj-test"
});

async function main() {
  await generateText({
    model: openai('gpt-4o-mini'),
    prompt: 'Read file game.html',
    tools: {
      readFile: tool({
        description: 'Read a file',
        parameters: z.object({ filePath: z.string() }),
        execute: async ({ filePath }) => "content"
      })
    },
    onStepFinish: (event) => {
      const tc = event.toolCalls[0];
      console.log("Raw tool call:", tc);
      console.log("Args:", tc.args);
      console.log("Stringified:", JSON.stringify(tc));
    }
  }).catch(e => {
    // Expected to fail on API key, but we might not even get there?
    // Actually we can just mock a tool call.
  });
}
main();
