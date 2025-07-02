import "dotenv/config";
import { sendEveningPrompt } from "../src/scheduler.js";

export default async function handler(req, res) {
  try {
    await sendEveningPrompt();
    return res.status(200).send("Evening prompt sent");
  } catch (err) {
    console.error("Error in sendEveningPrompt:", err);
    return res.status(500).send("Failed to send evening prompt");
  }
}
