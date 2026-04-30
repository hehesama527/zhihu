import { ImageRuntimeCenter } from "../../../components/models/image-runtime-center";
import { ModelCenterErrorState } from "../../../components/models/model-center-error-state";
import { getModelCenterConfig } from "../../../lib/api";

export default async function ModelImagesPage() {
  try {
    const modelCenter = await getModelCenterConfig();
    return <ImageRuntimeCenter initialModelCenter={modelCenter} />;
  } catch (error) {
    return <ModelCenterErrorState message={error instanceof Error ? error.message : "Unknown model-center error."} />;
  }
}
