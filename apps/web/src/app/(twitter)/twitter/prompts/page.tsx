import { redirect } from "next/navigation";
import { TwitterPromptHome } from "../../../../components/twitter/twitter-prompt-home";

export default async function TwitterPromptsPage({
  searchParams
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const params = await searchParams;
  if (params.prompt) {
    redirect(`/twitter/prompts/traditional?prompt=${encodeURIComponent(params.prompt)}`);
  }

  return <TwitterPromptHome />;
}
