humanizer-zh 生产环境要求

本地安装状态

- 已安装到 `C:\Users\Mayn\.codex\skills\humanizer-zh`
- 安装来源：`https://github.com/op7418/Humanizer-zh`
- 本次安装命令：

```powershell
python C:\Users\Mayn\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py --repo op7418/Humanizer-zh --path . --name humanizer-zh --ref main --method download
```

当前项目接入状态

- 当前项目已改为从本地 `humanizer-zh` skill 读取 `SKILL.md`
- 接线位置在 [packages/core/src/services/humanizer-service.ts](/h:/claw/packages/core/src/services/humanizer-service.ts)
- 服务运行时会把本地 skill 内容作为 humanizer 的系统提示词

这意味着两件事：

- 生产环境现在明确依赖本地 `humanizer-zh` skill
- 如果 skill 缺失、路径错误或模型返回的结果不是合法 JSON，流程会直接报错，不再回退到内置 prompt

生产环境必须满足

1. 运行环境需要支持 Codex skills，且 `CODEX_HOME` 可用
2. skill 目录必须可写
3. 目标目录中必须存在 `SKILL.md`
4. 首次安装时需要能访问 `github.com` 和 `codeload.github.com`
5. 需要可用的 Python 3 来运行安装脚本
6. 安装完成后需要重启 Codex，才能重新发现新增 skill
7. 项目运行时需要能读取 `HUMANIZER_SKILL_PATH` 指向的文件

默认目录

- Windows：`%USERPROFILE%\.codex\skills\humanizer-zh`
- Linux/macOS：`~/.codex/skills/humanizer-zh`

推荐上线方式

方式 A：构建阶段直接拷贝 skill 目录

- 优点：最稳定，不依赖部署时外网
- 做法：把 `humanizer-zh` 目录随镜像或发布包一起带上，部署时直接复制到 `$CODEX_HOME/skills/`

方式 B：部署阶段执行安装脚本

- 优点：流程简单，环境干净
- 风险：依赖 GitHub 网络可用
- 做法：在服务器启动前执行安装命令

方式 C：把 skill vendoring 到项目仓库

- 优点：版本最可控，适合生产审计
- 风险：需要你们自己管理更新
- 做法：把 skill 放进项目自有目录，再在部署脚本中复制到 `$CODEX_HOME/skills/humanizer-zh`

生产环境建议

- 不要长期跟随 `main` 分支，最好固定到 commit 或 tag
- 如果生产环境网络不稳定，优先用“构建阶段拷贝”或“仓库内置”方式
- 优先显式设置 `HUMANIZER_SKILL_PATH`，不要完全依赖默认推导
- 同时保证 LLM 配置和 [packages/core/src/services/humanizer-service.ts](/h:/claw/packages/core/src/services/humanizer-service.ts) 可用

Windows 安装命令

```powershell
python C:\Users\Mayn\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py --repo op7418/Humanizer-zh --path . --name humanizer-zh --ref main --method download
```

Linux/macOS 安装命令

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo op7418/Humanizer-zh --path . --name humanizer-zh --ref main --method download
```

建议环境变量

```bash
CODEX_HOME=/home/app/.codex
HUMANIZER_SKILL_PATH=/home/app/.codex/skills/humanizer-zh/SKILL.md
```

目录验收

部署完成后，目录至少应为：

```text
$CODEX_HOME/skills/humanizer-zh/
|- SKILL.md
|- README.md
|- LICENSE
`- .gitignore
```

上线前检查清单

- [ ] `humanizer-zh` 目录已落到目标机器
- [ ] `SKILL.md` 存在
- [ ] `HUMANIZER_SKILL_PATH` 指向正确
- [ ] Codex 已重启
- [ ] 运行环境的 LLM 配置可用
- [ ] 当前项目的 `HumanizerService` 可正常调用模型
- [ ] `humanizer-zh` 返回 JSON 能被系统正常解析

补充说明

当前版本已经是“生产环境必须依赖 humanizer-zh skill”的实现，不再保留内置 prompt 回退。
