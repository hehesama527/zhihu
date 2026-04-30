import { redirect } from "next/navigation";

export default async function TwitterPromptEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  redirect(`/twitter/prompts/traditional?prompt=${encodeURIComponent(id)}`);
}
