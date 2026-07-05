import { generateText, isStepCount } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'dummy'
});

async function main() {
  try {
    const { text } = await generateText({
      model: openai.chat('gpt-4o-mini'),
      prompt: 'test',
      stopWhen: isStepCount(5),
    });
    console.log(text);
  } catch (e) {
    console.error("CAUGHT ERROR:", e.message);
  }
}
main();
