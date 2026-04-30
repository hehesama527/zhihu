"use client";

import { bindZhihuJobImage } from "../../lib/api";
import { TaskImageBinder } from "./task-image-binder";

export function ZhihuJobImageCard({
  jobId,
  initialAssetId
}: {
  jobId: number;
  initialAssetId: string | null;
}) {
  return (
    <TaskImageBinder
      platform="zhihu"
      title="任务配图"
      taskLabel={`知乎任务 #${jobId}`}
      initialAssetId={initialAssetId}
      onBind={async (assetId) => {
        const result = await bindZhihuJobImage(jobId, {
          assetId,
          usageType: "cover"
        });

        return result.asset?.id ?? null;
      }}
    />
  );
}
