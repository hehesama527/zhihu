import { ImageReviewConsole } from "../../../components/images/image-review-console";

type ReviewPageProps = {
  searchParams?: Promise<{
    assetId?: string;
  }>;
};

export default async function ImageReviewPage({ searchParams }: ReviewPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  return <ImageReviewConsole initialAssetId={resolvedSearchParams.assetId ?? null} />;
}
