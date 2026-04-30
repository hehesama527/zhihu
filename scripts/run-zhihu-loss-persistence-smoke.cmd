@echo off
setlocal

cd /d H:\claw

set "TOPIC=在币圈一直赔，还有必要坚持吗?"
set "OUTPUT_MD=data\zhihu-agent-context\zhihu-loss-persistence-production-smoke-20260427.md"

echo Running Zhihu production smoke test...
echo Topic: %TOPIC%
echo Output: %OUTPUT_MD%
echo.

node scripts\test-zhihu-production-case-research.mjs

echo.
echo Done. If the command failed, copy the error text from this window.
pause
