"use client";

import type { ReactNode } from "react";
import type { TwitterAccount } from "../../../lib/twitter/api";
import { StatusChip } from "../../status-chip";
import { formatDateTime } from "./traditional-workspace";

type TraditionalAccountContextProps = {
  heading: string;
  description: string;
  selectionLabel: string;
  helperText: string;
  accounts: TwitterAccount[];
  selectedAccountId: string | null;
  selectedAccount: TwitterAccount | null;
  disabled?: boolean;
  onSelectAccount: (accountId: string | null) => void;
  supplemental?: ReactNode;
  actions?: ReactNode;
};

export function TraditionalAccountContext({
  heading,
  description,
  selectionLabel,
  helperText,
  accounts,
  selectedAccountId,
  selectedAccount,
  disabled,
  onSelectAccount,
  supplemental,
  actions
}: TraditionalAccountContextProps) {
  const preview =
    selectedAccount?.persona ||
    selectedAccount?.targetAudience ||
    selectedAccount?.manualNotes ||
    "当前账户还没有补充清晰的定位摘要。";

  return (
    <section className="traditional-account-context">
      <div className="traditional-account-context__main">
        <div className="traditional-account-context__intro">
          <span className="mini-badge mini-badge--accent">账户上下文</span>
          <h3>{heading}</h3>
          <p className="muted">{description}</p>
        </div>

        {selectedAccount ? (
          <div className="traditional-account-context__summary">
            <div className="traditional-account-context__identity">
              <div className="traditional-account-context__identity-copy">
                <strong>{selectedAccount.name || `@${selectedAccount.handle}`}</strong>
                <span>@{selectedAccount.handle}</span>
              </div>

              <div className="traditional-account-context__status">
                <StatusChip status={selectedAccount.status} />
                {selectedAccount.authStatus ? <StatusChip status={selectedAccount.authStatus} /> : null}
              </div>
            </div>

            <p className="traditional-account-context__preview">{preview}</p>

            <div className="traditional-account-context__facts">
              <div className="traditional-account-context__fact">
                <span>写给谁</span>
                <strong>{selectedAccount.targetAudience || "待补充"}</strong>
              </div>
              <div className="traditional-account-context__fact">
                <span>风格约束</span>
                <strong>{selectedAccount.styleGuide || "待补充"}</strong>
              </div>
              <div className="traditional-account-context__fact">
                <span>最近发文</span>
                <strong>{formatDateTime(selectedAccount.lastPublishedAt)}</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="traditional-empty-state traditional-empty-state--compact">
            <p>当前还没有可用账户。</p>
            <p className="muted">等账户接入后，这里会展示账户摘要和可切换入口。</p>
          </div>
        )}
      </div>

      <div className="traditional-account-context__side">
        <label className="field traditional-account-context__field">
          <span>{selectionLabel}</span>
          <select
            value={selectedAccountId ?? ""}
            disabled={disabled || !accounts.length}
            onChange={(event) => onSelectAccount(event.target.value || null)}
          >
            {accounts.length ? null : <option value="">暂无账户</option>}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {formatAccountOptionLabel(account)}
              </option>
            ))}
          </select>
        </label>

        <p className="helper-text traditional-account-context__helper">{helperText}</p>

        {supplemental ? <div className="traditional-account-context__supplemental">{supplemental}</div> : null}
        {actions ? <div className="traditional-account-context__actions">{actions}</div> : null}
      </div>
    </section>
  );
}

function formatAccountOptionLabel(account: TwitterAccount) {
  const displayName = account.name?.trim();
  return displayName && displayName !== `@${account.handle}` ? `${displayName} / @${account.handle}` : `@${account.handle}`;
}
