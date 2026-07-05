import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const openai = createOpenAI({
  baseURL: 'https://token.sensenova.cn/v1',
  apiKey: 'sk-c6y7XWYtUUWld5JCaUGBGUUEHbaPDxtt'
});

async function run() {
  console.log("Testing generateObject with json mode...");
  try {
    const objRes = await generateObject({
      model: openai.chat('glm-5.2'),
      mode: 'json',
      schema: z.object({ response: z.string() }),
      prompt: 'Say hello in json'
    });
    console.log("Result:", objRes.object);
  } catch (e) {
    console.error("Failed:", e);
  }
}

run();
