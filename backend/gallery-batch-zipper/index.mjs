import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import stream from 'stream';
import * as archiverModule from 'archiver';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME;

// Videos are left out of the ZIP by default: they are huge, already compressed, and a Lambda
// response stream has size and bandwidth limits. They download individually from the gallery.
// Pass ?includeVideos=1 to override.
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm']);
const isVideo = (key) => VIDEO_EXT.has(key.split('.').pop().toLowerCase());

// Reliable factory resolution for native ESM archiver
function getArchiver(format, options) {
  if (format === 'zip' && typeof archiverModule.ZipArchive === 'function') {
    return new archiverModule.ZipArchive(options);
  }
  if (typeof archiverModule.default === 'function') {
    return archiverModule.default(format, options);
  }
  if (typeof archiverModule.create === 'function') {
    return archiverModule.create(format, options);
  }
  throw new Error(`Unable to resolve archiver factory: ${Object.keys(archiverModule)}`);
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const galleryId = event.queryStringParameters?.galleryId;
    const rawTitle = event.queryStringParameters?.title;
    const includeVideos = event.queryStringParameters?.includeVideos === '1';

    if (!galleryId) {
      const errorStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      errorStream.write(JSON.stringify({ error: 'Missing galleryId parameter' }));
      errorStream.end();
      return;
    }

    // Clean up title: replace illegal characters with hyphens and collapse whitespace
    const fallbackName = `gallery-${galleryId.slice(0, 8)}`;
    const sanitizedTitle = rawTitle
      ? rawTitle.trim().replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '-')
      : fallbackName;

    const zipFilename = `${sanitizedTitle || fallbackName}.zip`;

    const metadata = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
      },
    };

    responseStream = awslambda.HttpResponseStream.from(responseStream, metadata);

    try {
      const listRes = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: `galleries/${galleryId}/originals/`,
      }));

      const objects = (listRes.Contents || [])
        .filter((o) => !o.Key.endsWith('/'))
        .filter((o) => includeVideos || !isVideo(o.Key));

      if (objects.length === 0) {
        responseStream.write(JSON.stringify({ error: 'No photos found for this gallery. Videos download individually.' }));
        responseStream.end();
        return;
      }

      const totalBytes = objects.reduce((sum, o) => sum + (o.Size || 0), 0);

      // Calls the internal create/factory rather than raw class constructor.
      // Level 0 = store only: photos and video are already compressed.
      const archive = getArchiver('zip', {
        zlib: { level: 0 },
        forceZip64: totalBytes > 3.5e9, // classic ZIP tops out at 4 GB
      });

      archive.on('error', (err) => {
        console.error('Archiver Error:', err);
        responseStream.destroy(err);
      });

      archive.pipe(responseStream);

      // One object at a time: open the next S3 stream only after the previous entry is written.
      // Opening them all up front leaves later streams idle (and holding sockets) while earlier ones drain.
      for (const obj of objects) {
        const fileName = obj.Key.split('/').pop();
        const s3Item = await s3.send(new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: obj.Key,
        }));

        const nodeStream = stream.Readable.fromWeb(s3Item.Body.transformToWebStream());
        await new Promise((resolve, reject) => {
          archive.once('entry', resolve);
          nodeStream.once('error', reject);
          archive.append(nodeStream, { name: fileName });
        });
      }

      await archive.finalize();
    } catch (err) {
      console.error('Failed to build ZIP archive:', err);
      responseStream.destroy(err);
    }
  }
);
