/**
 * Almacenamiento de grabaciones de entrevistas.
 *
 * fileId format:
 *   "local:<interviewId>"  → disco local en ./recordings/<id>.{webm,mp4}
 *   "mongo:<objectId>"     → MongoDB GridFS
 *
 * Si MONGODB_URL no está configurado, o si MongoDB falla → disco local.
 */

import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { logger } from '../logger';
import { config } from '../config';

const LOCAL_DIR    = join(process.cwd(), 'recordings');
const LOCAL_PREFIX = 'local:';
const MONGO_PREFIX = 'mongo:';

// ── MongoDB GridFS ────────────────────────────────────────────────────────────

let _mongoClient: any = null;
let _gridBucket: any  = null;
let _connectPromise: Promise<any> | null = null;

async function getGridBucket(): Promise<any> {
  if (_gridBucket) return _gridBucket;
  if (_connectPromise) return _connectPromise;

  _connectPromise = (async () => {
    const { MongoClient, GridFSBucket } = await import('mongodb');
    _mongoClient = await MongoClient.connect(config.MONGODB_URL!, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
    });
    _mongoClient.on('close', () => {
      _gridBucket = null;
      _connectPromise = null;
      logger.warn('MongoDB: conexión cerrada');
    });
    const db = _mongoClient.db('entrevistas');
    _gridBucket = new GridFSBucket(db, { bucketName: 'recordings' });
    logger.info('MongoDB GridFS conectado');
    return _gridBucket;
  })();

  _connectPromise.catch(() => { _connectPromise = null; _gridBucket = null; });
  return _connectPromise;
}

// ── Local disk ────────────────────────────────────────────────────────────────

function ensureLocalDir() {
  if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });
}

function findLocalFile(interviewId: string): { path: string; ext: string } | null {
  for (const ext of ['webm', 'mp4']) {
    const p = join(LOCAL_DIR, `${interviewId}.${ext}`);
    if (existsSync(p)) return { path: p, ext };
  }
  return null;
}

function localExt(contentType: string) {
  return contentType.includes('mp4') ? 'mp4' : 'webm';
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function storeRecording(
  interviewId: string,
  stream: Readable,
  contentType: string,
): Promise<string> {
  if (config.MONGODB_URL) {
    try {
      // getGridBucket() throws BEFORE the stream is consumed if MongoDB is unreachable → safe fallback
      const bucket = await getGridBucket();
      const up = bucket.openUploadStream(interviewId, {
        metadata: { interviewId, contentType },
        contentType,
      });
      await pipeline(stream, up);
      logger.info({ interviewId }, 'recording: guardado en MongoDB GridFS');
      return `${MONGO_PREFIX}${up.id.toString()}`;
    } catch (err) {
      logger.warn({ err, interviewId }, 'recording: MongoDB no disponible, guardando en disco local');
    }
  }

  ensureLocalDir();
  const ext  = localExt(contentType);
  const dest = join(LOCAL_DIR, `${interviewId}.${ext}`);
  await pipeline(stream, createWriteStream(dest));
  logger.info({ dest, interviewId }, 'recording: guardado en disco local');
  return `${LOCAL_PREFIX}${interviewId}`;
}

export type RecordingMeta = {
  kind: 'local';
  filePath: string;
  length: number;
  contentType: string;
} | {
  kind: 'mongo';
  objectId: string;
  length: number | null;
  contentType: string;
};

export async function getRecordingMeta(
  fileId: string,
  interviewId: string,
): Promise<RecordingMeta | null> {
  // ── MongoDB ──────────────────────────────────────────────────────────────
  if (fileId.startsWith(MONGO_PREFIX)) {
    const objectId = fileId.slice(MONGO_PREFIX.length);
    try {
      const { ObjectId } = await import('mongodb');
      const bucket = await getGridBucket();
      const cursor = bucket.find({ _id: new ObjectId(objectId) });
      const [file] = await cursor.toArray();
      if (!file) return null;
      return {
        kind: 'mongo',
        objectId,
        length: file.length ?? null,
        contentType: file.contentType ?? 'video/webm',
      };
    } catch {
      return null;
    }
  }

  // ── Local disk ────────────────────────────────────────────────────────────
  // Handles both "local:<id>" (new) and bare "<id>" (legacy)
  const localId = fileId.startsWith(LOCAL_PREFIX) ? fileId.slice(LOCAL_PREFIX.length) : interviewId;
  const found   = findLocalFile(localId);
  if (!found) return null;

  const { statSync } = await import('fs');
  const { size } = statSync(found.path);
  return {
    kind: 'local',
    filePath: found.path,
    length: size,
    contentType: found.ext === 'mp4' ? 'video/mp4' : 'video/webm',
  };
}

export async function openMongoStream(objectId: string, start?: number): Promise<Readable> {
  const { ObjectId } = await import('mongodb');
  const bucket = await getGridBucket();
  return start != null
    ? bucket.openDownloadStream(new ObjectId(objectId), { start })
    : bucket.openDownloadStream(new ObjectId(objectId));
}

export function isMongoConfigured(): boolean {
  return !!config.MONGODB_URL;
}
