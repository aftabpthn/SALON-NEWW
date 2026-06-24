export function sendDailyReportEmails() {
  console.log("[DailyReportEmail] No implementation yet");
}

if (!globalThis.__auraDailyReportEmailJobStarted) {
  globalThis.__auraDailyReportEmailJobStarted = true;
  sendDailyReportEmails();
}
