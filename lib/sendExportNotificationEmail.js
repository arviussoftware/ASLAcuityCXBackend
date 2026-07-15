// lib/sendExportNotificationEmail.js
import nodemailer from "nodemailer";
import path from "path";

const MAX_DOWNLOAD_RECORDINGS = 2000;
const BULK_DOWNLOAD_DIR =
  process.env.BULK_DOWNLOAD_PATH || "C:\\interaction_download";

export async function sendExportNotificationEmail({
  userEmail,
  userName,
  downloadCount,
  capped,
  dateRangeLabel,
  archiveFileName,
  totalMatching,
  downloadType,
  notRetrievedCount = 0,
}) {
  if (!userEmail) return;

  const downloadPath = path.join(BULK_DOWNLOAD_DIR, archiveFileName);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: false,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  await transporter.sendMail({
    from: `"Verify ASL AcuityCx" <${process.env.SMTP_USER}>`,
    to: userEmail,
    subject: "Your interactions export is ready",
    html: `
      <p>Hi ${userName || "there"},</p>
      <p>Your interactions export has finished downloading.</p>
      ${dateRangeLabel ? `<p><strong>Date Range:</strong> ${dateRangeLabel}</p>` : ""}
      <p><strong>Total Calls Matched:</strong> ${totalMatching}</p>
      <p><strong>Downloaded:</strong> ${downloadCount} recording(s)</p>
      ${notRetrievedCount > 0 ? `<p><strong>Skipped (still in Glacier):</strong> ${notRetrievedCount} recording(s) hadn't finished restoring yet and were not included. Restore them and try again.</p>` : ""}
      ${capped ? `<p>Only the first ${MAX_DOWNLOAD_RECORDINGS} recordings were exported because of the download limit.</p>` : ""}
      <p><strong>Download Type:</strong> ${downloadType === "selected" ? "Selected calls" : "Download all"}</p>
      <p><strong>Saved ZIP Path:</strong> ${downloadPath}</p>
      <p>Please use the saved ZIP path above if you need the archived copy.</p>
      <p><strong>Note:</strong> These exported recordings will be automatically deleted after 24 hours.</p>
    `,
  });
}
