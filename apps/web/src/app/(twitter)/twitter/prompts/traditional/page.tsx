import { TwitterTraditionalPromptWorkbench } from "../../../../../components/twitter/twitter-traditional-prompt-workbench";

export default async function TwitterTraditionalPromptsPage({
  searchParams
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const params = await searchParams;

  return <TwitterTraditionalPromptWorkbench initialPromptId={params.prompt ?? null} />;
}
