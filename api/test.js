export default async function handler(req, res) {
  try {
    return res.status(200).send("Morning prompt sent");
  } catch (err) {
    console.error("Error in sendMorningPrompt:", err);
  }
}