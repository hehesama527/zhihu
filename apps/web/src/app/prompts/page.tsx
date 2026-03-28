import { PromptStudio } from "../../components/prompt-studio";
import { getAccounts, getPromptSets } from "../../lib/api";

export default async function PromptsPage() {
  const [promptSets, accounts] = await Promise.all([getPromptSets(), getAccounts()]);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>Prompt Studio</h2>
          <p className="muted">
            这里既能管理全局 Prompt 版本，也能按账号查看每个人当前实际会用到的 Writer Prompt，并直接在前端做微调。
          </p>
        </div>
      </section>

      <PromptStudio promptSets={promptSets} accounts={accounts} />
    </div>
  );
}
