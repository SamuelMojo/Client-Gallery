// Triggered by EventBridge when a MediaConvert job finishes. Marks the matching video
// in the gallery as ready (or failed) so the frontend knows when it can play it.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE_NAME = process.env.TABLE_NAME || 'ClientGalleries';

export const handler = async (event) => {
  const { status, userMetadata, jobId, errorMessage } = event.detail || {};
  const { galleryId, originalKey } = userMetadata || {};
  if (!galleryId || !originalKey) {
    console.log('Ignoring job without gallery metadata', jobId);
    return;
  }

  const newStatus = status === 'COMPLETE' ? 'ready' : 'failed';
  if (newStatus === 'failed') console.error(`MediaConvert job ${jobId} failed for ${originalKey}: ${errorMessage}`);

  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { galleryId } }));
  const index = Item?.images?.findIndex((m) => m.originalKey === originalKey) ?? -1;
  if (index < 0) {
    console.error(`No item for ${originalKey} in gallery ${galleryId}`);
    return;
  }

  // Update just this list element, and only if it is still the same file.
  await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { galleryId },
    UpdateExpression: `SET images[${index}].#s = :s`,
    ConditionExpression: `images[${index}].originalKey = :k`,
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': newStatus, ':k': originalKey },
  }));
  console.log(`Marked ${originalKey} as ${newStatus}`);
};
