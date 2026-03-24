import { AccountPanel } from "../../components/account-panel";
import { getAccountStatus } from "../../lib/api";

export default async function AccountPage() {
  const account = await getAccountStatus();

  return (
    <div className="stack">
      <section className="page-header">
        <div>
          <h2>账号恢复</h2>
          <p className="muted">系统会先检查知乎登录态。只有检测到登录失效或挑战页时，才需要在这里人工恢复。</p>
        </div>
      </section>

      <AccountPanel account={account} />
    </div>
  );
}
