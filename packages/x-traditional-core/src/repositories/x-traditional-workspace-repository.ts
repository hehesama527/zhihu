import { XWorkspaceRepository, type XAccount } from "@zhihu-mvp/x-core";
import { getXTraditionalAppConfig } from "../config.js";

export class XTraditionalWorkspaceRepository extends XWorkspaceRepository {
  constructor() {
    super(getXTraditionalAppConfig());
  }

  override async createAccount(input: Parameters<XWorkspaceRepository["createAccount"]>[0]) {
    return super.createAccount({
      ...input,
      writerPromptSource: "database"
    });
  }

  override async updateAccount(
    id: string,
    patch: Parameters<XWorkspaceRepository["updateAccount"]>[1]
  ): Promise<XAccount | null> {
    return super.updateAccount(id, {
      ...patch,
      writerPromptSource: "database"
    });
  }
}
