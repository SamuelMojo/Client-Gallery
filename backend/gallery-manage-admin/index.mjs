import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID, randomInt } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const s3 = new S3Client({ region: "us-east-1" });
const BUCKET_NAME = process.env.BUCKET_NAME || "samuelojo-client-gallery-2026";
const TABLE_NAME = process.env.TABLE_NAME || "ClientGalleries";

// Keep in sync with gallery-frontend/src/mediaTypes.ts
const TYPES = {
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  png: { kind: "image", mime: "image/png" },
  webp: { kind: "image", mime: "image/webp" },
  gif: { kind: "image", mime: "image/gif" },
  avif: { kind: "image", mime: "image/avif" },
  tif: { kind: "image", mime: "image/tiff" },
  tiff: { kind: "image", mime: "image/tiff" },
  heic: { kind: "image", mime: "image/heic" },
  heif: { kind: "image", mime: "image/heif" },
  arw: { kind: "raw", mime: "image/x-sony-arw" },
  cr2: { kind: "raw", mime: "image/x-canon-cr2" },
  cr3: { kind: "raw", mime: "image/x-canon-cr3" },
  nef: { kind: "raw", mime: "image/x-nikon-nef" },
  dng: { kind: "raw", mime: "image/x-adobe-dng" },
  raf: { kind: "raw", mime: "image/x-fuji-raf" },
  mp4: { kind: "video", mime: "video/mp4" },
  mov: { kind: "video", mime: "video/quicktime" },
  m4v: { kind: "video", mime: "video/x-m4v" },
  webm: { kind: "video", mime: "video/webm" },
};
const MAX_BYTES = { image: 100e6, raw: 150e6, video: 5e9 }; // 5 GB = single presigned PUT limit
const MAX_FILES = 500;

const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
};

// Filesystem-safe S3 key segment. The display name (fileName) is stored separately.
const safeName = (name) =>
  String(name).split(/[\\/]/).pop().trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 150) || "file";

// Declared type is accepted only if it is a plain image/* or video/* type (never svg).
const pickContentType = (declared, ext) =>
  typeof declared === "string" && /^(image|video)\/[A-Za-z0-9.+-]+$/.test(declared) && !declared.includes("svg")
    ? declared
    : TYPES[ext].mime;

const dispositionFor = (fileName) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;

/** Turns the request body into a validated list of files, or a list of errors. */
function planFiles(body) {
  // New clients send files: [{ fileName, contentType, size }]. Older ones send fileNames: ["a.jpg"].
  const strict = Array.isArray(body.files);
  const raw = strict ? body.files : body.fileNames || body.filenames || [];
  const errors = [];
  const files = [];

  if (!Array.isArray(raw) || raw.length === 0) errors.push("No files supplied");
  if (raw.length > MAX_FILES) errors.push(`Too many files (limit ${MAX_FILES})`);
  if (errors.length) return { strict, files, errors };

  const seen = new Set();
  for (const entry of raw) {
    const fileName = typeof entry === "string" ? entry : entry.fileName || entry.name;
    if (!fileName || typeof fileName !== "string") { errors.push("A file has no name"); continue; }
    if (seen.has(fileName)) { errors.push(`${fileName}: duplicate file name`); continue; }
    seen.add(fileName);

    const ext = extOf(fileName);
    const type = TYPES[ext];
    if (!type) { errors.push(`${fileName}: unsupported file type`); continue; }

    const size = typeof entry === "object" ? Number(entry.size) : undefined;
    if (strict) {
      if (!Number.isInteger(size) || size <= 0) { errors.push(`${fileName}: missing size`); continue; }
      if (size > MAX_BYTES[type.kind]) { errors.push(`${fileName}: too large for a ${type.kind} file`); continue; }
    }
    const declared = typeof entry === "object" ? entry.contentType || entry.type : undefined;
    files.push({ fileName, ext, kind: type.kind, size, contentType: pickContentType(declared, ext) });
  }
  return { strict, files, errors };
}

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
  };

  // HTTP API v2 uses requestContext.http.method; REST API uses httpMethod
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === "OPTIONS") {
    return { statusCode: 200, headers, body: JSON.stringify({ message: "OK" }) };
  }

  try {
    let rawBody = event.body || "{}";
    if (event.isBase64Encoded) rawBody = Buffer.from(rawBody, "base64").toString("utf-8");
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

    const galleryId = body.galleryId || randomUUID();
    const { title, clientName, isPublic } = body;
    const accessPin = randomInt(1000, 10000).toString();

    const { strict, files, errors } = planFiles(body);
    if (errors.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: errors.slice(0, 10).join("; ") }) };
    }
    console.log(`Gallery ${galleryId}: ${files.length} files, public=${Boolean(isPublic)}, strict=${strict}`);

    // Unique base name per gallery, so a.jpg + a.png (or a.mov + a.mp4) can never share a web/ output.
    const usedBases = new Set();
    const uniqueName = (name) => {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let candidate = base;
      for (let n = 2; usedBases.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}`;
      usedBases.add(candidate.toLowerCase());
      return candidate + ext;
    };

    const prefix = `galleries/${galleryId}`;
    const uploads = await Promise.all(
      files.map(async (f) => {
        const keyName = uniqueName(safeName(f.fileName));
        const base = keyName.replace(/\.[^.]+$/, "");
        const originalKey = `${prefix}/originals/${keyName}`;

        const media = { fileName: f.fileName, originalKey, type: f.kind === "video" ? "video" : "image" };
        if (f.kind === "image") media.webKey = `${prefix}/web/${base}.webp`; // written by the resizer
        if (f.kind === "video") {
          // Written by MediaConvert (NameModifier _web / _poster); frame capture appends .0000000
          media.webKey = `${prefix}/web/${base}_web.mp4`;
          media.posterKey = `${prefix}/web/${base}_poster.0000000.jpg`;
          media.status = "processing";
        }
        if (f.size) media.size = f.size;

        const uploadHeaders = { "Content-Type": f.contentType };
        const params = { Bucket: BUCKET_NAME, Key: originalKey, ContentType: f.contentType };
        const signing = { expiresIn: 3600 };

        if (strict) {
          // Lock type, exact size and download behaviour into the signature so the browser cannot change them.
          params.ContentLength = f.size;
          params.ContentDisposition = dispositionFor(f.fileName);
          uploadHeaders["Content-Disposition"] = params.ContentDisposition;
          signing.signableHeaders = new Set(["content-type", "content-length", "content-disposition"]);
        }

        const uploadUrl = await getSignedUrl(s3, new PutObjectCommand(params), signing);
        return { media, upload: { fileName: f.fileName, key: originalKey, webKey: media.webKey, uploadUrl, headers: uploadHeaders } };
      })
    );

    const item = {
      galleryId,
      title: title || "Untitled Gallery",
      clientName: clientName || "Client",
      isPublic: Boolean(isPublic),
      accessPin,
      createdAt: new Date().toISOString(),
      images: uploads.map((u) => u.media),
    };

    // Never overwrite an existing gallery if a galleryId is supplied.
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: "attribute_not_exists(galleryId)",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        galleryId,
        accessPin,
        isPublic: item.isPublic,
        uploadUrls: uploads.map((u) => u.upload),
        gallery: item,
      }),
    };
  } catch (error) {
    console.error("Error creating gallery:", error);
    const status = error.name === "ConditionalCheckFailedException" ? 409 : 500;
    return { statusCode: status, headers, body: JSON.stringify({ error: status === 409 ? "Gallery already exists" : "Could not create gallery" }) };
  }
};
