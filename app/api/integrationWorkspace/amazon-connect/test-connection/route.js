import { NextResponse } from "next/server";
import { ConnectClient, SearchContactsCommand } from "@aws-sdk/client-connect";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

function parseRegionFromConnectUrl(url) {
  try {
    const host = new URL(url).host;
    const match = host.match(/^connect\.([a-z0-9-]+)\.amazonaws\.com$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function normalizeAwsRegion(regionValue, connectUrl) {
  const raw = String(regionValue ?? "").trim();
  if (raw) {
    if (/^[a-z]{2}-[a-z]+-\d$/i.test(raw)) return raw;
    const derived = parseRegionFromConnectUrl(raw.startsWith("http") ? raw : `https://${raw}`);
    if (derived) return derived;
  }
  const derivedFromUrl = connectUrl ? parseRegionFromConnectUrl(connectUrl) : null;
  return derivedFromUrl || null;
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const {
      Intance_Id,
      InstanceId,
      Start_Time,
      End_Time,
      AccessKey,
      SecretKey,
      connectUrl,
      TimeRange,
      AWSRegion,
      ServiceName,
    } = body || {};

    const instanceId = InstanceId || Intance_Id;
    if (!instanceId) {
      return NextResponse.json(
        { success: false, message: "InstanceId is required." },
        { status: 400 },
      );
    }
    const resolvedUrl =
      connectUrl || "https://connect.us-east-1.amazonaws.com/search-contacts";
    const region = normalizeAwsRegion(AWSRegion, resolvedUrl) || "us-east-1";

    const startRaw = TimeRange?.StartTime ?? Start_Time;
    const endRaw = TimeRange?.EndTime ?? End_Time;
    const toEpochSeconds = (value) => {
      if (value === null || value === undefined || value === "") return null;
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      const asNum = Number(value);
      if (Number.isFinite(asNum) && String(value).trim() !== "") return asNum;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    };
    const startSec = toEpochSeconds(startRaw);
    const endSec = toEpochSeconds(endRaw);
    if (!startSec || !endSec) {
      return NextResponse.json(
        { success: false, message: "TimeRange.StartTime and TimeRange.EndTime are required for test connection." },
        { status: 400 },
      );
    }

    if (!/^[a-z]{2}-[a-z]+-\d$/i.test(region)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid AWS region. Provide a region like us-east-1 or a Connect endpoint like connect.us-east-1.amazonaws.com.",
          data: { AWSRegion: AWSRegion || null, resolvedRegion: region, connectUrl: resolvedUrl },
        },
        { status: 400 },
      );
    }

    const connectConfig = { region };
    if (AccessKey && SecretKey) {
      connectConfig.credentials = {
        accessKeyId: AccessKey,
        secretAccessKey: SecretKey,
      };
    }
    const connect = new ConnectClient(connectConfig);

    const requestedType = String(TimeRange?.Type || "INITIATION_TIMESTAMP").toUpperCase();
    const resolvedType =
      requestedType === "INITIATED" ? "INITIATION_TIMESTAMP" : requestedType;

    const params = {
      InstanceId: instanceId,
      TimeRange: {
        Type: resolvedType,
        StartTime: startSec,
        EndTime: endSec,
      },
      MaxResults: 1,
      SearchCriteria: {},
    };

    // If SearchCriteria is required by the API, AWS will return a validation error.
    // We still treat reaching AWS (auth + endpoint) as a useful connection test signal.
    try {
      const command = new SearchContactsCommand(params);
      const result = await connect.send(command);
      return NextResponse.json({
        success: true,
        message: "Amazon Connect connection verified.",
        data: {
          region,
          instanceId,
          serviceName: ServiceName || null,
          contactsFound: Array.isArray(result?.Contacts) ? result.Contacts.length : 0,
        },
      });
    } catch (err) {
      const code = err?.code || err?.name || "Error";
      const message = err?.message || "Failed to call Amazon Connect.";
      const reachedAws =
        !String(code).toLowerCase().includes("invalidsignature") &&
        !String(code).toLowerCase().includes("signature") &&
        !String(code).toLowerCase().includes("unrecognizedclient");

      return NextResponse.json(
        {
          success: false,
          message,
          error: { code },
          data: { region, instanceId, reachedAws },
        },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("Error while testing Amazon Connect connection:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to test connection." },
      { status: 500 },
    );
  }
}
