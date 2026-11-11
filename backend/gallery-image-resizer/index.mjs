import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import sharp from 'sharp';

const s3 = new S3Client({});
const mediaConvert = new MediaConvertClient({});

const MEDIACONVERT_ROLE_ARN = process.env.MEDIACONVERT_ROLE_ARN; // role MediaConvert assumes to read/write S3
const MEDIACONVERT_QUEUE_ARN = process.env.MEDIACONVERT_QUEUE_ARN; // optional; defaults to the Default queue

const SHARP_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tif', 'tiff', 'heic', 'heif']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm']);
// Anything else (RAW etc.) is stored as an original only: no web preview.

// Decode failures are permanent: retrying the same file only repeats the error.
const PERMANENT_DECODE_ERROR = /unsupported image format|heif|bad seek|corrupt|premature end|vipsjpeg|vipspng|vipsforeign|pixel limit/i;

export const handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    // Only process uploads placed inside an originals/ directory
    if (!key.includes('/originals/')) continue;

    const ext = key.split('.').pop().toLowerCase();

    if (VIDEO_EXT.has(ext)) {
      await startVideoJob(bucket, key);
    } else if (SHARP_EXT.has(ext)) {
      await createWebImage(bucket, key);
    } else {
      console.log(`No web preview for .${ext}: ${key}`);
    }
  }
};

async function createWebImage(bucket, key) {
  const webKey = key.replace('/originals/', '/web/').replace(/\.[^/.]+$/, '.webp');

  try {
    const s3Item = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const inputBuffer = Buffer.from(await s3Item.Body.transformToByteArray());

    const outputBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: webKey,
      Body: outputBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    console.log(`Successfully created web preview: ${webKey}`);
  } catch (err) {
    if (PERMANENT_DECODE_ERROR.test(String(err?.message))) {
      // e.g. HEIC when this sharp build has no HEVC decoder. The original stays downloadable.
      console.error(`Cannot decode ${key}, skipping preview:`, err.message);
      return;
    }
    console.error(`Error resizing ${key}:`, err);
    throw err; // transient (S3, memory, timeout): let Lambda retry
  }
}

async function startVideoJob(bucket, key) {
  const match = key.match(/^galleries\/([^/]+)\/originals\/.+$/);
  if (!match) return;
  const galleryId = match[1];
  const destination = `s3://${bucket}/galleries/${galleryId}/web/`;

  // Outputs (name = input name + modifier):
  //   web/<name>_web.mp4              H.264/AAC MP4, fast-start, capped at 8 Mbps
  //   web/<name>_poster.0000000.jpg   one still frame for the grid tile
  const settings = {
    TimecodeConfig: { Source: 'ZEROBASED' },
    Inputs: [{
      FileInput: `s3://${bucket}/${key}`,
      TimecodeSource: 'ZEROBASED',
      AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
      VideoSelector: { Rotate: 'AUTO' }, // honour phone rotation metadata
    }],
    OutputGroups: [
      {
        Name: 'Web MP4',
        OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: destination } },
        Outputs: [{
          NameModifier: '_web',
          ContainerSettings: { Container: 'MP4', Mp4Settings: { MoovPlacement: 'PROGRESSIVE_DOWNLOAD' } },
          VideoDescription: {
            CodecSettings: {
              Codec: 'H_264',
              H264Settings: {
                RateControlMode: 'QVBR',
                QvbrSettings: { QvbrQualityLevel: 7 },
                MaxBitrate: 8000000,
                CodecProfile: 'HIGH',
                SceneChangeDetect: 'TRANSITION_DETECTION',
              },
            },
          },
          AudioDescriptions: [{
            AudioSourceName: 'Audio Selector 1',
            CodecSettings: {
              Codec: 'AAC',
              AacSettings: { Bitrate: 128000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48000 },
            },
          }],
        }],
      },
      {
        Name: 'Poster',
        OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: destination } },
        Outputs: [{
          NameModifier: '_poster',
          ContainerSettings: { Container: 'RAW' },
          VideoDescription: {
            CodecSettings: {
              Codec: 'FRAME_CAPTURE',
              FrameCaptureSettings: { FramerateNumerator: 1, FramerateDenominator: 5, MaxCaptures: 1, Quality: 80 },
            },
          },
        }],
      },
    ],
  };

  const job = await mediaConvert.send(new CreateJobCommand({
    Role: MEDIACONVERT_ROLE_ARN,
    ...(MEDIACONVERT_QUEUE_ARN ? { Queue: MEDIACONVERT_QUEUE_ARN } : {}),
    // Echoed back in the job-complete event so gallery-video-status can find the right item.
    UserMetadata: { app: 'client-gallery', galleryId, originalKey: key },
    Settings: settings,
  }));
  console.log(`Started MediaConvert job ${job.Job?.Id} for ${key}`);
}
