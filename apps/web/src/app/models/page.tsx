import { ModelCatalogCenter } from "../../components/models/model-catalog-center";
import { ModelCenterErrorState } from "../../components/models/model-center-error-state";
import { getModelCenterConfig } from "../../lib/api";

export default async function ModelsPage() {
  try {
    const modelCenter = await getModelCenterConfig();
    return <ModelCatalogCenter initialModelCenter={modelCenter} />;
  } catch (error) {
    return <ModelCenterErrorState message={error instanceof Error ? error.message : "Unknown model-center error."} />;
  }
}
