const { generateText, tool } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');
const { z } = require('zod');

const openai = createOpenAI({
  apiKey: "sk-proj-test"
});

// We can just simulate the object by reading the ai source code if needed.
// But actually, I just want to log what the Vercel AI SDK types look like.
