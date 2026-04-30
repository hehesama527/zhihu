import { ImageAssetDetailView } from "../../../components/images/image-asset-detail-view";

export default async function ImageAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImageAssetDetailView assetId={id} />;
}
