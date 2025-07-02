import "dotenv/config";
import { sendMorningPrompt } from "../src/scheduler.js";

export default async function handler(req, res) {
  try {
    await sendMorningPrompt();
    return res.status(200).send("Morning prompt sent");
  } catch (err) {
    console.error("Error in sendMorningPrompt:", err);
    return res.status(500).send("Failed to send morning prompt");
  }
}
