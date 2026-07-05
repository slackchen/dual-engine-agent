import { generateObject, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const openai = createOpenAI({
  baseURL: 'https://token.sensenova.cn/v1',
  apiKey: 'sk-c6y7XWYtUUWld5JCaUGBGUUEHbaPDxtt'
});

async function run() {
  console.log("Testing generateText...");
  try {
    const textRes = await generateText({
      model: openai.chat('sensenova-6.7-flash-lite'),
      prompt: 'Say hello'
    });
    console.log("generateText Result:", textRes.text);
  } catch (e) {
    console.error("generateText failed:", e);
  }
}

run();
