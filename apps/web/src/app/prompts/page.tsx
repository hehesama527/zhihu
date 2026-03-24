import { PromptStudio } from "../../components/prompt-studio";
import { getPromptSets } from "../../lib/api";

export default async function PromptsPage() {
  const promptSets = await getPromptSets();

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>Prompt Studio</h2>
          <p className="muted">在这里保存草稿、做样例测试、手动发布生效版本或回滚。</p>
        </div>
      </section>

      <PromptStudio promptSets={promptSets} />
    </div>
  );
}
