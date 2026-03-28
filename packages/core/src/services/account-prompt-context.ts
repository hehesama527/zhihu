export type AccountPromptContext = {
  accountId: number;
  accountName: string;
  zhihuUserName: string | null;
};

export function buildTopicPromptSuffix(accountContext?: AccountPromptContext | null) {
  const personaName = accountContext?.accountName?.trim();
  if (!personaName) {
    return null;
  }

  const lines = [
    "Runtime account context:",
    `1. The current target account/persona name is "${personaName}". If the base prompt mentions a default persona name such as "二牛", override it with this account.`,
    "2. Topic discovery, topic ranking, topic de-duplication and angle selection must all be judged from this specific account's persona, observations and likely experience range.",
    "3. Keep the overall business goal unchanged: all accounts still serve the same promotion goal, but different accounts do not need to converge to the same topic angle.",
    "4. During the current matrix testing phase, keep the differentiation lightweight and realistic. Make the topic feel suitable for this account instead of forcing exaggerated role-play."
  ];

  if (accountContext?.zhihuUserName?.trim()) {
    lines.push(
      `5. The linked Zhihu username is "${accountContext.zhihuUserName.trim()}". You may use it as tone reference when helpful, but do not force it into the final answer.`
    );
  }

  return lines.join("\n");
}

export function buildWriterPromptSuffix(accountContext?: AccountPromptContext | null) {
  const personaName = accountContext?.accountName?.trim();
  if (!personaName) {
    return null;
  }

  const lines = [
    "Runtime account context:",
    `1. The current target account/persona name is "${personaName}". If the base prompt mentions a default persona name such as "二牛", override it with this account.`,
    "2. This is still the lightweight matrix-testing phase. Do not rewrite the whole style system just to create superficial differences between accounts.",
    "3. The main adjustment should happen in tone, observation angle and experience framing, while the answer still needs to feel natural, restrained and believable.",
    `4. Unless the topic truly needs a credibility setup, do not open the answer with a rigid self-introduction like "我是${personaName}".`
  ];

  if (accountContext?.zhihuUserName?.trim()) {
    lines.push(
      `5. The linked Zhihu username is "${accountContext.zhihuUserName.trim()}". It can be used as a tone reference when needed, but it does not need to appear in the final answer.`
    );
  }

  return lines.join("\n");
}
