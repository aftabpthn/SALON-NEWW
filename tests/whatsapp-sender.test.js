import { sendWhatsAppMessage, sendAndTrack } from "../server/services/whatsapp/whatsapp-sender.service.js";

const tests = [
  ["send text (local)", () => sendWhatsAppMessage("919876543210", "Hello from test", {})],
  ["send with template", () => sendWhatsAppMessage("919876543210", "", { templateName: "booking_confirmation", language: "en", templateParams: ["Guest", "Haircut", "25 Jun"] })],
  ["send to empty phone", () => sendWhatsAppMessage("", "hello", {})],
];

for (const [name, fn] of tests) {
  try {
    const result = await fn();
    console.log(`OK ${name}:`, JSON.stringify(result));
  } catch (err) {
    console.log(`FAIL ${name}:`, err.message);
  }
}
