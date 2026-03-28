import { AccountRegistry } from "../../components/account-registry";
import { AccountSwitcher } from "../../components/account-switcher";
import { AccountPanel } from "../../components/account-panel";
import { getAccounts, getAccountStatus, getPromptSet } from "../../lib/api";

type AccountPageProps = {
  searchParams?: Promise<{
    accountId?: string;
  }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedAccountId = parseAccountId(resolvedSearchParams?.accountId);
  const [account, accounts, writerPromptSet] = await Promise.all([
    getAccountStatus(selectedAccountId),
    getAccounts(),
    getPromptSet("writer_agent")
  ]);

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>账号管理</h2>
          <p className="muted">
            先盘清矩阵里到底有几个账号，再切到目标账号处理登录恢复、资料维护和被阻塞任务。
          </p>
        </div>
      </section>

      <AccountRegistry accounts={accounts} selectedAccountId={account?.id ?? selectedAccountId} />

      <AccountSwitcher
        accounts={accounts}
        selectedAccountId={account?.id ?? selectedAccountId}
        basePath="/account"
        title="矩阵账号"
        description="这里是账号级操作页。切换后，下面的恢复动作和账号资料编辑都会针对当前账号执行。"
      />

      <AccountPanel account={account} writerPromptSet={writerPromptSet} />
    </div>
  );
}

function parseAccountId(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
