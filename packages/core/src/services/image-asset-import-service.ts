import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getAppConfig } from "../config/env.js";
import { ImageAssetRepository } from "../repositories/image-asset-repository.js";
import { ImageAssetAnalysisService } from "./image-asset-analysis-service.js";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);

export class ImageAssetImportService {
  private readonly config = getAppConfig();

  constructor(
    private readonly repository: ImageAssetRepository,
    private readonly analysisService: ImageAssetAnalysisService
  ) {}

  async ensureReady() {
    await Promise.all(
      [
        this.config.imageAssetsDir,
        path.join(this.config.imageAssetsDir, "originals"),
        path.join(this.config.imageAssetsDir, "thumbnails"),
        path.join(this.config.imageAssetsDir, "imports"),
        path.join(this.config.imageAssetsDir, "quarantine")
      ].map((dirPath) => fs.mkdir(dirPath, { recursive: true }))
    );
  }

  async createDirectoryImportJob(sourcePath: string) {
    await this.ensureReady();
    const resolvedSourcePath = path.resolve(sourcePath);
    const jobId = crypto.randomUUID();
    const job = await this.repository.createImportJob({
      id: jobId,
      sourceType: "directory",
      sourcePath: resolvedSourcePath
    });

    void this.runDirectoryImportJob(jobId, resolvedSourcePath).catch(async (error) => {
      await this.repository.updateImportJob(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date()
      });
    });

    return job;
  }

  private async runDirectoryImportJob(jobId: string, sourcePath: string) {
    const stats = await fs.stat(sourcePath);
    if (!stats.isDirectory()) {
      throw new Error("导入路径必须是目录。");
    }

    await this.repository.updateImportJob(jobId, {
      status: "running",
      errorMessage: null
    });

    const files = await walkDirectory(sourcePath);
    const counters = {
      totalCount: files.length,
      importedCount: 0,
      duplicatedCount: 0,
      skippedCount: 0,
      failedCount: 0
    };

    await this.repository.updateImportJob(jobId, counters);

    for (let index = 0; index < files.length; index += 1) {
      const filePath = files[index];
      const extension = path.extname(filePath).toLowerCase();

      if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
        counters.skippedCount += 1;
        await this.maybeFlushProgress(jobId, counters, index);
        continue;
      }

      const relativeSourcePath = path.relative(sourcePath, filePath).replaceAll("\\", "/");
      if (looksLikeThumbnailSource(relativeSourcePath)) {
        counters.skippedCount += 1;
        await this.maybeFlushProgress(jobId, counters, index);
        continue;
      }

      try {
        const buffer = await fs.readFile(filePath);
        const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
        const existing = await this.repository.getAssetByHash(fileHash);
        if (existing) {
          counters.duplicatedCount += 1;
          await this.maybeFlushProgress(jobId, counters, index);
          continue;
        }

        const metadata = await sharp(buffer, { animated: true }).metadata();
        const assetId = crypto.randomUUID();
        const originalRelativePath = path.join("originals", `${assetId}${extension}`).replaceAll("\\", "/");
        const thumbnailRelativePath = path.join("thumbnails", `${assetId}.webp`).replaceAll("\\", "/");
        const originalAbsolutePath = path.join(this.config.imageAssetsDir, originalRelativePath);
        const thumbnailAbsolutePath = path.join(this.config.imageAssetsDir, thumbnailRelativePath);

        await fs.copyFile(filePath, originalAbsolutePath);
        await sharp(buffer, { animated: true })
          .rotate()
          .resize({
            width: 480,
            height: 480,
            fit: "inside",
            withoutEnlargement: true
          })
          .webp({ quality: 82 })
          .toFile(thumbnailAbsolutePath);

        const width = typeof metadata.width === "number" ? metadata.width : null;
        const height = typeof metadata.height === "number" ? metadata.height : null;

        await this.repository.createAsset({
          id: assetId,
          sourceType: "local_import",
          fileName: path.basename(filePath),
          sourcePath: relativeSourcePath,
          storagePath: originalRelativePath,
          thumbnailPath: thumbnailRelativePath,
          fileHash,
          mimeType: inferMimeType(extension),
          fileSize: buffer.byteLength,
          width,
          height,
          aspectRatio: getAspectRatio(width, height),
          analysisStatus: "pending",
          status: "pending_review"
        });

        counters.importedCount += 1;
        this.analysisService.enqueue(assetId);
      } catch {
        counters.failedCount += 1;
      }

      await this.maybeFlushProgress(jobId, counters, index);
    }

    await this.repository.updateImportJob(jobId, {
      ...counters,
      status: "completed",
      completedAt: new Date()
    });
  }

  private async maybeFlushProgress(
    jobId: string,
    counters: {
      totalCount: number;
      importedCount: number;
      duplicatedCount: number;
      skippedCount: number;
      failedCount: number;
    },
    index: number
  ) {
    if ((index + 1) % 10 !== 0) {
      return;
    }

    await this.repository.updateImportJob(jobId, counters);
  }
}

async function walkDirectory(rootPath: string) {
  const discovered: string[] = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        discovered.push(absolutePath);
      }
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function inferMimeType(extension: string) {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

function getAspectRatio(width: number | null, height: number | null) {
  if (!width || !height) {
    return "square" as const;
  }

  if (width === height) {
    return "square" as const;
  }

  return width > height ? ("landscape" as const) : ("portrait" as const);
}

function looksLikeThumbnailSource(sourcePath: string) {
  const normalized = sourcePath.replaceAll("\\", "/").toLowerCase();
  return /(?:^|[/._\-\s])(thumb|thumbnail|preview|mini)(?:[/._\-\s]|$)/i.test(normalized)
    || normalized.includes("缩略图")
    || normalized.includes("预览图")
    || normalized.includes("缩略");
}
