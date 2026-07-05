const { generateText, tool } = require('ai');
const { z } = require('zod');
const { createOpenAI } = require('@ai-sdk/openai');

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  const result = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: 'Use the failing tool',
    tools: {
      failingTool: tool({
        description: 'Always fails',
        parameters: z.object({ input: z.string() }),
        execute: async () => {
          return { success: false, error: 'Failed' };
        }
      })
    },
    stopWhen: (args) => {
      console.log('stopWhen called with:', JSON.stringify(args, null, 2));
      return args.steps.length >= 3;
    }
  });
  console.log(result.text);
}

main().catch(console.error);
