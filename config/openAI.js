// filepath: /path/to/openAI.js
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function createCompletion() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      store: true,
      messages: [{ role: "user", content: "write a haiku about ai" }],
    });
    console.log(completion.choices[0].message.content);
    return completion;
  } catch (error) {
    if (error.code === "insufficient_quota") {
      console.error("Quota exceeded. Please upgrade your plan.");
    } else {
      console.error("An error occurred:", error.message);
    }
  }
}

createCompletion();

export { openai };
