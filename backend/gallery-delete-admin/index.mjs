// DELETE /admin/galleries/{galleryId}
// Permanently removes a gallery: every S3 object under galleries/<id>/ (originals, web versions,
// posters), then its DynamoDB record. S3 goes first so a failure part-way can simply be retried:
// the record still exists until all files are gone.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const s3 = new S3Client({ region: "us-east-1" });
const BUCKET_NAME = process.env.BUCKET_NAME || "samuelojo-client-gallery-2026";
const TABLE_NAME = process.env.TABLE_NAME || "ClientGalleries";

// Only ever delete under a well-formed gallery prefix, never "galleries/" itself.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,DELETE",
  };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === "OPTIONS") return reply(200, { message: "OK" });
  if (method !== "DELETE") return reply(405, { error: "Method not allowed" });

  // The API Gateway authorizer should already have rejected anonymous callers. Check again here
  // so a misconfigured route can never become an open delete endpoint.
  const claims = event.requestContext?.authorizer?.jwt?.claims || event.requestContext?.authorizer?.claims;
  if (!claims?.sub) return reply(401, { error: "Unauthorized" });

  const galleryId = event.pathParameters?.galleryId;
  if (!galleryId || !UUID.test(galleryId)) return reply(400, { error: "Invalid gallery id" });

  try {
    const prefix = `galleries/${galleryId}/`;
    let deletedObjects = 0;
    let token;
    do {
      const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix, ContinuationToken: token }));
      const objects = (list.Contents || []).map((o) => ({ Key: o.Key }));
      if (objects.length > 0) {
        const result = await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET_NAME, Delete: { Objects: objects, Quiet: true } }));
        if (result.Errors?.length) {
          throw new Error(`Could not delete ${result.Errors.length} files (first: ${result.Errors[0].Key}: ${result.Errors[0].Code})`);
        }
        deletedObjects += objects.length;
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);

    const removed = await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { galleryId },
      ReturnValues: "ALL_OLD",
    }));

    if (!removed.Attributes && deletedObjects === 0) return reply(404, { error: "Gallery not found" });

    console.log(`Deleted gallery ${galleryId}: ${deletedObjects} files, record ${removed.Attributes ? "removed" : "was already gone"}, by ${claims.sub}`);
    return reply(200, { galleryId, deletedObjects });
  } catch (error) {
    console.error(`Failed to delete gallery ${galleryId}:`, error);
    return reply(500, { error: "Could not delete the gallery. Try again." });
  }
};
