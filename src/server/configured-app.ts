import path from "node:path";

import { createBlobStore } from "../core/blob-store.js";
import { createFileStore } from "../core/file-store.js";
import { createPublishService } from "../core/publish-service.js";
import { createApp } from "./app.js";

export interface AppConfig {
  dataDir?: string;
}

export function createConfiguredApp(config: AppConfig = {}) {
  const contentBlobToken = getEnv("BLOB_READ_WRITE_TOKEN");
  const metadataBlobToken = getEnv("METADATA_BLOB_READ_WRITE_TOKEN");
  const repository =
    contentBlobToken !== undefined &&
    contentBlobToken.length > 0 &&
    metadataBlobToken !== undefined &&
    metadataBlobToken.length > 0
      ? createBlobStore(contentBlobToken, metadataBlobToken)
      : createFileStore(
          config.dataDir ??
            getEnv("PUB_DATA_DIR") ??
            path.resolve(process.cwd(), ".tmp/pubmd-data"),
        );
  const service = createPublishService(repository);

  return createApp(service);
}

function getEnv(
  name:
    | "BLOB_READ_WRITE_TOKEN"
    | "METADATA_BLOB_READ_WRITE_TOKEN"
    | "PUB_DATA_DIR",
): string | undefined {
  return process.env[name];
}
