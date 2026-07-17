// lib/sendExportNotificationEmail.js
import nodemailer from "nodemailer";
import { logWarning } from "@/lib/errorLogger";

const MAX_DOWNLOAD_RECORDINGS = Number(process.env.MAX_EXPORT_LIMIT || 2000);

export async function sendExportNotificationEmail({
  userEmail,
  userName,
  downloadCount = 0,
  capped,
  dateRangeLabel,
  totalMatching = 0,
  downloadType,
  notRetrievedCount = 0,
  notificationType = "downloaded",
}) {
  if (!userEmail) {
    await logWarning(
      "sendExportNotificationEmail",
      "Skipped sending export email - no userEmail was provided.",
      { userName, downloadCount, downloadType, notificationType },
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: false,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // TLS certificate validation enabled (rejectUnauthorized defaults to true)
  });

  const isRestoration = notificationType === "restoration";
  const downloadedText =
    downloadCount > 0
      ? `<p>${downloadCount} recording(s) were downloaded successfully. Please review the calls in your browser's Downloads folder.</p>`
      : "";
  const restorationText =
    notRetrievedCount > 0
      ? `<p>${notRetrievedCount} recording(s) are under restoration from archive storage. Please check again after 12 to 48 hours to download or play the audio/call.</p>`
      : "";

  await transporter.sendMail({
    from: `"Verify ASL AcuityCx" <${process.env.SMTP_USER}>`,
    to: userEmail,
    subject: isRestoration
      ? "Your calls are under restoration"
      : "Your calls have been downloaded",
    html: `
      <p>Hi ${userName || "there"},</p>
      ${
        isRestoration
          ? "<p>Your calls are under restoration.</p>"
          : "<p>Your calls have been downloaded successfully.</p>"
      }
      ${downloadedText}
      ${restorationText}
      ${dateRangeLabel ? `<p><strong>Date Range:</strong> ${dateRangeLabel}</p>` : ""}
      <p><strong>Total Calls Matched:</strong> ${totalMatching}</p>
      <p><strong>Downloaded:</strong> ${downloadCount} recording(s)</p>
      ${notRetrievedCount > 0 ? `<p><strong>Under Restoration:</strong> ${notRetrievedCount} recording(s)</p>` : ""}
      ${capped ? `<p>Only the first ${MAX_DOWNLOAD_RECORDINGS} recordings were exported because of the download limit.</p>` : ""}
      <p><strong>Download Type:</strong> ${downloadType === "selected" ? "Selected calls" : "Download all"}</p>
      ${
        isRestoration
          ? "<p>Once restoration is complete, return to the app and download or play the call again.</p>"
          : "<p>If the download did not start automatically, please return to the app and try again.</p>"
      }
    `,
  });
}
